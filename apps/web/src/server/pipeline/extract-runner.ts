import {
  assignFactIds,
  createHiveError,
  type DocExtraction,
  documentKeyFor,
  EXTRACT_SINGLE_PAGE_ATTEMPT_LIMIT,
  type ExtractionVerificationStats,
  type HiveError,
  type PipelineThroughputStats,
  defaultPipelineThroughput,
  planExtractPageRanges,
  plannerCallDurationMs,
  validateDocExtraction,
  type VerificationPage,
  verifyExtraction,
} from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";
import { callPlanner, plannerHttpStatus, type PlannerDeps } from "@/server/study-preparation/planner-client";
import { type ExtractPrompt, loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";

const TRUNCATION_REASON = "model_output_truncated";

/** Per scheduled page range: monotonic planner HTTP attempt counter (splits share one counter). */
type RangeAttemptState = { next: number };

function takeRangeAttempt(state: RangeAttemptState): number {
  const n = state.next;
  state.next += 1;
  return n;
}

/** Planner failures that mean the model answered but the answer was not a usable JSON object. */
const UNPARSEABLE_REASONS = new Set(["model_output_not_json", "model_output_invalid", "model_content_missing"]);

export type ExtractCallRecord = {
  readonly pageRange: string | null;
  /** 1 or 2: inner JSON retry round for the same range; see rangeAttempt for global sequence. */
  readonly attempt: 1 | 2;
  /** Monotonic sequence of planner HTTP attempts for this scheduled range (across inner retries and splits). */
  readonly rangeAttempt: number;
  readonly callStartedAt: string;
  readonly outcome: "ok" | "unparseable" | "failed";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Model latency reported by the planner. */
  readonly latencyMs: number | null;
  readonly roundTripMs: number;
  readonly finishReason: string | null;
  readonly modelAlias: string | null;
  readonly resolvedModel: string | null;
  readonly errorCode: string | null;
  readonly diagnosticReason: string | null;
  readonly httpStatus: number | null;
  /** True when our client deadline or AbortSignal ended the request; false for planner/network/proxy. */
  readonly abortedByOurDeadline: boolean;
};

export type ExtractDocumentStats = ExtractionVerificationStats & {
  /** Facts in the model answers, including malformed ones. */
  factsProposed: number;
  /** Malformed items dropped before quote verification, by reason. */
  malformed: Record<string, number>;
  ranges: { pageRange: string | null; truncated: boolean; lastPageCompleted: number }[];
  /** Pages that still hit the output cap after splitting down to a single page. */
  pageExtractionGaps: number[];
};

export type ExtractDocumentResult =
  | { ok: true; extraction: DocExtraction; stats: ExtractDocumentStats; calls: ExtractCallRecord[] }
  | { ok: false; error: HiveError; calls: ExtractCallRecord[] };

export type ExtractAttemptLifecycle = {
  /**
   * Insert IN_FLIGHT before `callPlanner` (service role). Return attempt row id for
   * {@link ExtractAttemptLifecycle.finalize}, or null when persistence is skipped.
   */
  begin?: (input: {
    pageRange: string | null;
    attempt: 1 | 2;
    rangeAttempt: number;
    callStartedAt: string;
  }) => Promise<string | null>;
  /** Mark IN_FLIGHT as SUCCEEDED or FAILED when the HTTP call completes (or is abandoned). */
  finalize?: (input: {
    attemptRowId: string | null;
    pageRange: string | null;
    attempt: 1 | 2;
    rangeAttempt: number;
    callStartedAt: string;
    outcome: "succeeded" | "failed";
    durationMs: number;
    errorCode: string | null;
    diagnosticReason: string | null;
    httpStatus: number | null;
    abortedByOurDeadline: boolean;
  }) => Promise<void>;
};

export type ExtractDocumentInput = {
  readonly planner: PlannerDeps;
  readonly document: { readonly id: string; readonly fileName: string };
  readonly pages: readonly VerificationPage[];
  readonly correlationId: string;
  readonly runId: string;
  readonly prompt?: ExtractPrompt;
  /** When set, caps each planner call from the remaining invocation budget (never above the extract task limit). */
  readonly resolvePlannerTimeoutMs?: () => number | "expired";
  /** Uncapped extract task timeout for the range; used to detect invocation-budget aborts. */
  readonly resolveFullPlannerTimeoutMs?: () => number;
  readonly extractAttemptLifecycle?: ExtractAttemptLifecycle;
};

export function pageRanges(
  pages: readonly VerificationPage[],
  stats: PipelineThroughputStats = defaultPipelineThroughput("extract"),
): { pageRange: string | null; pages: VerificationPage[] }[] {
  return planExtractPageRanges(
    pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
    stats,
  );
}

function splitPagesInHalf(pages: VerificationPage[]): [VerificationPage[], VerificationPage[]] {
  const mid = Math.ceil(pages.length / 2);
  return [pages.slice(0, mid), pages.slice(mid)];
}

export function rangeLabel(pages: readonly VerificationPage[]): string | null {
  if (pages.length === 0) return null;
  if (pages.length === 1) return String(pages[0]!.pageNumber);
  return `${pages[0]!.pageNumber}-${pages[pages.length - 1]!.pageNumber}`;
}

/** Database cache key for a page range (`all` when the model sees every page in one call). */
export function pageRangeStorageKey(pageRange: string | null): string {
  return pageRange ?? "all";
}

export function parsePageRangeStorageKey(pageRange: string, totalPages: number): number[] {
  if (pageRange === "all") {
    return totalPages > 0 ? Array.from({ length: totalPages }, (_, index) => index + 1) : [];
  }
  if (/^\d+$/.test(pageRange)) return [Number(pageRange)];
  const match = /^(\d+)-(\d+)$/.exec(pageRange);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function pagesCoveredBySavedRangeKeys(savedRangeKeys: ReadonlySet<string>, totalPages: number): Set<number> {
  const covered = new Set<number>();
  for (const key of savedRangeKeys) {
    for (const page of parsePageRangeStorageKey(key, totalPages)) covered.add(page);
  }
  return covered;
}

function verifiedPageCountForPages(pages: readonly VerificationPage[], verifiedPageCount?: number): number {
  if (typeof verifiedPageCount === "number" && Number.isInteger(verifiedPageCount) && verifiedPageCount > 0) {
    return verifiedPageCount;
  }
  if (pages.length === 0) return 0;
  return Math.max(...pages.map((page) => page.pageNumber));
}

/** Next planner work items: uncovered pages chunked like the initial full-document pass. */
export function missingExtractWorkItems(
  pages: readonly VerificationPage[],
  savedRangeKeys: ReadonlySet<string>,
  stats: PipelineThroughputStats = defaultPipelineThroughput("extract"),
  verifiedPageCount?: number,
): { pageRange: string | null; pages: VerificationPage[] }[] {
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  if (sorted.length === 0) return [];
  const totalPages = verifiedPageCountForPages(sorted, verifiedPageCount);
  const covered = pagesCoveredBySavedRangeKeys(savedRangeKeys, totalPages);
  const uncovered = sorted.filter((page) => !covered.has(page.pageNumber));
  if (uncovered.length === 0) return [];
  return planExtractPageRanges(
    uncovered.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
    stats,
  ).map((item) => ({
    ...item,
    pageRange: item.pageRange ?? rangeLabel(item.pages),
  }));
}

/** Split one scheduled range into capped sub-ranges (pages and char limits). */
export function planCappedExtractRangesForWorkItem(
  pages: readonly VerificationPage[],
  pageRange: string | null,
  verifiedPageCount: number,
  stats: PipelineThroughputStats,
): { pageRange: string | null; pages: VerificationPage[] }[] {
  const totalPages = verifiedPageCountForPages(pages, verifiedPageCount);
  const pageNumbers =
    pageRange === null
      ? sortedPageNumbers(pages)
      : parsePageRangeStorageKey(pageRangeStorageKey(pageRange), totalPages);
  const allowed = new Set(pageNumbers);
  const selected = pages.filter((page) => allowed.has(page.pageNumber)).sort((a, b) => a.pageNumber - b.pageNumber);
  if (selected.length === 0) return [];
  return planExtractPageRanges(
    selected.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
    stats,
  ).map((item) => ({
    pageRange: item.pageRange ?? rangeLabel(item.pages as VerificationPage[]),
    pages: item.pages as VerificationPage[],
  }));
}

function sortedPageNumbers(pages: readonly VerificationPage[]): number[] {
  return [...pages].map((page) => page.pageNumber).sort((a, b) => a - b);
}

function createExtractClientDeadlineError(input: {
  correlationId: string;
  runId: string;
  diagnosticReason?: string;
}): HiveError {
  return createHiveError({
    errorCode: "CLIENT_DEADLINE",
    category: "DEPENDENCY",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "This analysis step ran out of time. You can try again.",
    correlationId: input.correlationId,
    operationId: input.runId,
    diagnosticReason: input.diagnosticReason ?? "client_deadline",
  });
}

function emptyVerificationStats(): ExtractionVerificationStats {
  return {
    factsIn: 0,
    factsKept: 0,
    evidenceIn: 0,
    evidenceDropped: 0,
    byReason: {},
    emptyFields: { in: 0, kept: 0 },
    referencedDocuments: { in: 0, kept: 0 },
    documentEvidence: { in: 0, kept: 0 },
    dropped: [],
  };
}

export function buildPageExtractionGap(
  document: { readonly id: string; readonly fileName: string },
  range: { pageRange: string | null; pages: VerificationPage[] },
  pageNumber: number,
): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId: document.id,
    fileName: document.fileName,
    pageRange: range.pageRange,
    document: {
      titleAsPrinted: "",
      documentType: "",
      domain: { label: "", confidence: null },
      summary: "",
      issuer: null,
      aboutPeople: [],
      keyDates: [],
    },
    facts: [],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: {
      pageCount: range.pages.length,
      pagesRead: [],
      pagesBlankOrUnreadable: [pageNumber],
      truncated: true,
      lastPageCompleted: 0,
    },
  };
}

const PAGE_TEXT_PLACEHOLDER = /\{\{EITHER[^}]*\}\}/;

/** Renders the `## User (template)` section with the page text introduced by `=== PAGE n ===` lines. */
export function renderExtractUserMessage(
  template: string,
  input: { documentId: string; fileName: string; pageRange: string | null; pages: readonly VerificationPage[] },
): string {
  const filled = template
    .split("{{documentId}}").join(input.documentId)
    .split("{{fileName}}").join(input.fileName)
    .split('{{pageRange or "all"}}').join(input.pageRange ?? "all");
  if (!PAGE_TEXT_PLACEHOLDER.test(filled)) throw new Error("extract_template_page_placeholder_missing");
  const [before, after] = filled.split(PAGE_TEXT_PLACEHOLDER) as [string, string];
  if (/\{\{[^}]*\}\}/.test(before + after)) throw new Error("extract_template_placeholder_unfilled");
  const pageText = input.pages.map((page) => `=== PAGE ${page.pageNumber} ===\n${page.text}`).join("\n\n");
  return `${before}${pageText}${after}`;
}

function retryNote(reason: string): string {
  return `\n\nYour previous answer could not be used (${reason}). Return only the JSON object described in the instructions, with no text before or after it.`;
}

function asHiveError(error: unknown): HiveError | null {
  return error && typeof error === "object" && "errorCode" in error && "stage" in error ? (error as HiveError) : null;
}

type RangeOutcome =
  | {
      ok: true;
      extraction: DocExtraction;
      factsProposed: number;
      malformed: Record<string, number>;
      stats: ExtractionVerificationStats;
      pageGaps: number[];
      modelAlias: string | null;
    }
  | { ok: false; error: HiveError };

export type PersistExtractedRange = (input: {
  pageRange: string | null;
  extraction: DocExtraction;
  stats: Pick<ExtractDocumentStats, "factsProposed" | "malformed"> & ExtractionVerificationStats;
  pageGaps: number[];
  modelAlias: string | null;
}) => Promise<void>;

function mergeRangeOutcomes(
  left: RangeOutcome,
  right: RangeOutcome,
  pages: VerificationPage[],
): RangeOutcome {
  if (!left.ok) return left;
  if (!right.ok) return right;
  const merged = mergeRanges([left.extraction, right.extraction], pages.length);
  const stats = emptyVerificationStats();
  for (const part of [left.stats, right.stats]) {
    stats.factsIn += part.factsIn;
    stats.factsKept += part.factsKept;
    stats.evidenceIn += part.evidenceIn;
    stats.evidenceDropped += part.evidenceDropped;
    sumCounts(stats.byReason, part.byReason);
    for (const key of ["emptyFields", "referencedDocuments", "documentEvidence"] as const) {
      stats[key].in += part[key].in;
      stats[key].kept += part[key].kept;
    }
    stats.dropped.push(...part.dropped);
  }
  const malformed: Record<string, number> = { ...(left.malformed ?? {}) };
  sumCounts(malformed, right.malformed ?? {});
  return {
    ok: true,
    extraction: merged,
    factsProposed: left.factsProposed + right.factsProposed,
    malformed,
    stats,
    pageGaps: [...left.pageGaps, ...right.pageGaps],
    modelAlias: right.modelAlias ?? left.modelAlias,
  };
}

async function persistLeafRange(
  input: ExtractDocumentInput & { prompt: ExtractPrompt },
  range: { pageRange: string | null; pages: VerificationPage[] },
  outcome: Extract<RangeOutcome, { ok: true }>,
  persist: PersistExtractedRange | undefined,
): Promise<void> {
  if (!persist) return;
  await persist({
    pageRange: range.pageRange,
    extraction: outcome.extraction,
    stats: {
      factsProposed: outcome.factsProposed,
      malformed: outcome.malformed,
      ...outcome.stats,
    },
    pageGaps: outcome.pageGaps,
    modelAlias: outcome.modelAlias,
  });
}

async function extractRangeAdaptive(
  input: ExtractDocumentInput & { prompt: ExtractPrompt },
  range: { pageRange: string | null; pages: VerificationPage[] },
  calls: ExtractCallRecord[],
  persist: PersistExtractedRange | undefined,
  rangeState: RangeAttemptState,
  singlePageTimeoutAttempts = 0,
): Promise<RangeOutcome> {
  const outcome = await extractRange(input, range, calls, rangeState);
  if (outcome.ok) {
    const saved = { ...outcome, pageGaps: [] as number[] };
    await persistLeafRange(input, range, saved, persist);
    return saved;
  }
  const truncated =
    outcome.error.errorCode === "MODEL_OUTPUT_INVALID" && outcome.error.diagnosticReason === TRUNCATION_REASON;
  const timedOut = outcome.error.errorCode === "MODEL_TIMEOUT" || outcome.error.errorCode === "CLIENT_DEADLINE";
  if (!truncated && !timedOut) return outcome;
  const { pages } = range;
  if (timedOut) {
    const clientDeadlineAbort =
      outcome.error.errorCode === "CLIENT_DEADLINE" ||
      outcome.error.diagnosticReason === "client_deadline" ||
      calls.some((call) => call.abortedByOurDeadline && call.errorCode === "CLIENT_DEADLINE");
    if (clientDeadlineAbort) return outcome;
    if (pages.length > 1) {
      const [leftPages, rightPages] = splitPagesInHalf(pages);
      const left = await extractRangeAdaptive(
        input,
        { pageRange: rangeLabel(leftPages), pages: leftPages },
        calls,
        persist,
        rangeState,
      );
      const right = await extractRangeAdaptive(
        input,
        { pageRange: rangeLabel(rightPages), pages: rightPages },
        calls,
        persist,
        rangeState,
      );
      return mergeRangeOutcomes(left, right, pages);
    }
    const nextAttempts = singlePageTimeoutAttempts + 1;
    if (nextAttempts >= EXTRACT_SINGLE_PAGE_ATTEMPT_LIMIT) {
      return outcome;
    }
    return extractRangeAdaptive(input, range, calls, persist, rangeState, nextAttempts);
  }
  if (pages.length > 1) {
    const [leftPages, rightPages] = splitPagesInHalf(pages);
    const left = await extractRangeAdaptive(
      input,
      { pageRange: rangeLabel(leftPages), pages: leftPages },
      calls,
      persist,
      rangeState,
    );
    const right = await extractRangeAdaptive(
      input,
      { pageRange: rangeLabel(rightPages), pages: rightPages },
      calls,
      persist,
      rangeState,
    );
    return mergeRangeOutcomes(left, right, pages);
  }
  return outcome;
}

function clientExtractDeadlineAbort(input: {
  timeoutMs: number | "expired" | undefined;
  fullTimeoutMs: number | undefined;
  roundTripMs?: number;
}): boolean {
  if (input.timeoutMs === "expired") return true;
  if (typeof input.timeoutMs === "number" && typeof input.roundTripMs === "number") {
    if (input.roundTripMs >= Math.max(0, input.timeoutMs - 2_000)) return true;
  }
  if (typeof input.timeoutMs !== "number" || typeof input.fullTimeoutMs !== "number") return false;
  return input.timeoutMs + 1_000 < input.fullTimeoutMs;
}

function remapClientDeadlineError(
  hiveError: HiveError,
  input: { correlationId: string; runId: string; abortedByOurDeadline: boolean },
): HiveError {
  if (!input.abortedByOurDeadline) return hiveError;
  if (hiveError.errorCode === "CLIENT_DEADLINE") return hiveError;
  return createExtractClientDeadlineError({
    correlationId: input.correlationId,
    runId: input.runId,
    diagnosticReason: "client_deadline",
  });
}

async function recordFailedExtractPlannerCall(
  input: ExtractDocumentInput & { prompt: ExtractPrompt },
  range: { pageRange: string | null; pages: VerificationPage[] },
  record: ExtractCallRecord & { outcome: "failed" },
): Promise<void> {
  const durationMs = Math.max(0, Math.trunc(record.roundTripMs));
  emitStructuredEvent({
    eventName: "pipeline.extract.planner_failed",
    severity: "ERROR",
    timestamp: new Date().toISOString(),
    component: "pipeline",
    operation: "extract",
    stage: "ANALYZE",
    correlationId: input.correlationId,
    processingRunId: input.runId,
    sourceDocumentId: input.document.id,
    pageRange: pageRangeStorageKey(record.pageRange ?? range.pageRange),
    rangeAttempt: record.rangeAttempt,
    attempt: record.attempt,
    callStartedAt: record.callStartedAt,
    durationMs,
    httpStatus: record.httpStatus ?? undefined,
    errorCode: record.errorCode ?? undefined,
    diagnosticReason: record.diagnosticReason ?? undefined,
    abortedByOurDeadline: record.abortedByOurDeadline,
    task: "extract",
  });
}

function pushFailedExtractCall(
  calls: ExtractCallRecord[],
  input: {
    pageRange: string | null;
    attempt: 1 | 2;
    rangeAttempt: number;
    callStartedAt: string;
    started: number;
    errorCode: string;
    diagnosticReason: string;
    httpStatus: number | null;
    abortedByOurDeadline: boolean;
  },
): ExtractCallRecord & { outcome: "failed" } {
  const roundTripMs = Math.max(0, Date.now() - input.started);
  const record: ExtractCallRecord & { outcome: "failed" } = {
    pageRange: input.pageRange,
    attempt: input.attempt,
    rangeAttempt: input.rangeAttempt,
    callStartedAt: input.callStartedAt,
    outcome: "failed",
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
    roundTripMs,
    finishReason: null,
    modelAlias: null,
    resolvedModel: null,
    errorCode: input.errorCode,
    diagnosticReason: input.diagnosticReason,
    httpStatus: input.httpStatus,
    abortedByOurDeadline: input.abortedByOurDeadline,
  };
  calls.push(record);
  return record;
}

async function extractRange(
  input: ExtractDocumentInput & { prompt: ExtractPrompt },
  range: { pageRange: string | null; pages: VerificationPage[] },
  calls: ExtractCallRecord[],
  rangeState: RangeAttemptState,
): Promise<RangeOutcome> {
  const message = renderExtractUserMessage(input.prompt.userTemplate, {
    documentId: input.document.id,
    fileName: input.document.fileName,
    pageRange: range.pageRange,
    pages: range.pages,
  });
  let parseError: string | null = null;
  const lifecycle = input.extractAttemptLifecycle;
  for (const attempt of [1, 2] as const) {
    const started = Date.now();
    const callStartedAt = new Date(started).toISOString();
    const timeoutMs = input.resolvePlannerTimeoutMs?.();
    const fullTimeoutMs = input.resolveFullPlannerTimeoutMs?.();
    if (timeoutMs === "expired") {
      const rangeAttempt = takeRangeAttempt(rangeState);
      const failed = pushFailedExtractCall(calls, {
        pageRange: range.pageRange,
        attempt,
        rangeAttempt,
        callStartedAt,
        started,
        errorCode: "CLIENT_DEADLINE",
        diagnosticReason: "client_deadline",
        httpStatus: null,
        abortedByOurDeadline: true,
      });
      await recordFailedExtractPlannerCall(input, range, failed);
      return {
        ok: false,
        error: createExtractClientDeadlineError({
          correlationId: input.correlationId,
          runId: input.runId,
        }),
      };
    }
    const userMessage = parseError === null ? message : message + retryNote(parseError);
    const rangeAttempt = takeRangeAttempt(rangeState);
    let attemptRowId: string | null = null;
    if (lifecycle?.begin) {
      try {
        attemptRowId = await lifecycle.begin({ pageRange: range.pageRange, attempt, rangeAttempt, callStartedAt });
      } catch (beginError) {
        const hiveError = asHiveError(beginError);
        if (!hiveError) throw beginError;
        const failed = pushFailedExtractCall(calls, {
          pageRange: range.pageRange,
          attempt,
          rangeAttempt,
          callStartedAt,
          started,
          errorCode: hiveError.errorCode,
          diagnosticReason: hiveError.diagnosticReason ?? "extract_attempt_record_failed",
          httpStatus: null,
          abortedByOurDeadline: false,
        });
        await recordFailedExtractPlannerCall(input, range, failed);
        return { ok: false, error: hiveError };
      }
    }
    try {
      const completion = await callPlanner(input.planner, {
        prompt: input.prompt,
        userPayload: { message: userMessage },
        correlationId: input.correlationId,
        processingRunId: input.runId,
        ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
      });
      const validated = validateDocExtraction(completion.contentJson, {
        documentId: input.document.id,
        fileName: input.document.fileName,
        pageRange: range.pageRange,
      });
      const durationMs = plannerCallDurationMs({ roundTripMs: completion.roundTripMs, latencyMs: completion.latencyMs });
      calls.push({
        pageRange: range.pageRange,
        attempt,
        rangeAttempt,
        callStartedAt,
        outcome: validated.ok ? "ok" : "unparseable",
        inputTokens: completion.usage.promptTokens,
        outputTokens: completion.usage.completionTokens,
        latencyMs: completion.latencyMs,
        roundTripMs: completion.roundTripMs,
        finishReason: completion.finishReason,
        modelAlias: completion.modelAlias,
        resolvedModel: completion.resolvedModel,
        errorCode: null,
        diagnosticReason: validated.ok ? null : validated.reason,
        httpStatus: null,
        abortedByOurDeadline: false,
      });
      if (lifecycle?.finalize) {
        await lifecycle.finalize({
          attemptRowId,
          pageRange: range.pageRange,
          attempt,
          rangeAttempt,
          callStartedAt,
          outcome: validated.ok ? "succeeded" : "failed",
          durationMs,
          errorCode: validated.ok ? null : "MODEL_OUTPUT_INVALID",
          diagnosticReason: validated.ok ? null : (validated.reason ?? null),
          httpStatus: null,
          abortedByOurDeadline: false,
        });
      }
      if (validated.ok) {
        const verified = verifyExtraction(validated.value, range.pages);
        const saved = {
          ok: true as const,
          extraction: verified.extraction,
          factsProposed: validated.factsProposed,
          malformed: validated.malformed,
          stats: verified.stats,
          pageGaps: [] as number[],
          modelAlias: completion.modelAlias,
        };
        return saved;
      }
      parseError = validated.message;
    } catch (error) {
      const hiveError = asHiveError(error);
      if (!hiveError) {
        await lifecycle?.finalize?.({
          attemptRowId,
          pageRange: range.pageRange,
          attempt,
          rangeAttempt,
          callStartedAt,
          outcome: "failed",
          durationMs: Math.max(0, Date.now() - started),
          errorCode: "INTERNAL_ERROR",
          diagnosticReason: "unexpected_exception",
          httpStatus: null,
          abortedByOurDeadline: false,
        }).catch(() => null);
        throw error;
      }
      const unparseable = hiveError.errorCode === "MODEL_OUTPUT_INVALID" && UNPARSEABLE_REASONS.has(hiveError.diagnosticReason ?? "");
      const roundTripMs = Math.max(0, Date.now() - started);
      const abortedByOurDeadline = clientExtractDeadlineAbort({
        timeoutMs: typeof timeoutMs === "number" ? timeoutMs : timeoutMs,
        fullTimeoutMs,
        roundTripMs,
      });
      const deadlineAbort = abortedByOurDeadline;
      const durationMs = plannerCallDurationMs({ roundTripMs, latencyMs: null });
      if (unparseable) {
        calls.push({
          pageRange: range.pageRange,
          attempt,
          rangeAttempt,
          callStartedAt,
          outcome: "unparseable",
          inputTokens: null,
          outputTokens: null,
          latencyMs: null,
          roundTripMs,
          finishReason: null,
          modelAlias: null,
          resolvedModel: null,
          errorCode: hiveError.errorCode,
          diagnosticReason: hiveError.diagnosticReason ?? null,
          httpStatus: plannerHttpStatus(hiveError),
          abortedByOurDeadline: false,
        });
        await lifecycle?.finalize?.({
          attemptRowId,
          pageRange: range.pageRange,
          attempt,
          rangeAttempt,
          callStartedAt,
          outcome: "failed",
          durationMs,
          errorCode: hiveError.errorCode,
          diagnosticReason: hiveError.diagnosticReason ?? null,
          httpStatus: plannerHttpStatus(hiveError),
          abortedByOurDeadline: false,
        }).catch(() => null);
      } else {
        const remapped = remapClientDeadlineError(hiveError, {
          correlationId: input.correlationId,
          runId: input.runId,
          abortedByOurDeadline: deadlineAbort,
        });
        const failed = pushFailedExtractCall(calls, {
          pageRange: range.pageRange,
          attempt,
          rangeAttempt,
          callStartedAt,
          started,
          errorCode: remapped.errorCode,
          diagnosticReason: deadlineAbort ? "client_deadline" : (hiveError.diagnosticReason ?? "planner_unavailable"),
          httpStatus: plannerHttpStatus(hiveError),
          abortedByOurDeadline: deadlineAbort,
        });
        await recordFailedExtractPlannerCall(input, range, failed);
        await lifecycle?.finalize?.({
          attemptRowId,
          pageRange: range.pageRange,
          attempt,
          rangeAttempt,
          callStartedAt,
          outcome: "failed",
          durationMs,
          errorCode: remapped.errorCode,
          diagnosticReason: deadlineAbort ? "client_deadline" : (hiveError.diagnosticReason ?? "planner_unavailable"),
          httpStatus: plannerHttpStatus(hiveError),
          abortedByOurDeadline: deadlineAbort,
        }).catch(() => null);
      }
      if (!unparseable) {
        const remapped = remapClientDeadlineError(hiveError, {
          correlationId: input.correlationId,
          runId: input.runId,
          abortedByOurDeadline: deadlineAbort,
        });
        return { ok: false, error: remapped };
      }
      parseError = hiveError.diagnosticReason!;
    }
  }
  return {
    ok: false,
    error: createHiveError({
      errorCode: "MODEL_OUTPUT_INVALID",
      category: "MODEL",
      stage: "EXTRACT",
      retryable: false,
      safeMessage: "The extraction model returned an answer we couldn't use.",
      correlationId: input.correlationId,
      operationId: input.runId,
      diagnosticReason: "extraction_unparseable_after_retry",
    }),
  };
}

function sumCounts<K extends string>(into: Partial<Record<K, number>>, from: Partial<Record<K, number>> | null | undefined): void {
  const safe = from ?? {};
  for (const [key, count] of Object.entries(safe) as [K, number][]) into[key] = (into[key] ?? 0) + count;
}

/** Prefixes person refs with the range (`p21-40:P1`) so refs from different ranges never collide before `assignFactIds`. */
function scopePersonRefs(part: DocExtraction): DocExtraction {
  const prefix = `p${part.pageRange}:`;
  const scope = (ref: string | null) => (ref === null || ref.startsWith(prefix) ? ref : prefix + ref);
  return {
    ...part,
    document: { ...part.document, aboutPeople: part.document.aboutPeople.map((p) => ({ ...p, ref: scope(p.ref) })) },
    facts: part.facts.map((fact) => ({ ...fact, aboutPersonRef: scope(fact.aboutPersonRef) })),
  };
}

export function mergeRanges(ranges: DocExtraction[], pageCount: number): DocExtraction {
  const [first, ...rest] = ranges as [DocExtraction, ...DocExtraction[]];
  if (rest.length === 0) return { ...first, coverage: { ...first.coverage, pageCount } };
  const parts = ranges.map(scopePersonRefs);
  const header = first.document;
  const pick = (get: (d: DocExtraction) => string) => parts.map(get).find((value) => value.trim() !== "") ?? "";
  const glossary = new Map<string, DocExtraction["glossary"][number]>();
  for (const entry of parts.flatMap((p) => p.glossary)) {
    const key = entry.term.trim().toLowerCase();
    if (!glossary.has(key)) glossary.set(key, entry);
  }
  const truncated = parts.find((p) => p.coverage.truncated);
  const union = (get: (d: DocExtraction) => number[]) => [...new Set(parts.flatMap(get))].sort((a, b) => a - b);
  return {
    ...first,
    pageRange: null,
    document: {
      ...header,
      titleAsPrinted: pick((p) => p.document.titleAsPrinted),
      documentType: pick((p) => p.document.documentType),
      summary: pick((p) => p.document.summary),
      issuer: parts.map((p) => p.document.issuer).find((issuer) => issuer && issuer.evidence.length > 0) ?? header.issuer,
      aboutPeople: parts.flatMap((p) => p.document.aboutPeople),
      keyDates: parts.flatMap((p) => p.document.keyDates),
    },
    facts: parts.flatMap((p) => p.facts),
    emptyFields: parts.flatMap((p) => p.emptyFields),
    referencedDocuments: parts.flatMap((p) => p.referencedDocuments),
    glossary: [...glossary.values()],
    instructionsIgnored: parts.flatMap((p) => p.instructionsIgnored),
    coverage: {
      pageCount,
      pagesRead: union((p) => p.coverage.pagesRead),
      pagesBlankOrUnreadable: union((p) => p.coverage.pagesBlankOrUnreadable),
      truncated: truncated !== undefined,
      lastPageCompleted: truncated
        ? truncated.coverage.lastPageCompleted
        : Math.max(...parts.map((p) => p.coverage.lastPageCompleted)),
    },
  };
}

/**
 * Runs `hive-extract/1` over one document using size-driven page ranges and recursive halving when
 * the model hits the output cap or times out on a multi-page range.
 * A single page that still truncates is recorded as a page extraction gap; the document still saves.
 * An unusable answer is retried once with the reason appended; a second failure fails the document.
 */
async function extractAllRanges(input: ExtractDocumentInput): Promise<ExtractDocumentResult> {
  const prompt = input.prompt ?? loadPromptCatalog().extract;
  const documentKey = documentKeyFor(input.document.id);
  const throughput = defaultPipelineThroughput("extract");
  const calls: ExtractCallRecord[] = [];
  const parts: DocExtraction[] = [];
  const stats: ExtractDocumentStats = {
    factsProposed: 0,
    malformed: {},
    factsIn: 0,
    factsKept: 0,
    evidenceIn: 0,
    evidenceDropped: 0,
    byReason: {},
    emptyFields: { in: 0, kept: 0 },
    referencedDocuments: { in: 0, kept: 0 },
    documentEvidence: { in: 0, kept: 0 },
    dropped: [],
    ranges: [],
    pageExtractionGaps: [],
  };
  for (const range of pageRanges(input.pages, throughput)) {
    const outcome = await extractRangeAdaptive({ ...input, prompt }, range, calls, undefined, { next: 1 });
    if (!outcome.ok) return { ok: false, error: outcome.error, calls };
    parts.push(outcome.extraction);
    stats.pageExtractionGaps.push(...outcome.pageGaps);
    const s = outcome.stats;
    stats.factsProposed += outcome.factsProposed;
    sumCounts(stats.malformed, outcome.malformed);
    stats.factsIn += s.factsIn;
    stats.factsKept += s.factsKept;
    stats.evidenceIn += s.evidenceIn;
    stats.evidenceDropped += s.evidenceDropped;
    sumCounts(stats.byReason, s.byReason);
    for (const key of ["emptyFields", "referencedDocuments", "documentEvidence"] as const) {
      stats[key].in += s[key].in;
      stats[key].kept += s[key].kept;
    }
    stats.dropped.push(...s.dropped);
    stats.ranges.push({
      pageRange: range.pageRange,
      truncated: outcome.extraction.coverage.truncated,
      lastPageCompleted: outcome.extraction.coverage.lastPageCompleted,
    });
  }
  if (parts.length === 0) {
    return {
      ok: false,
      calls,
      error: createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "EXTRACT",
        retryable: false,
        safeMessage: "The document has no pages to extract.",
        correlationId: input.correlationId,
        operationId: input.runId,
        diagnosticReason: "extraction_no_pages",
      }),
    };
  }
  const merged = mergeRanges(parts, input.pages.length);
  return { ok: true, extraction: assignFactIds(merged, documentKey), stats, calls };
}

/** Runs adaptive extract for one scheduled page slice (persists each leaf range when `persist` is set). */
export async function extractScheduledRange(
  input: ExtractDocumentInput & {
    range: { pageRange: string | null; pages: VerificationPage[] };
    persist?: PersistExtractedRange;
  },
): Promise<ExtractDocumentResult> {
  const prompt = input.prompt ?? loadPromptCatalog().extract;
  const calls: ExtractCallRecord[] = [];
  const stats: ExtractDocumentStats = {
    factsProposed: 0,
    malformed: {},
    factsIn: 0,
    factsKept: 0,
    evidenceIn: 0,
    evidenceDropped: 0,
    byReason: {},
    emptyFields: { in: 0, kept: 0 },
    referencedDocuments: { in: 0, kept: 0 },
    documentEvidence: { in: 0, kept: 0 },
    dropped: [],
    ranges: [],
    pageExtractionGaps: [],
  };
  const outcome = await extractRangeAdaptive({ ...input, prompt }, input.range, calls, input.persist, { next: 1 });
  if (!outcome.ok) return { ok: false, error: outcome.error, calls };
  stats.pageExtractionGaps.push(...outcome.pageGaps);
  const s = outcome.stats;
  stats.factsProposed += outcome.factsProposed;
  sumCounts(stats.malformed, outcome.malformed);
  stats.factsIn += s.factsIn;
  stats.factsKept += s.factsKept;
  stats.evidenceIn += s.evidenceIn;
  stats.evidenceDropped += s.evidenceDropped;
  sumCounts(stats.byReason, s.byReason);
  for (const key of ["emptyFields", "referencedDocuments", "documentEvidence"] as const) {
    stats[key].in += s[key].in;
    stats[key].kept += s[key].kept;
  }
  stats.dropped.push(...s.dropped);
  stats.ranges.push({
    pageRange: input.range.pageRange,
    truncated: outcome.extraction.coverage.truncated,
    lastPageCompleted: outcome.extraction.coverage.lastPageCompleted,
  });
  return { ok: true, extraction: outcome.extraction, stats, calls };
}

export function mergeSavedRangeExtractions(
  documentId: string,
  ranges: readonly { pageRange: string; extraction: DocExtraction }[],
  totalPages: number,
): DocExtraction {
  const sorted = [...ranges].sort((left, right) => {
    const leftStart = parsePageRangeStorageKey(left.pageRange, totalPages)[0] ?? 0;
    const rightStart = parsePageRangeStorageKey(right.pageRange, totalPages)[0] ?? 0;
    return leftStart - rightStart;
  });
  const merged = mergeRanges(
    sorted.map((row) => row.extraction),
    totalPages,
  );
  return assignFactIds(merged, documentKeyFor(documentId));
}

export async function extractDocument(input: ExtractDocumentInput): Promise<ExtractDocumentResult> {
  return extractAllRanges(input);
}
