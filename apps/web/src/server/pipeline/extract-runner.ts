import {
  assignFactIds,
  createHiveError,
  type DocExtraction,
  documentKeyFor,
  type ExtractionVerificationStats,
  type HiveError,
  validateDocExtraction,
  type VerificationPage,
  verifyExtraction,
} from "@hiveforyou/contracts";

import { callPlanner, type PlannerDeps } from "@/server/study-preparation/planner-client";
import { type ExtractPrompt, loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";

/** Pages per `hive-extract/1` call; keeps one answer inside the extract output cap and the planner timeout. */
export const EXTRACT_PAGES_PER_CALL = 20;
/** Smaller ranges for long documents where dense pages often exceed the output cap. */
export const EXTRACT_PAGES_PER_CALL_DENSE = 10;
/** Documents with more than this many pages start with {@link EXTRACT_PAGES_PER_CALL_DENSE}-page ranges. */
export const DENSE_DOCUMENT_MIN_PAGES = 21;

const TRUNCATION_REASON = "model_output_truncated";

/** Planner failures that mean the model answered but the answer was not a usable JSON object. */
const UNPARSEABLE_REASONS = new Set(["model_output_not_json", "model_output_invalid", "model_content_missing"]);

export type ExtractCallRecord = {
  readonly pageRange: string | null;
  readonly attempt: 1 | 2;
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

export type ExtractDocumentInput = {
  readonly planner: PlannerDeps;
  readonly document: { readonly id: string; readonly fileName: string };
  readonly pages: readonly VerificationPage[];
  readonly correlationId: string;
  readonly runId: string;
  readonly prompt?: ExtractPrompt;
  /** When set, caps each planner call from the remaining invocation budget (never above the extract task limit). */
  readonly resolvePlannerTimeoutMs?: () => number | "expired";
};

export function pagesPerExtractChunk(totalPages: number): number {
  return totalPages >= DENSE_DOCUMENT_MIN_PAGES ? EXTRACT_PAGES_PER_CALL_DENSE : EXTRACT_PAGES_PER_CALL;
}

export function pageRanges(pages: readonly VerificationPage[]): { pageRange: string | null; pages: VerificationPage[] }[] {
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const chunk = pagesPerExtractChunk(sorted.length);
  if (sorted.length <= chunk) return [{ pageRange: null, pages: sorted }];
  const ranges: { pageRange: string; pages: VerificationPage[] }[] = [];
  for (let start = 0; start < sorted.length; start += chunk) {
    const slice = sorted.slice(start, start + chunk);
    ranges.push({ pageRange: `${slice[0]!.pageNumber}-${slice[slice.length - 1]!.pageNumber}`, pages: slice });
  }
  return ranges;
}

function splitPagesInHalf(pages: VerificationPage[]): [VerificationPage[], VerificationPage[]] {
  const mid = Math.ceil(pages.length / 2);
  return [pages.slice(0, mid), pages.slice(mid)];
}

function rangeLabel(pages: VerificationPage[]): string | null {
  if (pages.length === 0) return null;
  if (pages.length === 1) return String(pages[0]!.pageNumber);
  return `${pages[0]!.pageNumber}-${pages[pages.length - 1]!.pageNumber}`;
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

function gapExtraction(
  input: ExtractDocumentInput & { prompt: ExtractPrompt },
  range: { pageRange: string | null; pages: VerificationPage[] },
  pageNumber: number,
): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId: input.document.id,
    fileName: input.document.fileName,
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

function timeoutError(correlationId: string, runId: string): HiveError {
  return createHiveError({
    errorCode: "MODEL_TIMEOUT",
    category: "DEPENDENCY",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "The analysis model took too long to answer. You can try again.",
    correlationId,
    operationId: runId,
    diagnosticReason: "planner_timeout",
  });
}

type RangeOutcome =
  | {
      ok: true;
      extraction: DocExtraction;
      factsProposed: number;
      malformed: Record<string, number>;
      stats: ExtractionVerificationStats;
      pageGaps: number[];
    }
  | { ok: false; error: HiveError };

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
  const malformed: Record<string, number> = { ...left.malformed };
  sumCounts(malformed, right.malformed);
  return {
    ok: true,
    extraction: merged,
    factsProposed: left.factsProposed + right.factsProposed,
    malformed,
    stats,
    pageGaps: [...left.pageGaps, ...right.pageGaps],
  };
}

async function extractRangeAdaptive(
  input: ExtractDocumentInput & { prompt: ExtractPrompt },
  range: { pageRange: string | null; pages: VerificationPage[] },
  calls: ExtractCallRecord[],
): Promise<RangeOutcome> {
  const outcome = await extractRange(input, range, calls);
  if (outcome.ok) {
    return { ...outcome, pageGaps: [] };
  }
  const truncated =
    outcome.error.errorCode === "MODEL_OUTPUT_INVALID" && outcome.error.diagnosticReason === TRUNCATION_REASON;
  if (!truncated) return outcome;
  const { pages } = range;
  if (pages.length > 1) {
    const [leftPages, rightPages] = splitPagesInHalf(pages);
    const left = await extractRangeAdaptive(
      input,
      { pageRange: rangeLabel(leftPages), pages: leftPages },
      calls,
    );
    const right = await extractRangeAdaptive(
      input,
      { pageRange: rangeLabel(rightPages), pages: rightPages },
      calls,
    );
    return mergeRangeOutcomes(left, right, pages);
  }
  const pageNumber = pages[0]!.pageNumber;
  const extraction = gapExtraction(input, range, pageNumber);
  return {
    ok: true,
    extraction,
    factsProposed: 0,
    malformed: {},
    stats: emptyVerificationStats(),
    pageGaps: [pageNumber],
  };
}

async function extractRange(
  input: ExtractDocumentInput & { prompt: ExtractPrompt },
  range: { pageRange: string | null; pages: VerificationPage[] },
  calls: ExtractCallRecord[],
): Promise<RangeOutcome> {
  const message = renderExtractUserMessage(input.prompt.userTemplate, {
    documentId: input.document.id,
    fileName: input.document.fileName,
    pageRange: range.pageRange,
    pages: range.pages,
  });
  let parseError: string | null = null;
  for (const attempt of [1, 2] as const) {
    const started = Date.now();
    const timeoutMs = input.resolvePlannerTimeoutMs?.();
    if (timeoutMs === "expired") {
      calls.push({
        pageRange: range.pageRange,
        attempt,
        outcome: "failed",
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        roundTripMs: Date.now() - started,
        finishReason: null,
        modelAlias: null,
        resolvedModel: null,
        errorCode: "MODEL_TIMEOUT",
        diagnosticReason: "planner_timeout",
      });
      return { ok: false, error: timeoutError(input.correlationId, input.runId) };
    }
    const userMessage = parseError === null ? message : message + retryNote(parseError);
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
      calls.push({
        pageRange: range.pageRange,
        attempt,
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
      });
      if (validated.ok) {
        const verified = verifyExtraction(validated.value, range.pages);
        return {
          ok: true,
          extraction: verified.extraction,
          factsProposed: validated.factsProposed,
          malformed: validated.malformed,
          stats: verified.stats,
          pageGaps: [],
        };
      }
      parseError = validated.message;
    } catch (error) {
      const hiveError = asHiveError(error);
      if (!hiveError) throw error;
      const unparseable = hiveError.errorCode === "MODEL_OUTPUT_INVALID" && UNPARSEABLE_REASONS.has(hiveError.diagnosticReason ?? "");
      calls.push({
        pageRange: range.pageRange,
        attempt,
        outcome: unparseable ? "unparseable" : "failed",
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        roundTripMs: Date.now() - started,
        finishReason: null,
        modelAlias: null,
        resolvedModel: null,
        errorCode: hiveError.errorCode,
        diagnosticReason: hiveError.diagnosticReason ?? null,
      });
      if (!unparseable) return { ok: false, error: hiveError };
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

function sumCounts<K extends string>(into: Partial<Record<K, number>>, from: Partial<Record<K, number>>): void {
  for (const [key, count] of Object.entries(from) as [K, number][]) into[key] = (into[key] ?? 0) + count;
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

function mergeRanges(ranges: DocExtraction[], pageCount: number): DocExtraction {
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
 * Runs `hive-extract/1` over one document: planner calls per page range (20 pages, or 10 when the
 * document has more than 20 pages), with recursive halving when the model hits the output cap.
 * A single page that still truncates is recorded as a page extraction gap; the document still saves.
 * An unusable answer is retried once with the reason appended; a second failure fails the document.
 */
export async function extractDocument(input: ExtractDocumentInput): Promise<ExtractDocumentResult> {
  const prompt = input.prompt ?? loadPromptCatalog().extract;
  const documentKey = documentKeyFor(input.document.id);
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
  for (const range of pageRanges(input.pages)) {
    const outcome = await extractRangeAdaptive({ ...input, prompt }, range, calls);
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
