import {
  type CanonicalStudy,
  CANONICAL_STUDY_SCHEMA,
  cloudflareProxyLimitSuspect,
  computePlannerCallTimeoutMs,
  canStartPlannerCall,
  createHiveError,
  INVOCATION_MAX_DURATION_MS,
  decideExtractRangeFailureAction,
  documentPagesExtractedOrGapped,
  isTimeoutOrCutoffFailure,
  parsePageNumbersFromRangeKey,
  resolveExtractZeroProgressHandoffLimit,
  PAGE_EXTRACTION_GAP_DIAGNOSTIC,
  PAGE_EXTRACTION_GAP_ERROR_CODE,
  verifiedSavedRangeKeys,
  plannerCallDurationMs,
  splitExtractPageRangeLabel,
  type DocExtraction,
  estimateInputTokensFromPageText,
  estimateInputTokensFromUtf8Bytes,
  expectedOutputTokens,
  type HiveError,
  invocationRemainingMs,
  MIN_PLANNER_CALL_MS,
  normalizeProcessingRun,
  type PipelineThroughputStats,
  type ProcessingRun,
  type SnapshotDocument,
  type SourceSnapshot,
  type StageMetric,
  type StoredIntent,
  STUDY_VERIFICATION_SCHEMA,
  V5_CLIENT_TASK_TIMEOUT_MS,
  resolveAudienceConfiguration,
} from "@hiveforyou/contracts";
import { normalizeContentDigest } from "@hiveforyou/contracts/document-read";

import { emitStructuredEvent } from "@/server/observability/logger";
import { buildCanonicalizePayload, canonicalizeCase } from "@/server/pipeline/canonicalize-runner";
import {
  type ExtractCallRecord,
  type ExtractDocumentStats,
  buildPageExtractionGap,
  extractScheduledRange,
  mergeSavedRangeExtractions,
  missingExtractWorkItems,
  pageRangeStorageKey,
  pagesCoveredBySavedRangeKeys,
  parsePageRangeStorageKey,
  rangeLabel,
} from "@/server/pipeline/extract-runner";
import { refreshProcessingRunProgressEstimateInWorker } from "@/server/pipeline/progress-estimate-persistence";
import { loadPipelineThroughput, recordPipelineModelCall } from "@/server/pipeline/pipeline-throughput";
import { listDocumentPagesForSource } from "@/server/source-documents/document-pages-persistence";
import { sha256Digest } from "@/server/study-preparation/prompt-catalog";
import type { PromptCatalog } from "@/server/study-preparation/prompt-catalog";
import { canonicalJson } from "@/server/study-preparation/study-prompt-builder";

import {
  REPORT_ROUTE_MAX_DURATION_SECONDS,
} from "./report-generation";

import type { AnalysisWorkflowDeps } from "./analysis-workflow";

export { V5_CLIENT_TASK_TIMEOUT_MS };

/** Wall-clock end of the hosting function's `maxDuration` window for this invocation. */
export function analysisRouteDeadlineMs(invocationStartedAt: number): number {
  return invocationStartedAt + REPORT_ROUTE_MAX_DURATION_SECONDS * 1000;
}

/** Earliest timestamptz before which IN_FLIGHT rows from a prior worker are treated as invocation cut-offs. */
export function extractInFlightCutoffIso(
  nowMs: number,
  invocationStartedAt: number,
  leaseExpiresAtIso: string | null | undefined,
): string {
  const routeEndMs = invocationStartedAt + INVOCATION_MAX_DURATION_MS;
  let leaseEndMs = Number.POSITIVE_INFINITY;
  if (typeof leaseExpiresAtIso === "string" && leaseExpiresAtIso.length > 0) {
    const t = Date.parse(leaseExpiresAtIso);
    if (Number.isFinite(t)) leaseEndMs = t;
  }
  const cutoffMs = Math.min(routeEndMs, leaseEndMs);
  return new Date(Math.min(cutoffMs, nowMs)).toISOString();
}

export function extractPlannerTimeoutMs(
  clock: () => number,
  invocationStartedAt: number,
  expectedOutputTokens: number,
  throughput?: Partial<PipelineThroughputStats> | null,
): number | "expired" {
  const outputTokensPerSecond =
    typeof throughput?.outputTokensPerSecond === "number" &&
    Number.isFinite(throughput.outputTokensPerSecond) &&
    throughput.outputTokensPerSecond > 0
      ? throughput.outputTokensPerSecond
      : 100;
  return computePlannerCallTimeoutMs({
    expectedOutputTokens,
    outputTokensPerSecond,
    taskMaxMs: V5_CLIENT_TASK_TIMEOUT_MS,
    remainingInvocationMs: invocationRemainingMs(clock(), invocationStartedAt),
  });
}

/** Whether a worker may start another extract call in this invocation. */
export function canStartExtractingDocument(clock: () => number, invocationStartedAt: number): boolean {
  const remaining = invocationRemainingMs(clock(), invocationStartedAt);
  return canStartPlannerCall({
    remainingInvocationMs: remaining,
    callTimeoutMs: MIN_PLANNER_CALL_MS,
  });
}

function pageCountForWorkItem(pageRange: string | null, verifiedPageCount: number): number {
  if (pageRange === null) return verifiedPageCount;
  return parsePageRangeStorageKey(pageRangeStorageKey(pageRange), verifiedPageCount).length;
}

function expectedExtractOutputTokens(
  pages: readonly { pageNumber: number; text: string }[],
  throughput: PipelineThroughputStats,
): number {
  const inputTokens = pages.reduce(
    (total, page) => total + estimateInputTokensFromPageText(page.text, throughput.inputTokensPerPage),
    0,
  );
  return expectedOutputTokens(inputTokens, throughput.outputInputRatio);
}

/** Max concurrent `hive-extract/1` calls while a run is in EXTRACTING (bounded fan-out). */
export const EXTRACTING_CONCURRENCY = 4;

const EXTRACT_RETRYABLE_ERRORS = new Set(["MODEL_TIMEOUT", "MODEL_UNAVAILABLE"]);

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
  /** EXTRACTING hand-offs that deferred with no new saved range rows (see resolveExtractZeroProgressHandoffLimit). */
  extractZeroProgressHandoffs?: number | { count: number };
  /** Cached extractions with pageExtractionGaps: gap pages were retried once this run. */
  extractGapRetryCompleted?: Record<string, boolean>;
};

const TRUNCATION_GAP_DIAGNOSTIC = "model_output_truncated";

function countedPlannerAttemptsForRange(outcome: ExtractOneRangeResult): number {
  if (outcome.ok || outcome.callsStarted === 0) return 0;
  const failedCalls = outcome.calls.filter((call) => call.outcome === "failed").length;
  return failedCalls > 0 ? failedCalls : 1;
}

export function extractionCacheKey(
  document: SnapshotDocument,
  prompt: { id: string; digest: string },
  modelAlias: string,
) {
  return `${document.sourceDocumentId}:${document.pageSetDigest}:${prompt.digest}:${modelAlias}`;
}

function cachedExtractionStats(extractionsPayload: unknown, documentId: string): Record<string, unknown> | null {
  const rows = Array.isArray((extractionsPayload as { extractions?: unknown })?.extractions)
    ? ((extractionsPayload as { extractions: Record<string, unknown>[] }).extractions ?? [])
    : [];
  const docKey = documentId.toLowerCase();
  const row = rows.find((entry) => String(entry.sourceDocumentId ?? "").toLowerCase() === docKey);
  const stats = row?.stats;
  return stats && typeof stats === "object" && !Array.isArray(stats) ? (stats as Record<string, unknown>) : null;
}

function cachedExtractionHasPendingGaps(stats: Record<string, unknown> | null): boolean {
  const gaps = stats?.pageExtractionGaps;
  return Array.isArray(gaps) && gaps.length > 0;
}

function pagesReadFromCachedExtraction(extraction: DocExtraction): Set<number> {
  const read = new Set(
    extraction.coverage.pagesRead.filter((page) => Number.isInteger(page) && page > 0),
  );
  if (read.size === 0) {
    for (const fact of extraction.facts ?? []) {
      for (const evidence of fact.evidence ?? []) {
        if (Number.isInteger(evidence.page) && evidence.page > 0) read.add(evidence.page);
      }
    }
  }
  return read;
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

/**
 * Extractions that are complete for this run per TypeScript coverage rules (not raw SQL row count).
 * Skips cached rows whose stats still list pageExtractionGaps until one gap retry pass completed.
 */
export async function completeExtractedDocumentIds(input: {
  client: RpcClient;
  runId: string;
  snapshot: SourceSnapshot;
  extractionsPayload: unknown;
  extractProgress?: Pick<V5StageOutputs, "extractGapRetryCompleted">;
}): Promise<Set<string>> {
  const base = extractedDocumentIds(input.extractionsPayload);
  if (base.size === 0) return base;
  const gapPagesByDocument = await loadDocExtractionGapPagesForRun(input.client, input.runId);
  const savedRanges = await loadSavedDocExtractionRanges(input.client, input.runId);
  const complete = new Set<string>();
  const gapRetryDone = input.extractProgress?.extractGapRetryCompleted ?? {};
  for (const document of input.snapshot.documents) {
    const docKey = document.sourceDocumentId.toLowerCase();
    if (!base.has(docKey)) continue;
    const stats = cachedExtractionStats(input.extractionsPayload, docKey);
    if (cachedExtractionHasPendingGaps(stats) && gapRetryDone[docKey] !== true) continue;
    const docRanges = savedRanges.filter((row) => row.sourceDocumentId === docKey);
    let savedKeys = verifiedSavedRangeKeys(
      docRanges.map((row) => ({ pageRange: row.pageRange, extraction: row.extraction })),
      document.verifiedPageCount,
    );
    const rows = Array.isArray((input.extractionsPayload as { extractions?: unknown })?.extractions)
      ? ((input.extractionsPayload as { extractions: Record<string, unknown>[] }).extractions ?? [])
      : [];
    const cachedRow = rows.find((row) => String(row.sourceDocumentId ?? "").toLowerCase() === docKey);
    const cachedExtraction = cachedRow?.extraction as DocExtraction | undefined;
    const gapPages = gapPagesByDocument.get(docKey) ?? new Set<number>();
    if (docRanges.length === 0 && stats) {
      const fromStats = (stats.pageExtractionGaps ?? []) as unknown[];
      for (const page of fromStats) {
        if (typeof page === "number" && Number.isInteger(page) && page > 0) gapPages.add(page);
      }
    }
    if (docRanges.length === 0 && cachedExtraction?.schema === "hive.doc-extraction/1") {
      for (const page of pagesReadFromCachedExtraction(cachedExtraction)) savedKeys.add(String(page));
      for (const page of gapPages) savedKeys.add(String(page));
    } else if (savedKeys.size === 0 && cachedExtraction?.schema === "hive.doc-extraction/1") {
      savedKeys = verifiedSavedRangeKeys([{ pageRange: "all", extraction: cachedExtraction }], document.verifiedPageCount);
    }
    if (documentPagesFullyExtracted(document.verifiedPageCount, savedKeys, gapPages)) {
      complete.add(docKey);
    }
  }
  return complete;
}

export async function persistV5ExtractStageOutputs(
  client: RpcClient,
  runId: string,
  patch: Pick<V5StageOutputs, "extractZeroProgressHandoffs" | "extractGapRetryCompleted">,
): Promise<void> {
  await rpc(client, "transition_processing_run", {
    p_run_id: runId,
    p_from_status: "EXTRACTING",
    p_to_status: "EXTRACTING",
    p_details: {
      stage_outputs: {
        ...(typeof patch.extractZeroProgressHandoffs === "number"
          ? { extractZeroProgressHandoffs: { count: patch.extractZeroProgressHandoffs } }
          : {}),
        ...(patch.extractGapRetryCompleted ? { extractGapRetryCompleted: patch.extractGapRetryCompleted } : {}),
      },
    },
  });
}

export function readExtractZeroProgressHandoffCount(stageOutputs: V5StageOutputs | undefined): number {
  const raw = stageOutputs?.extractZeroProgressHandoffs;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { count?: unknown }).count === "number") {
    const count = (raw as { count: number }).count;
    return Number.isInteger(count) && count >= 0 ? count : 0;
  }
  return 0;
}

export async function recordGapsForWorkItems(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  workItems: readonly ExtractWorkItem[];
  catalog: PromptCatalog;
  correlationId: string;
  now: () => Date;
}): Promise<void> {
  for (const workItem of input.workItems) {
    const gapOutcome = await extractOneRangeGap({
      deps: input.deps,
      run: input.run,
      workItem,
      catalog: input.catalog,
      correlationId: input.correlationId,
      stageAttempt: input.run.stageAttempt,
      now: input.now,
    });
    if (gapOutcome.ok && gapOutcome.documentMetric) {
      await recordExtractingDocumentSuccess(input.deps.client, input.run.id, gapOutcome.documentMetric, input.correlationId);
    }
  }
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
  timeoutOrCutoffAttempts?: number;
  /** Failed planner HTTP attempts persisted for this (run, document, page range, prompt); carries across splits. */
  totalAttempts?: number;
};

export type DocExtractionAttemptTotalsRow = {
  sourceDocumentId: string;
  contentDigest: string;
  pageRange: string;
  promptDigest: string;
  failedAttemptCount: number;
  cutoffOrTimeoutCount: number;
};

function extractAttemptTotalsKey(input: {
  sourceDocumentId: string;
  contentDigest: string;
  pageRange: string;
  promptDigest: string;
}): string {
  return [
    input.sourceDocumentId.toLowerCase(),
    input.contentDigest.toLowerCase(),
    input.pageRange.toLowerCase(),
    input.promptDigest.toLowerCase(),
  ].join(":");
}

export async function loadDocExtractionAttemptTotalsForRun(
  client: RpcClient,
  runId: string,
): Promise<Map<string, DocExtractionAttemptTotalsRow>> {
  const payload = await rpc(client, "get_doc_extraction_attempt_totals_for_run", { p_processing_run_id: runId });
  const rows = Array.isArray((payload as { totals?: unknown })?.totals)
    ? ((payload as { totals: Record<string, unknown>[] }).totals ?? [])
    : [];
  const map = new Map<string, DocExtractionAttemptTotalsRow>();
  for (const row of rows) {
    const sourceDocumentId = String(row.sourceDocumentId ?? "").toLowerCase();
    const contentDigest = String(row.contentDigest ?? "").toLowerCase();
    const pageRange = String(row.pageRange ?? "").toLowerCase();
    const promptDigest = String(row.promptDigest ?? "").toLowerCase();
    if (!sourceDocumentId || !contentDigest || !pageRange || !promptDigest) continue;
    map.set(extractAttemptTotalsKey({ sourceDocumentId, contentDigest, pageRange, promptDigest }), {
      sourceDocumentId,
      contentDigest,
      pageRange,
      promptDigest,
      failedAttemptCount: Number(row.failedAttemptCount) || 0,
      cutoffOrTimeoutCount: Number(row.cutoffOrTimeoutCount) || 0,
    });
  }
  return map;
}

export type SavedDocExtractionRange = {
  sourceDocumentId: string;
  pageRange: string;
  extraction: DocExtraction;
  stats: ExtractDocumentStats;
  modelAlias: string;
};

export function buildSavedRangeKeysByDocument(
  savedRanges: readonly SavedDocExtractionRange[],
  snapshot: SourceSnapshot,
): Map<string, Set<string>> {
  const pageCounts = new Map(snapshot.documents.map((doc) => [doc.sourceDocumentId.toLowerCase(), doc.verifiedPageCount]));
  const byDocument = new Map<string, Set<string>>();
  for (const row of savedRanges) {
    const docKey = row.sourceDocumentId.toLowerCase();
    const pageCount = pageCounts.get(docKey) ?? 0;
    const keys = verifiedSavedRangeKeys([{ pageRange: row.pageRange, extraction: row.extraction }], pageCount);
    if (keys.size === 0) continue;
    const existing = byDocument.get(docKey) ?? new Set<string>();
    for (const key of keys) existing.add(key);
    byDocument.set(docKey, existing);
  }
  return byDocument;
}

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

export async function buildExtractWorkQueue(input: {
  client: RpcClient;
  hiveId: string;
  runId: string;
  snapshot: SourceSnapshot;
  extractedIds: ReadonlySet<string>;
  savedRangeKeysByDocument: ReadonlyMap<string, ReadonlySet<string>>;
  correlationId: string;
  catalog: PromptCatalog;
  throughput?: PipelineThroughputStats;
  extractProgress?: Pick<V5StageOutputs, "extractGapRetryCompleted">;
}): Promise<ExtractWorkItem[]> {
  const throughput = input.throughput ?? (await loadPipelineThroughput(input.client, "extract"));
  const promptDigest = input.catalog.extract.digest;
  const attemptTotals = await loadDocExtractionAttemptTotalsForRun(input.client, input.runId);
  const gapPagesByDocument = await loadDocExtractionGapPagesForRun(input.client, input.runId);
  const extractionsPayload = await rpc(input.client, "get_doc_extractions_for_run", { p_processing_run_id: input.runId });
  const queue: ExtractWorkItem[] = [];
  for (const document of documentsNeedingExtraction(input.snapshot, input.extractedIds)) {
    const docKey = document.sourceDocumentId.toLowerCase();
    const saved = input.savedRangeKeysByDocument.get(docKey) ?? new Set<string>();
    const pages = await loadDocumentPages({
      client: input.client,
      hiveId: input.hiveId,
      runId: input.runId,
      document,
      correlationId: input.correlationId,
    });
    const contentDigest = normalizeContentDigest(document.pageSetDigest) ?? document.pageSetDigest.toLowerCase();
    const persistedGapPages = gapPagesByDocument.get(docKey) ?? new Set<number>();
    const gapRetryDone = input.extractProgress?.extractGapRetryCompleted?.[docKey] === true;
    const stats = cachedExtractionStats(extractionsPayload, docKey);
    const retryGapPages = new Set<number>();
    if (!gapRetryDone && cachedExtractionHasPendingGaps(stats)) {
      for (const page of (stats?.pageExtractionGaps ?? []) as unknown[]) {
        if (typeof page === "number" && Number.isInteger(page) && page > 0) retryGapPages.add(page);
      }
    }
    const effectiveSaved = new Set([...saved]);
    for (const page of persistedGapPages) effectiveSaved.add(String(page));
    const queuedKeys = new Set<string>();
    const pushItem = (pageRange: string | null) => {
      const pageRangeKey = pageRangeStorageKey(pageRange).toLowerCase();
      if (queuedKeys.has(pageRangeKey)) return;
      queuedKeys.add(pageRangeKey);
      const totalsKey = extractAttemptTotalsKey({
        sourceDocumentId: docKey,
        contentDigest,
        pageRange: pageRangeKey,
        promptDigest,
      });
      const totals = attemptTotals.get(totalsKey);
      queue.push({
        document,
        pageRange,
        timeoutOrCutoffAttempts: totals?.cutoffOrTimeoutCount ?? 0,
        totalAttempts: totals?.failedAttemptCount ?? 0,
      });
    };
    for (const item of missingExtractWorkItems(pages, effectiveSaved, throughput)) {
      pushItem(item.pageRange);
    }
    for (const page of retryGapPages) {
      if (persistedGapPages.has(page)) continue;
      pushItem(String(page));
    }
  }
  return queue;
}

export function documentPagesFullyExtracted(
  verifiedPageCount: number,
  savedRangeKeys: ReadonlySet<string>,
  gapPageNumbers: ReadonlySet<number> = new Set(),
): boolean {
  return documentPagesExtractedOrGapped(verifiedPageCount, savedRangeKeys, gapPageNumbers);
}

export async function loadDocExtractionGapPagesForRun(
  client: RpcClient,
  runId: string,
): Promise<Map<string, Set<number>>> {
  const { data, error } = await client.rpc("get_doc_extraction_gap_pages_for_run", { p_processing_run_id: runId });
  if (error) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "Analysis stopped before it finished. You can try again.",
      correlationId: runId,
      diagnosticReason: "doc_extraction_gap_pages_load_failed",
      diagnosticField: error.message ?? "rpc_failed",
    });
  }
  const payload = parsePayload(data);
  const rows = Array.isArray(payload?.gaps) ? (payload.gaps as Record<string, unknown>[]) : [];
  const byDocument = new Map<string, Set<number>>();
  for (const row of rows) {
    const id = typeof row.sourceDocumentId === "string" ? row.sourceDocumentId.toLowerCase() : "";
    if (!id) continue;
    const pageRangeRaw =
      typeof row.pageRange === "string"
        ? row.pageRange
        : row.pageNumber !== undefined && row.pageNumber !== null
          ? String(row.pageNumber)
          : "";
    const pageRange = pageRangeRaw.trim().toLowerCase();
    if (!pageRange) continue;
    const pageNumbers = parsePageNumbersFromRangeKey(pageRange, 0);
    if (pageNumbers.length === 0) continue;
    const pages = byDocument.get(id) ?? new Set<number>();
    for (const pageNumber of pageNumbers) pages.add(pageNumber);
    byDocument.set(id, pages);
  }
  return byDocument;
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
  sourceSnapshot: SourceSnapshot;
  workItems: readonly ExtractWorkItem[];
  catalog: PromptCatalog;
  correlationId: string;
  now: () => Date;
  clock: () => number;
  invocationStartedAt: number;
  extract?: typeof extractOneRange;
  canStart?: (clock: () => number, invocationStartedAt: number) => boolean;
  throughput?: PipelineThroughputStats;
}): Promise<{ deferred: boolean }> {
  const extract = input.extract ?? extractOneRange;
  const mayStart = input.canStart ?? canStartExtractingDocument;
  const throughput = input.throughput ?? (await loadPipelineThroughput(input.deps.client, "extract"));
  const queue = [...input.workItems];
  let failure: ExtractStageFailure | null = null;
  let activeWorkers = 0;
  const inFlightByDocument = new Map<string, number>();
  const documentConcurrencyLimit = new Map<string, number>();
  const documentFailedExtractCallsThisInvocation = new Map<string, number>();
  const documentConcurrencyReduced = new Set<string>();

  function documentKey(document: SnapshotDocument): string {
    return document.sourceDocumentId.toLowerCase();
  }

  function maxConcurrencyForDocument(docKey: string): number {
    return documentConcurrencyLimit.get(docKey) ?? EXTRACTING_CONCURRENCY;
  }

  function takeNextWorkItem(): ExtractWorkItem | undefined {
    if (queue.length === 0) return undefined;
    let bestIndex = -1;
    let bestInFlight = Number.POSITIVE_INFINITY;
    for (let index = 0; index < queue.length; index += 1) {
      const candidate = queue[index]!;
      const docKey = documentKey(candidate.document);
      const inFlight = inFlightByDocument.get(docKey) ?? 0;
      const limit = maxConcurrencyForDocument(docKey);
      if (inFlight >= limit) continue;
      if (inFlight < bestInFlight) {
        bestInFlight = inFlight;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return undefined;
    const [item] = queue.splice(bestIndex, 1);
    return item;
  }

  const inFlightCutoffIso = extractInFlightCutoffIso(
    input.clock(),
    input.invocationStartedAt,
    input.run.leaseExpiresAt,
  );
  {
    const { error } = await input.deps.client.rpc("fail_stale_in_flight_doc_extraction_attempts", {
      p_processing_run_id: input.run.id,
      p_this_invocation_started_at: new Date(input.invocationStartedAt).toISOString(),
      p_diagnostic_reason: "invocation_ended",
    });
    if (error) {
      emitStructuredEvent({
        eventName: "pipeline.extract.stale_repair_failed",
        severity: "ERROR",
        timestamp: new Date().toISOString(),
        component: "pipeline",
        operation: "extract",
        stage: "ANALYZE",
        correlationId: input.correlationId,
        processingRunId: input.run.id,
        hiveId: input.run.hiveId,
        task: "extract",
        errorCode: error.code ?? "rpc_failed",
        diagnosticReason: "extract_stale_in_flight_repair_failed",
        diagnosticField: JSON.stringify({ message: error.message ?? "rpc_failed" }),
      });
    }
  }

  let plannerHttpCallsStarted = 0;
  let plannerCallLedgerRows = 0;

  emitStructuredEvent({
    eventName: "pipeline.extract.extracting_invocation_start",
    severity: "INFO",
    timestamp: new Date().toISOString(),
    component: "pipeline",
    operation: "extract",
    stage: "ANALYZE",
    correlationId: input.correlationId,
    processingRunId: input.run.id,
    hiveId: input.run.hiveId,
    task: "extract",
    durationMs: Math.max(0, Math.trunc(input.clock() - input.invocationStartedAt)),
    diagnosticReason: "extracting_invocation_boundary",
    diagnosticField: JSON.stringify({
      vercelMaxDurationSeconds: REPORT_ROUTE_MAX_DURATION_SECONDS,
      leaseExpiresAt: input.run.leaseExpiresAt ?? null,
      inFlightCutoffIso,
      staleRepair: "fail_stale_in_flight_doc_extraction_attempts",
    }),
  });

  function maybeReduceExtractConcurrency(docKey: string): void {
    if (documentConcurrencyReduced.has(docKey)) return;
    const n = (documentFailedExtractCallsThisInvocation.get(docKey) ?? 0) + 1;
    documentFailedExtractCallsThisInvocation.set(docKey, n);
    if (n < 2) return;
    documentConcurrencyLimit.set(docKey, 1);
    documentConcurrencyReduced.add(docKey);
    emitStructuredEvent({
      eventName: "pipeline.extract.adaptive_concurrency",
      severity: "INFO",
      timestamp: new Date().toISOString(),
      component: "pipeline",
      operation: "extract",
      stage: "ANALYZE",
      correlationId: input.correlationId,
      processingRunId: input.run.id,
      hiveId: input.run.hiveId,
      task: "extract",
      diagnosticReason: "extract_adaptive_concurrency",
    });
  }

  async function worker(): Promise<void> {
    while (!failure) {
      if (!mayStart(input.clock, input.invocationStartedAt)) return;
      const item = takeNextWorkItem();
      if (!item) return;
      const docKey = documentKey(item.document);
      const persistedFailedAttempts = item.totalAttempts ?? 0;
      const stageAttempt = input.run.stageAttempt;
      inFlightByDocument.set(docKey, (inFlightByDocument.get(docKey) ?? 0) + 1);
      activeWorkers += 1;
      const concurrencyAtStart = activeWorkers;
      const outcome = await extract({
        deps: input.deps,
        run: input.run,
        workItem: item,
        catalog: input.catalog,
        correlationId: input.correlationId,
        stageAttempt,
        now: input.now,
        clock: input.clock,
        invocationStartedAt: input.invocationStartedAt,
        throughput,
        concurrencyAtStart,
      });
      plannerHttpCallsStarted += outcome.callsStarted;
      plannerCallLedgerRows += outcome.ok ? outcome.callsStarted : outcome.calls.length;
      inFlightByDocument.set(docKey, Math.max(0, (inFlightByDocument.get(docKey) ?? 1) - 1));
      activeWorkers -= 1;
      if (outcome.ok) {
        if (outcome.documentMetric) {
          await recordExtractingDocumentSuccess(
            input.deps.client,
            input.run.id,
            outcome.documentMetric,
            input.correlationId,
          );
        }
        await refreshProcessingRunProgressEstimateInWorker(input.deps.client, {
          run: input.run,
          snapshot: input.sourceSnapshot,
          correlationId: input.correlationId,
          clock: input.clock,
        }).catch(() => null);
        continue;
      }
      const lastCall = outcome.calls[outcome.calls.length - 1];
      const invocationBudgetAbort =
        lastCall?.abortedByOurDeadline === true || outcome.error.diagnosticReason === "invocation_deadline_abort";
      const cutoffFailure = isTimeoutOrCutoffFailure({
        errorCode: outcome.error.errorCode,
        diagnosticReason: outcome.error.diagnosticReason ?? lastCall?.diagnosticReason ?? null,
        abortedByInvocationDeadline: lastCall?.abortedByOurDeadline,
      });
      const failedPlannerAttemptsThisExtract = countedPlannerAttemptsForRange(outcome);
      if (invocationBudgetAbort && outcome.callsStarted === 0) {
        queue.push({ ...item, timeoutOrCutoffAttempts: item.timeoutOrCutoffAttempts ?? 0, totalAttempts: persistedFailedAttempts });
        continue;
      }
      const totalFailedAttemptsForRange = persistedFailedAttempts + failedPlannerAttemptsThisExtract;
      if (failedPlannerAttemptsThisExtract > 0) {
        maybeReduceExtractConcurrency(docKey);
      }
      const pageCount = pageCountForWorkItem(item.pageRange, item.document.verifiedPageCount);
      const timeoutOrCutoffAttempts = (item.timeoutOrCutoffAttempts ?? 0) + (cutoffFailure ? 1 : 0);
      const truncationGap =
        outcome.error.errorCode === "MODEL_OUTPUT_INVALID" && outcome.error.diagnosticReason === TRUNCATION_GAP_DIAGNOSTIC;
      const action = decideExtractRangeFailureAction({
        pageCount,
        timeoutOrCutoffAttempts,
        totalAttempts: totalFailedAttemptsForRange,
        retryable: isRetryableExtractFailure(outcome.error),
        truncationGap,
      });
      if (action === "record_gap") {
        const gapOutcome = await extractOneRangeGap({
          deps: input.deps,
          run: input.run,
          workItem: item,
          catalog: input.catalog,
          correlationId: input.correlationId,
          stageAttempt: input.run.stageAttempt,
          now: input.now,
        });
        if (gapOutcome.ok && gapOutcome.documentMetric) {
          await recordExtractingDocumentSuccess(
            input.deps.client,
            input.run.id,
            gapOutcome.documentMetric,
            input.correlationId,
          );
        }
        await refreshProcessingRunProgressEstimateInWorker(input.deps.client, {
          run: input.run,
          snapshot: input.sourceSnapshot,
          correlationId: input.correlationId,
          clock: input.clock,
        }).catch(() => null);
        continue;
      }
      if (action === "split") {
        const split = splitExtractPageRangeLabel(item.pageRange, item.document.verifiedPageCount);
        if (split) {
          const [left, right] = split;
          queue.unshift(
            { document: item.document, pageRange: right, timeoutOrCutoffAttempts: 0, totalAttempts: 0 },
            { document: item.document, pageRange: left, timeoutOrCutoffAttempts: 0, totalAttempts: 0 },
          );
          continue;
        }
      }
      if (action === "retry") {
        queue.push({
          ...item,
          timeoutOrCutoffAttempts,
          totalAttempts: totalFailedAttemptsForRange,
        });
        continue;
      }
      failure = new ExtractStageFailure(outcome.error, outcome.metric);
      return;
    }
  }

  const workers = Array.from({ length: Math.min(EXTRACTING_CONCURRENCY, queue.length) }, () => worker());
  await Promise.all(workers);
  if (failure) throw failure;
  const deferred = queue.length > 0;
  const elapsedMs = Math.max(0, Math.trunc(input.clock() - input.invocationStartedAt));
  const callsInFlightUnaccounted =
    plannerHttpCallsStarted > plannerCallLedgerRows
      ? plannerHttpCallsStarted - plannerCallLedgerRows
      : 0;
  emitStructuredEvent({
    eventName: "pipeline.extract.extracting_invocation_end",
    severity: "INFO",
    timestamp: new Date().toISOString(),
    component: "pipeline",
    operation: "extract",
    stage: "ANALYZE",
    correlationId: input.correlationId,
    processingRunId: input.run.id,
    hiveId: input.run.hiveId,
    task: "extract",
    durationMs: elapsedMs,
    diagnosticReason: "extracting_invocation_boundary",
    diagnosticField: JSON.stringify({
      vercelMaxDurationSeconds: REPORT_ROUTE_MAX_DURATION_SECONDS,
      stageLeaseSeconds: 300,
      leaseExpiresAt: input.run.leaseExpiresAt ?? null,
      inFlightCutoffIso,
      plannerHttpCallsStarted,
      plannerCallLedgerRowsFinished: plannerCallLedgerRows,
      deferred,
      remainingWorkItems: queue.length,
      ...(deferred && queue.length > 0 ? { extractionEndedWithQueuedWorkRemaining: true } : {}),
      ...(callsInFlightUnaccounted > 0
        ? { extractionEndedWithCallsPossiblyStillInFlight: true, callsInFlightUnaccounted }
        : {}),
    }),
  });
  return { deferred };
}

async function logPipelineCall(input: {
  client: RpcClient;
  task: "extract" | "canonicalize" | "write";
  correlationId: string;
  hiveId: string;
  processingRunId: string;
  sourceDocumentId?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  roundTripMs?: number | null;
  finishReason: string | null;
  outcome: string;
  resolvedModel: string | null;
  concurrencyAtStart?: number;
  pageRange?: string | null;
  pageCount?: number | null;
  inputChars?: number | null;
  errorCode?: string | null;
  diagnosticReason?: string | null;
  httpStatus?: number | null;
  abortedByOurDeadline?: boolean;
  callStartedAt?: string;
  rangeAttempt?: number;
  attempt?: number;
}) {
  const durationMs = plannerCallDurationMs({
    roundTripMs: input.roundTripMs ?? input.latencyMs ?? 0,
    latencyMs: input.latencyMs,
  });
  const failed = input.outcome !== "ok";
  const cfSuspect = failed && cloudflareProxyLimitSuspect(durationMs);
  const errorDetailParts: string[] = [];
  if (failed && input.abortedByOurDeadline) errorDetailParts.push("aborted_by_our_deadline");
  if (cfSuspect) errorDetailParts.push("cloudflare_proxy_limit_suspect");
  emitStructuredEvent({
    eventName: failed ? "pipeline.model.failed" : "pipeline.model.completed",
    severity: failed ? "ERROR" : "INFO",
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
    durationMs,
    finishReason: input.finishReason ?? undefined,
    status: input.outcome,
    ...(input.sourceDocumentId ? { sourceDocumentId: input.sourceDocumentId } : {}),
    ...(input.resolvedModel ? { resolvedModel: input.resolvedModel } : {}),
    ...(input.pageRange ? { pageRange: input.pageRange } : {}),
    ...(typeof input.inputChars === "number" ? { inputChars: input.inputChars } : {}),
    ...(failed && input.errorCode ? { errorCode: input.errorCode, retryable: true } : {}),
    ...(failed && input.diagnosticReason ? { diagnosticReason: input.diagnosticReason } : {}),
    ...(failed && input.httpStatus != null ? { httpStatus: input.httpStatus } : {}),
    ...(failed && input.callStartedAt ? { callStartedAt: input.callStartedAt } : {}),
    ...(failed && input.rangeAttempt != null ? { rangeAttempt: input.rangeAttempt } : {}),
    ...(failed && input.attempt != null ? { attempt: input.attempt } : {}),
    ...(failed && input.abortedByOurDeadline != null ? { abortedByOurDeadline: input.abortedByOurDeadline } : {}),
    ...(failed && errorDetailParts.length > 0 ? { errorDetail: errorDetailParts.join(";") } : {}),
  });
  if (
    input.outcome === "ok" &&
    input.inputTokens !== null &&
    input.outputTokens !== null &&
    input.latencyMs !== null &&
    input.concurrencyAtStart !== undefined
  ) {
    try {
      await recordPipelineModelCall(input.client, {
        runId: input.processingRunId,
        task: input.task,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
        concurrencyAtStart: input.concurrencyAtStart,
        pageRange: input.pageRange ?? null,
        pageCount: input.pageCount ?? null,
      });
    } catch {
      // Throughput samples are best-effort; a failed insert must not stop extraction.
    }
  }
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

function isStoredPageTextEmpty(text: string): boolean {
  return text.trim().length === 0;
}

function supabaseErrorFields(error: { code?: string; message?: string } | null): { code: string; message: string } {
  return { code: error?.code ?? "unknown", message: error?.message ?? "rpc_failed" };
}

export async function loadDocumentPages(input: {
  client: RpcClient;
  hiveId: string;
  runId: string;
  document: SnapshotDocument;
  correlationId: string;
}): Promise<{ pageNumber: number; text: string }[]> {
  const { client, hiveId, runId, document, correlationId } = input;
  const snapshotPayload = await rpc(client, "get_study_source_pages", { p_run_id: runId });
  if (snapshotPayload?.snapshotCurrent === false) {
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
  const pageSetDigest = normalizeContentDigest(document.pageSetDigest);
  if (!pageSetDigest) {
    throw createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "The document page generation digest is invalid.",
      correlationId,
      diagnosticReason: "page_set_digest_mismatch",
    });
  }
  const listed = await listDocumentPagesForSource(client, {
    hiveId,
    sourceDocumentId: document.sourceDocumentId,
    readFingerprint: document.readFingerprint,
    pageSetDigest,
    expectedSourceSha256: document.sha256,
    correlationId,
  });
  if (!listed.found || listed.pages.length === 0) {
    emitStructuredEvent({
      eventName: "pipeline.extract.pages_missing",
      severity: "ERROR",
      timestamp: new Date().toISOString(),
      component: "pipeline",
      operation: "extract",
      stage: "ANALYZE",
      correlationId,
      processingRunId: runId,
      hiveId,
      sourceDocumentId: document.sourceDocumentId,
      task: "extract",
      diagnosticReason: "extract_pages_missing",
      diagnosticField: JSON.stringify({
        hiveId,
        sourceDocumentId: document.sourceDocumentId,
        readFingerprint: document.readFingerprint,
        pageSetDigest: document.pageSetDigest,
        sourceSha256: document.sha256,
        verifiedPageCount: document.verifiedPageCount,
      }),
    });
    throw createHiveError({
      errorCode: "COVERAGE_INCOMPLETE",
      category: "DOCUMENT",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "A document in this analysis has no saved page text. Analyze again after reading completes.",
      correlationId,
      diagnosticReason: "extract_pages_missing",
    });
  }
  if (listed.pages.length !== document.verifiedPageCount) {
    const missing: number[] = [];
    const textByPage = new Map(listed.pages.map((row) => [row.page_number, row.page_text]));
    for (let pageNumber = 1; pageNumber <= document.verifiedPageCount; pageNumber += 1) {
      if (!textByPage.has(pageNumber)) missing.push(pageNumber);
    }
    emitStructuredEvent({
      eventName: "pipeline.extract.pages_missing",
      severity: "ERROR",
      timestamp: new Date().toISOString(),
      component: "pipeline",
      operation: "extract",
      stage: "ANALYZE",
      correlationId,
      processingRunId: runId,
      hiveId,
      sourceDocumentId: document.sourceDocumentId,
      task: "extract",
      diagnosticReason: "extract_pages_missing",
      diagnosticField: JSON.stringify({
        hiveId,
        sourceDocumentId: document.sourceDocumentId,
        readFingerprint: document.readFingerprint,
        pageSetDigest: document.pageSetDigest,
        sourceSha256: document.sha256,
        verifiedPageCount: document.verifiedPageCount,
        persistedPageCount: listed.pages.length,
        missingPageNumbers: missing,
      }),
    });
    throw createHiveError({
      errorCode: "COVERAGE_INCOMPLETE",
      category: "DOCUMENT",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "A document in this analysis is missing saved pages. Analyze again after reading completes.",
      correlationId,
      diagnosticReason: "extract_pages_missing",
    });
  }
  return listed.pages.map((row) => ({ pageNumber: row.page_number, text: row.page_text }));
}

function filterPagesForWorkItem(
  pages: readonly { pageNumber: number; text: string }[],
  pageRange: string | null,
): { pageNumber: number; text: string }[] {
  return pages.filter((page) => {
    if (pageRange === null) return true;
    const match = /^(\d+)(?:-(\d+))?$/.exec(pageRange);
    if (!match) return false;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    return page.pageNumber >= start && page.pageNumber <= end;
  });
}

async function persistUnreadablePageGaps(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  document: SnapshotDocument;
  catalog: PromptCatalog;
  correlationId: string;
  pageRange: string | null;
  blankPageNumbers: readonly number[];
}): Promise<HiveError | null> {
  for (const pageNumber of input.blankPageNumbers) {
    const pageRange = String(pageNumber);
    const rangePages = [{ pageNumber, text: "" }];
    const extraction = buildPageExtractionGap(
      { id: input.document.sourceDocumentId, fileName: input.document.fileName },
      { pageRange, pages: rangePages },
      pageNumber,
    );
    const saveError = await persistExtractedRange({
      deps: input.deps,
      run: input.run,
      document: input.document,
      catalog: input.catalog,
      pageRange,
      extraction,
      stats: {
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
        pageExtractionGaps: [pageNumber],
      },
      modelAlias: "harvester",
      correlationId: input.correlationId,
    });
    if (saveError) return saveError;
  }
  return null;
}

export type ExtractOneDocumentResult =
  | { ok: true; metric: StageMetric; modelAlias: string }
  | { ok: false; error: HiveError; metric: StageMetric | null; calls: ExtractCallRecord[] };

export type ExtractOneRangeResult =
  | { ok: true; metric: StageMetric; modelAlias: string; documentMetric: StageMetric | null; callsStarted: number }
  | { ok: false; error: HiveError; metric: StageMetric | null; calls: ExtractCallRecord[]; callsStarted: number };

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
  const pageRangeKey = pageRangeStorageKey(input.pageRange);
  if (
    !verifiedSavedRangeKeys(
      [{ pageRange: pageRangeKey, extraction: input.extraction }],
      input.document.verifiedPageCount,
    ).has(pageRangeKey.toLowerCase())
  ) {
    return createHiveError({
      errorCode: "INTERNAL_ERROR",
      category: "VALIDATION",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "Analysis stopped before it finished. You can try again.",
      correlationId: input.correlationId,
      diagnosticReason: "doc_extraction_range_incomplete",
    });
  }
  const put = await rpc(input.deps.client, "put_doc_extraction_range", {
    p_hive_id: input.run.hiveId,
    p_source_document_id: input.document.sourceDocumentId,
    p_content_digest: normalizeContentDigest(input.document.pageSetDigest) ?? input.document.pageSetDigest,
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
    stats.factsProposed += part.factsProposed ?? 0;
    for (const [key, count] of Object.entries(part.malformed ?? {})) {
      stats.malformed[key] = (stats.malformed[key] ?? 0) + count;
    }
    stats.factsIn += part.factsIn ?? 0;
    stats.factsKept += part.factsKept ?? 0;
    stats.evidenceIn += part.evidenceIn ?? 0;
    stats.evidenceDropped += part.evidenceDropped ?? 0;
    for (const [key, count] of Object.entries(part.byReason ?? {}) as [keyof typeof stats.byReason, number][]) {
      stats.byReason[key] = (stats.byReason[key] ?? 0) + count;
    }
    for (const key of ["emptyFields", "referencedDocuments", "documentEvidence"] as const) {
      const slice = part[key] ?? { in: 0, kept: 0 };
      stats[key].in += slice.in;
      stats[key].kept += slice.kept;
    }
    stats.dropped.push(...(part.dropped ?? []));
    stats.ranges.push(...(part.ranges ?? []));
    stats.pageExtractionGaps.push(...(part.pageExtractionGaps ?? []));
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
  const verifiedRanges = input.savedRanges.filter((row) =>
    verifiedSavedRangeKeys(
      [{ pageRange: row.pageRange, extraction: row.extraction }],
      input.document.verifiedPageCount,
    ).has(row.pageRange.toLowerCase()),
  );
  const savedKeys = verifiedSavedRangeKeys(
    verifiedRanges.map((row) => ({ pageRange: row.pageRange, extraction: row.extraction })),
    input.document.verifiedPageCount,
  );
  const gapPagesByDocument = await loadDocExtractionGapPagesForRun(input.deps.client, input.run.id);
  const gapPages = gapPagesByDocument.get(input.document.sourceDocumentId.toLowerCase()) ?? new Set<number>();
  if (!documentPagesFullyExtracted(input.document.verifiedPageCount, savedKeys, gapPages)) {
    return { merged: false, metric: null };
  }
  const prompt = input.catalog.extract;
  let mergedExtraction: DocExtraction;
  let mergedStats: ExtractDocumentStats;
  if (verifiedRanges.length === 0 && gapPages.size > 0) {
    const gapPageNumbers = [...gapPages].sort((left, right) => left - right);
    const parts = gapPageNumbers.map((pageNumber) => ({
      pageRange: String(pageNumber),
      extraction: buildPageExtractionGap(
        { id: input.document.sourceDocumentId, fileName: input.document.fileName },
        { pageRange: String(pageNumber), pages: [{ pageNumber, text: "" }] },
        pageNumber,
      ),
    }));
    mergedExtraction = mergeSavedRangeExtractions(input.document.sourceDocumentId, parts, input.document.verifiedPageCount);
    mergedStats = {
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
      pageExtractionGaps: gapPageNumbers,
    };
  } else {
    mergedExtraction = mergeSavedRangeExtractions(
      input.document.sourceDocumentId,
      verifiedRanges.map((row) => ({ pageRange: row.pageRange, extraction: row.extraction })),
      input.document.verifiedPageCount,
    );
    mergedStats = aggregateDocumentStats(input.savedRanges.map((row) => row.stats));
    for (const page of gapPages) {
      if (!mergedStats.pageExtractionGaps.includes(page)) mergedStats.pageExtractionGaps.push(page);
    }
    mergedStats.pageExtractionGaps.sort((a, b) => a - b);
  }
  const put = await rpc(input.deps.client, "put_doc_extraction", {
    p_hive_id: input.run.hiveId,
    p_source_document_id: input.document.sourceDocumentId,
    p_content_digest: normalizeContentDigest(input.document.pageSetDigest) ?? input.document.pageSetDigest,
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

async function extractOneRangeGap(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  workItem: ExtractWorkItem;
  catalog: PromptCatalog;
  correlationId: string;
  stageAttempt: number;
  now: () => Date;
}): Promise<ExtractOneRangeResult> {
  const { deps, run, workItem, catalog, correlationId, stageAttempt, now } = input;
  const document = workItem.document;
  const pageNumber =
    workItem.pageRange === null
      ? 1
      : Number.parseInt(workItem.pageRange, 10) ||
        parsePageRangeStorageKey(pageRangeStorageKey(workItem.pageRange), document.verifiedPageCount)[0] ||
        1;
  const prompt = catalog.extract;
  const pageRangeKey = pageRangeStorageKey(workItem.pageRange ?? String(pageNumber));
  const callStartedAt = now().toISOString();
  const recordGap = await rpc(deps.client, "record_doc_extraction_attempt", {
    p_processing_run_id: run.id,
    p_hive_id: run.hiveId,
    p_source_document_id: document.sourceDocumentId,
    p_content_digest: normalizeContentDigest(document.pageSetDigest) ?? document.pageSetDigest,
    p_page_range: pageRangeKey,
    p_prompt_id: prompt.id,
    p_prompt_digest: prompt.digest,
    p_error_code: PAGE_EXTRACTION_GAP_ERROR_CODE,
    p_diagnostic_reason: PAGE_EXTRACTION_GAP_DIAGNOSTIC,
    p_http_status: null,
    p_duration_ms: 0,
    p_aborted_by_our_deadline: false,
    p_call_started_at: callStartedAt,
  });
  if (!recordGap) {
    return {
      ok: false,
      error: createHiveError({
        errorCode: "PERSISTENCE_FAILED",
        category: "PERSISTENCE",
        stage: "ANALYZE",
        retryable: true,
        safeMessage: "Analysis stopped before it finished. You can try again.",
        correlationId,
        diagnosticReason: "doc_extraction_gap_record_failed",
      }),
      calls: [],
      metric: null,
      callsStarted: 0,
    };
  }
  const startedAt = now().toISOString();
  const metric = aggregateExtractMetric(stageAttempt, prompt, [], "harvester", startedAt, now().toISOString());
  const savedRanges = (await loadSavedDocExtractionRanges(deps.client, run.id)).filter(
    (row) => row.sourceDocumentId === document.sourceDocumentId.toLowerCase(),
  );
  const gapPagesByDocument = await loadDocExtractionGapPagesForRun(deps.client, run.id);
  const gapPages = gapPagesByDocument.get(document.sourceDocumentId.toLowerCase()) ?? new Set<number>();
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
      calls: [],
      modelAlias: "harvester",
    });
    return { ok: true, metric, modelAlias: "harvester", documentMetric: merged.metric, callsStarted: 0 };
  } catch (error) {
    if (error && typeof error === "object" && "errorCode" in error) {
      return { ok: false, error: error as HiveError, calls: [], metric, callsStarted: 0 };
    }
    throw error;
  }
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
  throughput?: PipelineThroughputStats;
  concurrencyAtStart?: number;
}): Promise<ExtractOneRangeResult> {
  const { deps, run, workItem, catalog, correlationId, stageAttempt, now } = input;
  const document = workItem.document;
  const clock = input.clock ?? deps.clock ?? (() => Date.now());
  const invocationStartedAt = input.invocationStartedAt ?? deps.invocationStartedAt ?? Date.now();
  const throughput = input.throughput ?? (await loadPipelineThroughput(deps.client, "extract"));
  const prompt = catalog.extract;
  const startedAt = now().toISOString();
  let pages: { pageNumber: number; text: string }[];
  try {
    pages = await loadDocumentPages({
      client: deps.client,
      hiveId: run.hiveId,
      runId: run.id,
      document,
      correlationId,
    });
  } catch (error) {
    if (error && typeof error === "object" && "errorCode" in error) {
      return { ok: false, calls: [], metric: null, callsStarted: 0, error: error as HiveError };
    }
    throw error;
  }
  const rangePages = filterPagesForWorkItem(pages, workItem.pageRange);
  const inputCharsForRange = rangePages.reduce((total, page) => total + page.text.length, 0);
  if (rangePages.length === 0) {
    return {
      ok: false,
      calls: [],
      metric: null,
      callsStarted: 0,
      error: createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "ANALYZE",
        retryable: false,
        safeMessage: "The extraction range has no authorized pages.",
        correlationId,
        diagnosticReason: "extract_range_empty_input",
      }),
    };
  }
  const blankPageNumbers = rangePages.filter((page) => isStoredPageTextEmpty(page.text)).map((page) => page.pageNumber);
  const readablePages = rangePages.filter((page) => !isStoredPageTextEmpty(page.text));
  if (blankPageNumbers.length > 0) {
    const gapError = await persistUnreadablePageGaps({
      deps,
      run,
      document,
      catalog,
      correlationId,
      pageRange: workItem.pageRange,
      blankPageNumbers,
    });
    if (gapError) {
      return { ok: false, error: gapError, calls: [], metric: null, callsStarted: 0 };
    }
  }
  if (readablePages.length === 0) {
    const startedAt = now().toISOString();
    const metric = aggregateExtractMetric(stageAttempt, catalog.extract, [], "harvester", startedAt, now().toISOString());
    const savedRanges = (await loadSavedDocExtractionRanges(deps.client, run.id)).filter(
      (row) => row.sourceDocumentId === document.sourceDocumentId.toLowerCase(),
    );
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
        calls: [],
        modelAlias: "harvester",
      });
      return { ok: true, metric, modelAlias: "harvester", documentMetric: merged.metric, callsStarted: 0 };
    } catch (mergeError) {
      if (mergeError && typeof mergeError === "object" && "errorCode" in mergeError) {
        return { ok: false, error: mergeError as HiveError, calls: [], metric, callsStarted: 0 };
      }
      throw mergeError;
    }
  }
  const plannerPageRange =
    readablePages.length > 0 && readablePages.length < rangePages.length
      ? rangeLabel(readablePages)
      : (workItem.pageRange ?? rangeLabel(readablePages));
  const expectedOutput = expectedExtractOutputTokens(readablePages, throughput);
  const fullPlannerTimeoutMs = () =>
    computePlannerCallTimeoutMs({
      expectedOutputTokens: expectedOutput,
      outputTokensPerSecond: throughput.outputTokensPerSecond,
      taskMaxMs: V5_CLIENT_TASK_TIMEOUT_MS,
      remainingInvocationMs: Number.POSITIVE_INFINITY,
    });
  let modelAlias = "harvester";
  let plannerHttpCallsStarted = 0;
  const result = await extractScheduledRange({
    planner: deps.planner,
    document: { id: document.sourceDocumentId, fileName: document.fileName },
    pages: readablePages,
    correlationId,
    runId: run.id,
    prompt,
    range: { pageRange: plannerPageRange, pages: readablePages },
    resolvePlannerTimeoutMs: () =>
      extractPlannerTimeoutMs(clock, invocationStartedAt, expectedOutput, throughput),
    resolveFullPlannerTimeoutMs: () => {
      const value = fullPlannerTimeoutMs();
      return typeof value === "number" ? value : V5_CLIENT_TASK_TIMEOUT_MS;
    },
    extractAttemptLifecycle: {
      begin: async ({ pageRange, callStartedAt }) => {
        const { data, error } = await deps.client.rpc("begin_doc_extraction_attempt", {
          p_processing_run_id: run.id,
          p_hive_id: run.hiveId,
          p_source_document_id: document.sourceDocumentId,
          p_content_digest: normalizeContentDigest(document.pageSetDigest) ?? document.pageSetDigest,
          p_page_range: pageRangeStorageKey(pageRange ?? plannerPageRange),
          p_prompt_id: prompt.id,
          p_prompt_digest: prompt.digest,
          p_call_started_at: callStartedAt,
        });
        if (error) {
          const fields = supabaseErrorFields(error);
          emitStructuredEvent({
            eventName: "pipeline.extract.attempt_record_failed",
            severity: "ERROR",
            timestamp: new Date().toISOString(),
            component: "pipeline",
            operation: "extract",
            stage: "ANALYZE",
            correlationId,
            processingRunId: run.id,
            hiveId: run.hiveId,
            sourceDocumentId: document.sourceDocumentId,
            pageRange: pageRangeStorageKey(pageRange ?? plannerPageRange),
            task: "extract",
            errorCode: fields.code,
            diagnosticReason: "extract_attempt_record_failed",
            diagnosticField: JSON.stringify({ message: fields.message }),
          });
          throw createHiveError({
            errorCode: "PERSISTENCE_FAILED",
            category: "PERSISTENCE",
            stage: "ANALYZE",
            retryable: true,
            safeMessage: "Analysis stopped before it finished. You can try again.",
            correlationId,
            diagnosticReason: "extract_attempt_record_failed",
          });
        }
        const row = parsePayload(data);
        const id = typeof row?.id === "string" ? row.id : null;
        if (!id) {
          throw createHiveError({
            errorCode: "PERSISTENCE_FAILED",
            category: "PERSISTENCE",
            stage: "ANALYZE",
            retryable: true,
            safeMessage: "Analysis stopped before it finished. You can try again.",
            correlationId,
            diagnosticReason: "extract_attempt_record_failed",
          });
        }
        plannerHttpCallsStarted += 1;
        return id;
      },
      finalize: async (row) => {
        if (!row.attemptRowId) return;
        const durationMs = Math.max(0, Math.trunc(row.durationMs));
        const { error } = await deps.client.rpc("update_doc_extraction_attempt_outcome", {
          p_attempt_id: row.attemptRowId,
          p_processing_run_id: run.id,
          p_outcome: row.outcome,
          p_error_code: row.errorCode,
          p_diagnostic_reason: row.diagnosticReason,
          p_http_status: row.httpStatus,
          p_duration_ms: durationMs,
          p_aborted_by_our_deadline: row.abortedByOurDeadline,
        });
        if (error) {
          const fields = supabaseErrorFields(error);
          emitStructuredEvent({
            eventName: "pipeline.extract.attempt_outcome_record_failed",
            severity: "ERROR",
            timestamp: new Date().toISOString(),
            component: "pipeline",
            operation: "extract",
            stage: "ANALYZE",
            correlationId,
            processingRunId: run.id,
            hiveId: run.hiveId,
            sourceDocumentId: document.sourceDocumentId,
            pageRange: pageRangeStorageKey(row.pageRange ?? plannerPageRange),
            task: "extract",
            errorCode: fields.code,
            diagnosticReason: "extract_attempt_outcome_record_failed",
            diagnosticField: JSON.stringify({ message: fields.message }),
          });
        }
      },
    },
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
    if (call.outcome === "failed") {
      continue;
    }
    await logPipelineCall({
      client: deps.client,
      task: "extract",
      correlationId,
      hiveId: run.hiveId,
      processingRunId: run.id,
      sourceDocumentId: document.sourceDocumentId,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      latencyMs: call.latencyMs,
      roundTripMs: call.roundTripMs,
      finishReason: call.finishReason,
      outcome: call.outcome,
      resolvedModel: call.resolvedModel,
      concurrencyAtStart: input.concurrencyAtStart,
      pageRange: pageRangeStorageKey(call.pageRange ?? workItem.pageRange),
      pageCount: readablePages.length,
      inputChars: inputCharsForRange,
      errorCode: call.errorCode,
      diagnosticReason: call.diagnosticReason,
      httpStatus: call.httpStatus,
      abortedByOurDeadline: call.abortedByOurDeadline,
      callStartedAt: call.callStartedAt,
      rangeAttempt: call.rangeAttempt,
      attempt: call.attempt,
    });
  }
  if (!result.ok) {
    return { ok: false, error: result.error, calls: result.calls, metric: null, callsStarted: plannerHttpCallsStarted };
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
      return { ok: false, error: error as HiveError, calls: result.calls, metric, callsStarted: plannerHttpCallsStarted };
    }
    throw error;
  }
  return { ok: true, metric, modelAlias, documentMetric, callsStarted: plannerHttpCallsStarted };
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
  clock?: () => number;
  invocationStartedAt?: number;
  /** Rebuild Study: skip re-extract; re-run canonicalize only from cached extractions (cheap path). */
  rebuildMode?: boolean;
}): Promise<CanonicalizeRunResult> {
  void input.rebuildMode;
  const { deps, run, extractions, catalog, correlationId, stageAttempt, now } = input;
  const clock = input.clock ?? deps.clock ?? (() => Date.now());
  const invocationStartedAt = input.invocationStartedAt ?? deps.invocationStartedAt ?? Date.now();
  const prompt = catalog.canonicalize;
  const startedAt = now().toISOString();
  const throughput = await loadPipelineThroughput(deps.client, "canonicalize");
  const payload = buildCanonicalizePayload(extractions, null);
  const expectedOutput = expectedOutputTokens(
    estimateInputTokensFromUtf8Bytes(Buffer.byteLength(JSON.stringify(payload), "utf8")),
    throughput.outputInputRatio,
  );
  const result = await canonicalizeCase({
    planner: deps.planner,
    extractions,
    correlationId,
    runId: run.id,
    prompt,
    resolvePlannerTimeoutMs: () =>
      extractPlannerTimeoutMs(clock, invocationStartedAt, expectedOutput, throughput),
  });
  for (const call of result.calls) {
    await logPipelineCall({
      client: deps.client,
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
      concurrencyAtStart: 1,
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
  runTimingMetric?: StageMetric | null;
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
    ...(input.runTimingMetric ? { stage_metric: input.runTimingMetric } : {}),
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
