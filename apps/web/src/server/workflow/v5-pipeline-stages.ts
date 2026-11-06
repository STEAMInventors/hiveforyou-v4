import {
  type CanonicalStudy,
  CANONICAL_STUDY_SCHEMA,
  createHiveError,
  type DocExtraction,
  type HiveError,
  normalizeProcessingRun,
  type ProcessingRun,
  type SnapshotDocument,
  type SourceSnapshot,
  type StageMetric,
  type StoredIntent,
  STUDY_VERIFICATION_SCHEMA,
  resolveAudienceConfiguration,
} from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";
import { canonicalizeCase } from "@/server/pipeline/canonicalize-runner";
import {
  type ExtractCallRecord,
  type ExtractDocumentStats,
  extractScheduledRange,
  mergeSavedRangeExtractions,
  missingExtractWorkItems,
  pageRangeStorageKey,
  pagesCoveredBySavedRangeKeys,
} from "@/server/pipeline/extract-runner";
import { sha256Digest } from "@/server/study-preparation/prompt-catalog";
import type { PromptCatalog } from "@/server/study-preparation/prompt-catalog";
import { canonicalJson } from "@/server/study-preparation/study-prompt-builder";

import {
  REPORT_ROUTE_MAX_DURATION_SECONDS,
  WRITE_CLIENT_TIMEOUT_MARGIN_MS,
} from "./report-generation";

import type { AnalysisWorkflowDeps } from "./analysis-workflow";

/** V5 pipeline model calls: 270 s client (30 s margin under 300 s lease / Vercel). */
export const V5_CLIENT_TASK_TIMEOUT_MS = 270_000;

const MIN_EXTRACT_CALL_MS = 1_000;

/** Wall-clock end of the hosting function's `maxDuration` window for this invocation. */
export function analysisRouteDeadlineMs(invocationStartedAt: number): number {
  return invocationStartedAt + REPORT_ROUTE_MAX_DURATION_SECONDS * 1000;
}

export function invocationRemainingMs(clock: () => number, invocationStartedAt: number): number {
  return Math.max(0, analysisRouteDeadlineMs(invocationStartedAt) - clock());
}

/** HTTP abort for one extract call: remaining invocation time minus margin, capped at the task budget. */
export function extractPlannerTimeoutMs(
  clock: () => number,
  invocationStartedAt: number,
): number | "expired" {
  const remaining = invocationRemainingMs(clock, invocationStartedAt);
  const budget = Math.min(Math.max(0, remaining - WRITE_CLIENT_TIMEOUT_MARGIN_MS), V5_CLIENT_TASK_TIMEOUT_MS);
  if (budget < MIN_EXTRACT_CALL_MS) return "expired";
  return budget;
}

/** Whether a worker may start another extract call in this invocation. */
export function canStartExtractingDocument(clock: () => number, invocationStartedAt: number): boolean {
  const remaining = invocationRemainingMs(clock, invocationStartedAt);
  const budget = extractPlannerTimeoutMs(clock, invocationStartedAt);
  if (budget === "expired") return false;
  return remaining >= budget + WRITE_CLIENT_TIMEOUT_MARGIN_MS;
}

/** Max concurrent `hive-extract/1` calls while a run is in EXTRACTING (bounded fan-out). */
export const EXTRACTING_CONCURRENCY = 4;

const EXTRACT_RETRYABLE_ERRORS = new Set(["MODEL_TIMEOUT", "MODEL_UNAVAILABLE"]);
export const EXTRACTING_ATTEMPT_LIMIT = 3;

export function isRetryableExtractFailure(error: HiveError): boolean {
  if (error.errorCode === "MODEL_OUTPUT_INVALID") return false;
  return error.retryable && EXTRACT_RETRYABLE_ERRORS.has(error.errorCode);
}

type RpcClient = AnalysisWorkflowDeps["client"];

function parsePayload(data: unknown): Record<string, unknown> | null {
  const payload = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

async function rpc(client: RpcClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message ?? `${fn} failed`);
  return parsePayload(data);
}

export type V5StageOutputs = {
  canonicalStudy?: CanonicalStudy;
};

export function extractionCacheKey(
  document: SnapshotDocument,
  prompt: { id: string; digest: string },
  modelAlias: string,
) {
  return `${document.sourceDocumentId}:${document.pageSetDigest}:${prompt.digest}:${modelAlias}`;
}

/** Document ids with a verified extraction for this run's frozen snapshot (via get_doc_extractions_for_run). */
export function extractedDocumentIds(extractionsPayload: unknown): Set<string> {
  const rows = Array.isArray((extractionsPayload as { extractions?: unknown })?.extractions)
    ? ((extractionsPayload as { extractions: Record<string, unknown>[] }).extractions ?? [])
    : [];
  const ids = new Set<string>();
  for (const row of rows) {
    const id = typeof row.sourceDocumentId === "string" ? row.sourceDocumentId.toLowerCase() : "";
    if (id) ids.add(id);
  }
  return ids;
}

export function countExtractedDocuments(snapshot: SourceSnapshot, extractedIds: ReadonlySet<string>): number {
  return snapshot.documents.filter((document) => extractedIds.has(document.sourceDocumentId.toLowerCase())).length;
}

export function nextDocumentNeedingExtraction(
  snapshot: SourceSnapshot,
  extractedIds: ReadonlySet<string>,
): SnapshotDocument | null {
  for (const document of snapshot.documents) {
    if (!extractedIds.has(document.sourceDocumentId.toLowerCase())) return document;
  }
  return null;
}

export function documentsNeedingExtraction(
  snapshot: SourceSnapshot,
  extractedIds: ReadonlySet<string>,
): SnapshotDocument[] {
  return snapshot.documents.filter((document) => !extractedIds.has(document.sourceDocumentId.toLowerCase()));
}

export type ExtractWorkItem = {
  document: SnapshotDocument;
  pageRange: string | null;
};

export type SavedDocExtractionRange = {
  sourceDocumentId: string;
  pageRange: string;
  extraction: DocExtraction;
  stats: ExtractDocumentStats;
  modelAlias: string;
};

export function savedRangeKeysByDocument(rangesPayload: unknown): Map<string, Set<string>> {
  const rows = Array.isArray((rangesPayload as { ranges?: unknown })?.ranges)
    ? ((rangesPayload as { ranges: Record<string, unknown>[] }).ranges ?? [])
    : [];
  const byDocument = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = typeof row.sourceDocumentId === "string" ? row.sourceDocumentId.toLowerCase() : "";
    const pageRange = typeof row.pageRange === "string" ? row.pageRange.toLowerCase() : "";
    if (!id || !pageRange) continue;
    const keys = byDocument.get(id) ?? new Set<string>();
    keys.add(pageRange);
    byDocument.set(id, keys);
  }
  return byDocument;
}

export function buildExtractWorkQueue(input: {
  snapshot: SourceSnapshot;
  extractedIds: ReadonlySet<string>;
  savedRangeKeysByDocument: ReadonlyMap<string, ReadonlySet<string>>;
}): ExtractWorkItem[] {
  const queue: ExtractWorkItem[] = [];
  for (const document of documentsNeedingExtraction(input.snapshot, input.extractedIds)) {
    const docKey = document.sourceDocumentId.toLowerCase();
    const saved = input.savedRangeKeysByDocument.get(docKey) ?? new Set<string>();
    const pageNumbers = Array.from(
      { length: document.verifiedPageCount },
      (_, index) => index + 1,
    );
    const pages = pageNumbers.map((pageNumber) => ({ pageNumber, text: "" }));
    for (const item of missingExtractWorkItems(pages, saved)) {
      queue.push({ document, pageRange: item.pageRange });
    }
  }
  return queue;
}

export function documentPagesFullyExtracted(
  verifiedPageCount: number,
  savedRangeKeys: ReadonlySet<string>,
): boolean {
  if (verifiedPageCount <= 0) return savedRangeKeys.size > 0;
  const covered = pagesCoveredBySavedRangeKeys(savedRangeKeys, verifiedPageCount);
  for (let page = 1; page <= verifiedPageCount; page += 1) {
    if (!covered.has(page)) return false;
  }
  return true;
}

async function recordExtractingDocumentSuccess(
  client: RpcClient,
  runId: string,
  metric: StageMetric,
  correlationId: string,
) {
  const payload = await rpc(client, "record_extracting_document_success", {
    p_run_id: runId,
    p_stage_metric: metric,
  });
  if (payload?.saved !== true) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "Analysis stopped before it finished. You can try again.",
      correlationId,
      diagnosticReason: "extracting_metric_save_failed",
    });
  }
}

export async function tryAdvanceExtractingToCanonicalizing(
  client: RpcClient,
  runId: string,
): Promise<{ applied: boolean; run: ProcessingRun | null }> {
  const payload = await rpc(client, "try_advance_extracting_to_canonicalizing", { p_run_id: runId });
  return {
    applied: payload?.applied === true,
    run: normalizeProcessingRun(payload?.processingRun),
  };
}

export class ExtractStageFailure extends Error {
  constructor(
    readonly error: HiveError,
    readonly metric: StageMetric | null,
  ) {
    super(error.errorCode);
  }
}

/**
 * Bounded worker pool: up to {@link EXTRACTING_CONCURRENCY} page-range jobs at once; each finished
 * slot takes the next missing (document, range) pair and persists range rows immediately.
 */
export async function runExtractingWorkerPool(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  workItems: readonly ExtractWorkItem[];
  catalog: PromptCatalog;
  correlationId: string;
  now: () => Date;
  clock: () => number;
  invocationStartedAt: number;
  extract?: typeof extractOneRange;
  canStart?: (clock: () => number, invocationStartedAt: number) => boolean;
}): Promise<{ deferred: boolean }> {
  const extract = input.extract ?? extractOneRange;
  const mayStart = input.canStart ?? canStartExtractingDocument;
  const queue = [...input.workItems];
  const attempts = new Map<string, number>();
  let failure: ExtractStageFailure | null = null;

  async function worker(): Promise<void> {
    while (!failure) {
      if (!mayStart(input.clock, input.invocationStartedAt)) return;
      const item = queue.shift();
      if (!item) return;
      const attemptKey = `${item.document.sourceDocumentId.toLowerCase()}:${pageRangeStorageKey(item.pageRange)}`;
      const attempt = (attempts.get(attemptKey) ?? 0) + 1;
      attempts.set(attemptKey, attempt);
      const outcome = await extract({
        deps: input.deps,
        run: input.run,
        workItem: item,
        catalog: input.catalog,
        correlationId: input.correlationId,
        stageAttempt: attempt,
        now: input.now,
        clock: input.clock,
        invocationStartedAt: input.invocationStartedAt,
      });
      if (outcome.ok) {
        if (outcome.documentMetric) {
          await recordExtractingDocumentSuccess(
            input.deps.client,
            input.run.id,
            outcome.documentMetric,
            input.correlationId,
          );
        }
        continue;
      }
      if (isRetryableExtractFailure(outcome.error) && attempt < EXTRACTING_ATTEMPT_LIMIT) {
        queue.push(item);
        continue;
      }
      failure = new ExtractStageFailure(outcome.error, outcome.metric);
      return;
    }
  }

  const workers = Array.from({ length: Math.min(EXTRACTING_CONCURRENCY, queue.length) }, () => worker());
  await Promise.all(workers);
  if (failure) throw failure;
  return { deferred: queue.length > 0 };
}

function logPipelineCall(input: {
  task: "extract" | "canonicalize" | "write";
  correlationId: string;
  hiveId: string;
  processingRunId: string;
  sourceDocumentId?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  finishReason: string | null;
  outcome: string;
  resolvedModel: string | null;
}) {
  emitStructuredEvent({
    eventName: "pipeline.model.completed",
    severity: "INFO",
    timestamp: new Date().toISOString(),
    component: "pipeline",
    operation: input.task,
    stage: "ANALYZE",
    correlationId: input.correlationId,
    hiveId: input.hiveId,
    processingRunId: input.processingRunId,
    task: input.task,
    inputCount: input.inputTokens ?? undefined,
    outputCount: input.outputTokens ?? undefined,
    durationMs: input.latencyMs ?? undefined,
    finishReason: input.finishReason ?? undefined,
    status: input.outcome,
    ...(input.sourceDocumentId ? { sourceDocumentId: input.sourceDocumentId } : {}),
    ...(input.resolvedModel ? { resolvedModel: input.resolvedModel } : {}),
  });
}

function aggregateExtractMetric(
  stageAttempt: number,
  prompt: { id: string; digest: string },
  calls: ExtractCallRecord[],
  modelAlias: string | null,
  startedAt: string,
  completedAt: string,
): StageMetric {
  const sum = (pick: (c: ExtractCallRecord) => number | null) =>
    calls.reduce((total, call) => total + (pick(call) ?? 0), 0);
  const last = calls[calls.length - 1];
  return {
    stage: "EXTRACTING",
    attempt: stageAttempt,
    outcome: "SUCCEEDED",
    promptId: prompt.id,
    promptDigest: prompt.digest,
    modelAliasRequested: modelAlias,
    resolvedModel: last?.resolvedModel ?? null,
    promptTokens: sum((c) => c.inputTokens),
    completionTokens: sum((c) => c.outputTokens),
    totalTokens: sum((c) => c.inputTokens) + sum((c) => c.outputTokens),
    latencyMs: sum((c) => c.latencyMs),
    finishReason: last?.finishReason ?? null,
    startedAt,
    completedAt,
  };
}

export async function loadDocumentPages(
  client: RpcClient,
  runId: string,
  document: SnapshotDocument,
  correlationId: string,
): Promise<{ pageNumber: number; text: string }[]> {
  const payload = await rpc(client, "get_study_source_pages", { p_run_id: runId });
  if (payload?.snapshotCurrent === false) {
    throw createHiveError({
      errorCode: "INTERNAL_ERROR",
      category: "VALIDATION",
      stage: "ANALYZE",
      retryable: true,
      safeMessage:
        "Your documents or request changed while analyzing. Analyze again to use the latest versions.",
      correlationId,
      diagnosticReason: "source_changed",
    });
  }
  const rows = Array.isArray(payload?.pages) ? (payload.pages as Record<string, unknown>[]) : [];
  const id = document.sourceDocumentId.toLowerCase();
  return rows
    .filter((row) => String(row.sourceDocumentId).toLowerCase() === id)
    .map((row) => ({ pageNumber: Number(row.pageNumber), text: String(row.pageText ?? "") }))
    .filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0)
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

export type ExtractOneDocumentResult =
  | { ok: true; metric: StageMetric; modelAlias: string }
  | { ok: false; error: HiveError; metric: StageMetric | null; calls: ExtractCallRecord[] };

export type ExtractOneRangeResult =
  | { ok: true; metric: StageMetric; modelAlias: string; documentMetric: StageMetric | null }
  | { ok: false; error: HiveError; metric: StageMetric | null; calls: ExtractCallRecord[] };

function rangeStatsPayload(stats: ExtractDocumentStats): ExtractDocumentStats {
  return stats;
}

async function persistExtractedRange(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  document: SnapshotDocument;
  catalog: PromptCatalog;
  pageRange: string | null;
  extraction: DocExtraction;
  stats: ExtractDocumentStats;
  modelAlias: string;
  correlationId: string;
}): Promise<HiveError | null> {
  const prompt = input.catalog.extract;
  const put = await rpc(input.deps.client, "put_doc_extraction_range", {
    p_hive_id: input.run.hiveId,
    p_source_document_id: input.document.sourceDocumentId,
    p_content_digest: input.document.pageSetDigest,
    p_page_range: pageRangeStorageKey(input.pageRange),
    p_prompt_id: prompt.id,
    p_prompt_digest: prompt.digest,
    p_model_alias: input.modelAlias,
    p_extraction: input.extraction,
    p_stats: rangeStatsPayload(input.stats),
  });
  if (!put) {
    return createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "Analysis stopped before it finished. You can try again.",
      correlationId: input.correlationId,
      diagnosticReason: "doc_extraction_range_save_failed",
    });
  }
  return null;
}

function aggregateDocumentStats(ranges: readonly ExtractDocumentStats[]): ExtractDocumentStats {
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
  for (const part of ranges) {
    stats.factsProposed += part.factsProposed;
    for (const [key, count] of Object.entries(part.malformed)) {
      stats.malformed[key] = (stats.malformed[key] ?? 0) + count;
    }
    stats.factsIn += part.factsIn;
    stats.factsKept += part.factsKept;
    stats.evidenceIn += part.evidenceIn;
    stats.evidenceDropped += part.evidenceDropped;
    for (const [key, count] of Object.entries(part.byReason) as [keyof typeof stats.byReason, number][]) {
      stats.byReason[key] = (stats.byReason[key] ?? 0) + count;
    }
    for (const key of ["emptyFields", "referencedDocuments", "documentEvidence"] as const) {
      stats[key].in += part[key].in;
      stats[key].kept += part[key].kept;
    }
    stats.dropped.push(...part.dropped);
    stats.ranges.push(...part.ranges);
    stats.pageExtractionGaps.push(...part.pageExtractionGaps);
  }
  return stats;
}

export async function tryMergeDocumentExtraction(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  document: SnapshotDocument;
  catalog: PromptCatalog;
  correlationId: string;
  stageAttempt: number;
  now: () => Date;
  savedRanges: readonly SavedDocExtractionRange[];
  calls: ExtractCallRecord[];
  modelAlias: string;
}): Promise<{ merged: boolean; metric: StageMetric | null }> {
  const savedKeys = new Set(input.savedRanges.map((row) => row.pageRange.toLowerCase()));
  if (!documentPagesFullyExtracted(input.document.verifiedPageCount, savedKeys)) {
    return { merged: false, metric: null };
  }
  const prompt = input.catalog.extract;
  const mergedExtraction = mergeSavedRangeExtractions(
    input.document.sourceDocumentId,
    input.savedRanges.map((row) => ({ pageRange: row.pageRange, extraction: row.extraction })),
    input.document.verifiedPageCount,
  );
  const mergedStats = aggregateDocumentStats(input.savedRanges.map((row) => row.stats));
  const put = await rpc(input.deps.client, "put_doc_extraction", {
    p_hive_id: input.run.hiveId,
    p_source_document_id: input.document.sourceDocumentId,
    p_content_digest: input.document.pageSetDigest,
    p_prompt_id: prompt.id,
    p_prompt_digest: prompt.digest,
    p_model_alias: input.modelAlias,
    p_extraction: mergedExtraction,
    p_stats: mergedStats,
  });
  if (!put) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "Analysis stopped before it finished. You can try again.",
      correlationId: input.correlationId,
      diagnosticReason: "doc_extraction_save_failed",
    });
  }
  const startedAt = input.now().toISOString();
  return {
    merged: true,
    metric: aggregateExtractMetric(
      input.stageAttempt,
      prompt,
      input.calls,
      input.modelAlias,
      startedAt,
      input.now().toISOString(),
    ),
  };
}

export async function loadSavedDocExtractionRanges(
  client: RpcClient,
  runId: string,
): Promise<SavedDocExtractionRange[]> {
  const payload = await rpc(client, "get_doc_extraction_ranges_for_run", { p_processing_run_id: runId });
  const rows = Array.isArray(payload?.ranges) ? (payload.ranges as Record<string, unknown>[]) : [];
  return rows
    .map((row) => ({
      sourceDocumentId: String(row.sourceDocumentId ?? "").toLowerCase(),
      pageRange: String(row.pageRange ?? "").toLowerCase(),
      extraction: row.extraction as DocExtraction,
      stats: (row.stats ?? {}) as ExtractDocumentStats,
      modelAlias: typeof row.modelAlias === "string" && row.modelAlias.length > 0 ? row.modelAlias : "harvester",
    }))
    .filter(
      (row): row is SavedDocExtractionRange =>
        !!row.sourceDocumentId &&
        !!row.pageRange &&
        row.extraction?.schema === "hive.doc-extraction/1",
    );
}

export async function extractOneRange(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  workItem: ExtractWorkItem;
  catalog: PromptCatalog;
  correlationId: string;
  stageAttempt: number;
  now: () => Date;
  clock?: () => number;
  invocationStartedAt?: number;
}): Promise<ExtractOneRangeResult> {
  const { deps, run, workItem, catalog, correlationId, stageAttempt, now } = input;
  const document = workItem.document;
  const clock = input.clock ?? deps.clock ?? (() => Date.now());
  const invocationStartedAt = input.invocationStartedAt ?? deps.invocationStartedAt ?? Date.now();
  const prompt = catalog.extract;
  const startedAt = now().toISOString();
  let pages: { pageNumber: number; text: string }[];
  try {
    pages = await loadDocumentPages(deps.client, run.id, document, correlationId);
  } catch {
    return {
      ok: false,
      calls: [],
      metric: null,
      error: createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "VALIDATION",
        stage: "ANALYZE",
        retryable: true,
        safeMessage:
          "Your documents or request changed while analyzing. Analyze again to use the latest versions.",
        correlationId,
        diagnosticReason: "source_changed",
      }),
    };
  }
  const rangePages = pages.filter((page) => {
    if (workItem.pageRange === null) return true;
    const match = /^(\d+)(?:-(\d+))?$/.exec(workItem.pageRange);
    if (!match) return false;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    return page.pageNumber >= start && page.pageNumber <= end;
  });
  let modelAlias = "harvester";
  const result = await extractScheduledRange({
    planner: deps.planner,
    document: { id: document.sourceDocumentId, fileName: document.fileName },
    pages: rangePages,
    correlationId,
    runId: run.id,
    prompt,
    range: { pageRange: workItem.pageRange, pages: rangePages },
    resolvePlannerTimeoutMs: () => extractPlannerTimeoutMs(clock, invocationStartedAt),
    persist: async ({ pageRange, extraction, stats, pageGaps, modelAlias: callModel }) => {
      if (callModel) modelAlias = callModel;
      const saveError = await persistExtractedRange({
        deps,
        run,
        document,
        catalog,
        pageRange,
        extraction,
        stats: { ...stats, ranges: [], pageExtractionGaps: pageGaps },
        modelAlias: callModel ?? modelAlias,
        correlationId,
      });
      if (saveError) throw saveError;
    },
  });
  for (const call of result.calls) {
    if (call.modelAlias) modelAlias = call.modelAlias;
    logPipelineCall({
      task: "extract",
      correlationId,
      hiveId: run.hiveId,
      processingRunId: run.id,
      sourceDocumentId: document.sourceDocumentId,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      latencyMs: call.latencyMs,
      finishReason: call.finishReason,
      outcome: call.outcome,
      resolvedModel: call.resolvedModel,
    });
  }
  if (!result.ok) {
    return { ok: false, error: result.error, calls: result.calls, metric: null };
  }
  const metric = aggregateExtractMetric(
    stageAttempt,
    prompt,
    result.calls,
    modelAlias,
    startedAt,
    now().toISOString(),
  );
  const savedRanges = (await loadSavedDocExtractionRanges(deps.client, run.id)).filter(
    (row) => row.sourceDocumentId === document.sourceDocumentId.toLowerCase(),
  );
  let documentMetric: StageMetric | null = null;
  try {
    const merged = await tryMergeDocumentExtraction({
      deps,
      run,
      document,
      catalog,
      correlationId,
      stageAttempt,
      now,
      savedRanges,
      calls: result.calls,
      modelAlias,
    });
    documentMetric = merged.metric;
  } catch (error) {
    if (error && typeof error === "object" && "errorCode" in error) {
      return { ok: false, error: error as HiveError, calls: result.calls, metric };
    }
    throw error;
  }
  return { ok: true, metric, modelAlias, documentMetric };
}

/** @deprecated Tests and legacy callers; production uses {@link extractOneRange}. */
export async function extractOneDocument(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  document: SnapshotDocument;
  catalog: PromptCatalog;
  correlationId: string;
  stageAttempt: number;
  now: () => Date;
  clock?: () => number;
  invocationStartedAt?: number;
}): Promise<ExtractOneDocumentResult> {
  const outcome = await extractOneRange({
    ...input,
    workItem: { document: input.document, pageRange: null },
  });
  if (!outcome.ok) return outcome;
  if (!outcome.documentMetric) {
    return {
      ok: false,
      calls: [],
      metric: outcome.metric,
      error: createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "VALIDATION",
        stage: "ANALYZE",
        retryable: true,
        safeMessage: "Analysis stopped before it finished. You can try again.",
        correlationId: input.correlationId,
        diagnosticReason: "doc_extraction_incomplete",
      }),
    };
  }
  return { ok: true, metric: outcome.documentMetric, modelAlias: outcome.modelAlias };
}

export async function loadVerifiedExtractions(client: RpcClient, runId: string): Promise<DocExtraction[]> {
  const payload = await rpc(client, "get_doc_extractions_for_run", { p_processing_run_id: runId });
  const rows = Array.isArray(payload?.extractions) ? (payload.extractions as Record<string, unknown>[]) : [];
  return rows
    .map((row) => row.extraction as DocExtraction | undefined)
    .filter((value): value is DocExtraction => !!value && value.schema === "hive.doc-extraction/1");
}

export type CanonicalizeRunResult =
  | { ok: true; study: CanonicalStudy; metric: StageMetric }
  | { ok: false; error: HiveError; metric: StageMetric | null };

export async function runCanonicalizeForRun(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  extractions: readonly DocExtraction[];
  catalog: PromptCatalog;
  correlationId: string;
  stageAttempt: number;
  now: () => Date;
  /** Rebuild Study: skip re-extract; re-run canonicalize only from cached extractions (cheap path). */
  rebuildMode?: boolean;
}): Promise<CanonicalizeRunResult> {
  void input.rebuildMode;
  const { deps, run, extractions, catalog, correlationId, stageAttempt, now } = input;
  const prompt = catalog.canonicalize;
  const startedAt = now().toISOString();
  const result = await canonicalizeCase({
    planner: deps.planner,
    extractions,
    correlationId,
    runId: run.id,
    prompt,
  });
  for (const call of result.calls) {
    logPipelineCall({
      task: "canonicalize",
      correlationId,
      hiveId: run.hiveId,
      processingRunId: run.id,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      latencyMs: call.latencyMs,
      finishReason: call.finishReason,
      outcome: call.outcome,
      resolvedModel: call.resolvedModel,
    });
  }
  if (!result.ok) {
    return { ok: false, error: result.error, metric: null };
  }
  const last = result.calls[result.calls.length - 1];
  const metric: StageMetric = {
    stage: "CANONICALIZING",
    attempt: stageAttempt,
    outcome: "SUCCEEDED",
    promptId: prompt.id,
    promptDigest: prompt.digest,
    modelAliasRequested: last?.resolvedModel ?? null,
    resolvedModel: last?.resolvedModel ?? null,
    promptTokens: result.calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
    completionTokens: result.calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
    totalTokens:
      result.calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0) +
      result.calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
    latencyMs: result.calls.reduce((n, c) => n + (c.latencyMs ?? 0), 0),
    finishReason: last?.finishReason ?? null,
    startedAt,
    completedAt: now().toISOString(),
  };
  return { ok: true, study: result.study, metric };
}

export function buildV5AcceptRevision(input: {
  study: CanonicalStudy;
  intents: readonly StoredIntent[];
  canonicalMetric: StageMetric | undefined;
  catalog: PromptCatalog;
}) {
  const investigationDigest = sha256Digest(canonicalJson(input.study));
  const canonicalMetric = input.canonicalMetric;
  return {
    format: "canonical-study-1",
    investigation: input.study,
    verification: {
      schema: STUDY_VERIFICATION_SCHEMA,
      counts: { documentFindings: 0, claims: 0 },
      findings: [],
      documentCoverage: [],
    },
    audience_configuration: resolveAudienceConfiguration({ analysis: null, intelligence: null }),
    investigation_digest: investigationDigest,
    prompt_digest: input.catalog.canonicalize.digest,
    model_alias: canonicalMetric?.modelAliasRequested ?? null,
    resolved_model: canonicalMetric?.resolvedModel ?? null,
  };
}

export function isV5CanonicalStudy(value: unknown): value is CanonicalStudy {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { schema?: unknown }).schema === CANONICAL_STUDY_SCHEMA &&
    Array.isArray((value as { documents?: unknown }).documents)
  );
}
