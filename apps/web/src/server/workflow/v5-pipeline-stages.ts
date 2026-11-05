import {
  type CanonicalStudy,
  CANONICAL_STUDY_SCHEMA,
  createHiveError,
  type DocExtraction,
  type HiveError,
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
import { extractDocument, type ExtractCallRecord } from "@/server/pipeline/extract-runner";
import { sha256Digest } from "@/server/study-preparation/prompt-catalog";
import { loadPromptCatalog, type PromptCatalog } from "@/server/study-preparation/prompt-catalog";
import { canonicalJson } from "@/server/study-preparation/study-prompt-builder";

import type { AnalysisWorkflowDeps } from "./analysis-workflow";

/** V5 pipeline model calls: 270 s client (30 s margin under 300 s lease / Vercel). */
export const V5_CLIENT_TASK_TIMEOUT_MS = 270_000;

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

export async function extractOneDocument(input: {
  deps: AnalysisWorkflowDeps;
  run: ProcessingRun;
  document: SnapshotDocument;
  catalog: PromptCatalog;
  correlationId: string;
  stageAttempt: number;
  now: () => Date;
}): Promise<ExtractOneDocumentResult> {
  const { deps, run, document, catalog, correlationId, stageAttempt, now } = input;
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
  const result = await extractDocument({
    planner: deps.planner,
    document: { id: document.sourceDocumentId, fileName: document.fileName },
    pages,
    correlationId,
    runId: run.id,
    prompt,
  });
  for (const call of result.calls) {
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
  const modelAlias = result.calls.find((call) => call.modelAlias)?.modelAlias ?? "harvester";
  const put = await rpc(deps.client, "put_doc_extraction", {
    p_hive_id: run.hiveId,
    p_source_document_id: document.sourceDocumentId,
    p_content_digest: document.pageSetDigest,
    p_prompt_id: prompt.id,
    p_prompt_digest: prompt.digest,
    p_model_alias: modelAlias,
    p_extraction: result.extraction,
    p_stats: result.stats,
  });
  if (!put) {
    return {
      ok: false,
      calls: result.calls,
      metric: null,
      error: createHiveError({
        errorCode: "PERSISTENCE_FAILED",
        category: "PERSISTENCE",
        stage: "ANALYZE",
        retryable: true,
        safeMessage: "Analysis stopped before it finished. You can try again.",
        correlationId,
        diagnosticReason: "doc_extraction_save_failed",
      }),
    };
  }
  const metric = aggregateExtractMetric(
    stageAttempt,
    prompt,
    result.calls,
    modelAlias,
    startedAt,
    now().toISOString(),
  );
  return { ok: true, metric, modelAlias };
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
