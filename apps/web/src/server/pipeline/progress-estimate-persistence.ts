import {
  type PageTextSlice,
  type ProcessingRun,
  type ProgressEstimate,
  type ReportRun,
  type SourceSnapshot,
  spreadProgressEstimate,
  expectedDurationMs,
  expectedOutputTokens,
  isActiveReportRunStatus,
} from "@hiveforyou/contracts";

import {
  buildProcessingRunProgressFingerprint,
  buildReportRunProgressFingerprint,
} from "@/server/pipeline/progress-estimate-anchor";
import {
  computeProgressEstimateMs,
  type ProgressEstimateInput,
} from "@/server/pipeline/pipeline-progress-estimate";
import { loadPipelineThroughput } from "@/server/pipeline/pipeline-throughput";
import {
  loadProgressEstimateSnapshotState,
  type ProgressEstimateRpcClient,
} from "@/server/pipeline/progress-estimate-snapshot-state";

const QUICK_FINISH_MS = 3_000;

export type StoredProgressEstimate = {
  estimatedCompletionAt: string;
  estimateFingerprint: string;
};

export function progressEstimateFromStored(
  stored: StoredProgressEstimate | null | undefined,
  fingerprint: string,
  nowMs: number,
): ProgressEstimate | null {
  if (!stored?.estimatedCompletionAt || !stored.estimateFingerprint) return null;
  if (stored.estimateFingerprint !== fingerprint) return null;
  const completionMs = Date.parse(stored.estimatedCompletionAt);
  if (!Number.isFinite(completionMs)) return null;
  return spreadProgressEstimate(completionMs, nowMs);
}

export function storedProgressEstimateFromRun(
  run: Pick<ProcessingRun | ReportRun, "estimatedCompletionAt" | "estimateFingerprint">,
): StoredProgressEstimate | null {
  if (typeof run.estimatedCompletionAt !== "string" || typeof run.estimateFingerprint !== "string") {
    return null;
  }
  return {
    estimatedCompletionAt: run.estimatedCompletionAt,
    estimateFingerprint: run.estimateFingerprint,
  };
}

async function rpcPersist(
  client: ProgressEstimateRpcClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message ?? `${fn} failed`);
}

export async function persistProcessingRunProgressEstimate(
  client: ProgressEstimateRpcClient,
  input: {
    runId: string;
    estimatedCompletionAtMs: number | null;
    estimateFingerprint: string | null;
  },
): Promise<void> {
  await rpcPersist(client, "persist_processing_run_estimate", {
    p_run_id: input.runId,
    p_estimated_completion_at:
      input.estimatedCompletionAtMs === null
        ? null
        : new Date(input.estimatedCompletionAtMs).toISOString(),
    p_estimate_fingerprint: input.estimateFingerprint,
  });
}

export async function backfillProcessingRunProgressEstimate(
  client: ProgressEstimateRpcClient,
  input: {
    runId: string;
    estimatedCompletionAtMs: number;
    estimateFingerprint: string;
  },
): Promise<void> {
  await rpcPersist(client, "backfill_processing_run_estimate", {
    p_run_id: input.runId,
    p_estimated_completion_at: new Date(input.estimatedCompletionAtMs).toISOString(),
    p_estimate_fingerprint: input.estimateFingerprint,
  });
}

export async function persistReportRunProgressEstimate(
  client: ProgressEstimateRpcClient,
  input: {
    reportRunId: string;
    estimatedCompletionAtMs: number | null;
    estimateFingerprint: string | null;
  },
): Promise<void> {
  await rpcPersist(client, "persist_report_run_estimate", {
    p_report_run_id: input.reportRunId,
    p_estimated_completion_at:
      input.estimatedCompletionAtMs === null
        ? null
        : new Date(input.estimatedCompletionAtMs).toISOString(),
    p_estimate_fingerprint: input.estimateFingerprint,
  });
}

export async function backfillReportRunProgressEstimate(
  client: ProgressEstimateRpcClient,
  input: {
    reportRunId: string;
    estimatedCompletionAtMs: number;
    estimateFingerprint: string;
  },
): Promise<void> {
  await rpcPersist(client, "backfill_report_run_estimate", {
    p_report_run_id: input.reportRunId,
    p_estimated_completion_at: new Date(input.estimatedCompletionAtMs).toISOString(),
    p_estimate_fingerprint: input.estimateFingerprint,
  });
}

export function buildProcessingRunProgressEstimateInput(input: {
  nowMs: number;
  run: ProcessingRun;
  snapshot: SourceSnapshot;
  extractedDocumentIds: ReadonlySet<string>;
  savedRangeKeysByDocument: ReadonlyMap<string, ReadonlySet<string>>;
  pagesByDocument: ReadonlyMap<string, readonly PageTextSlice[]>;
  extractThroughput: ProgressEstimateInput["extractThroughput"];
  canonicalizeThroughput: ProgressEstimateInput["canonicalizeThroughput"];
  writeThroughput: ProgressEstimateInput["writeThroughput"];
  reportRuns?: readonly ReportRun[];
}): ProgressEstimateInput {
  return {
    nowMs: input.nowMs,
    run: input.run,
    snapshot: input.snapshot,
    extractedDocumentIds: input.extractedDocumentIds,
    savedRangeKeysByDocument: input.savedRangeKeysByDocument,
    pagesByDocument: input.pagesByDocument,
    extractThroughput: input.extractThroughput,
    canonicalizeThroughput: input.canonicalizeThroughput,
    writeThroughput: input.writeThroughput,
    reportRuns: input.reportRuns,
  };
}

export function computeFreshProcessingRunCompletionAtMs(input: ProgressEstimateInput): number | null {
  const remainingMs = computeProgressEstimateMs(input);
  if (remainingMs <= 0) return null;
  return input.nowMs + remainingMs;
}

/** Worker: recompute and persist when pipeline progress changes. */
export async function refreshProcessingRunProgressEstimateInWorker(
  client: ProgressEstimateRpcClient,
  input: {
    run: ProcessingRun;
    snapshot: SourceSnapshot;
    correlationId: string;
    reportRuns?: readonly ReportRun[];
    clock?: () => number;
  },
): Promise<void> {
  const nowMs = (input.clock ?? Date.now)();
  const snapshotState = await loadProgressEstimateSnapshotState(client, {
    hiveId: input.run.hiveId,
    runId: input.run.id,
    correlationId: input.correlationId,
    documents: input.snapshot.documents,
    fallbackExtractedDocumentCount: input.run.extractedDocumentCount,
  });
  const [extractThroughput, canonicalizeThroughput, writeThroughput] = await Promise.all([
    loadPipelineThroughput(client, "extract", nowMs),
    loadPipelineThroughput(client, "canonicalize", nowMs),
    loadPipelineThroughput(client, "write", nowMs),
  ]);
  const estimateInput = buildProcessingRunProgressEstimateInput({
    nowMs,
    run: input.run,
    snapshot: input.snapshot,
    ...snapshotState,
    extractThroughput,
    canonicalizeThroughput,
    writeThroughput,
    reportRuns: input.reportRuns,
  });
  const fingerprint = buildProcessingRunProgressFingerprint({
    run: input.run,
    extractedDocumentIds: snapshotState.extractedDocumentIds,
    savedRangeKeysByDocument: snapshotState.savedRangeKeysByDocument,
    reportRuns: input.reportRuns,
  });
  const completionAtMs = computeFreshProcessingRunCompletionAtMs(estimateInput);
  await persistProcessingRunProgressEstimate(client, {
    runId: input.run.id,
    estimatedCompletionAtMs: completionAtMs,
    estimateFingerprint: completionAtMs === null ? null : fingerprint,
  });
}

export async function refreshReportRunProgressEstimateInWorker(
  client: ProgressEstimateRpcClient,
  input: {
    reportRun: ReportRun;
    clock?: () => number;
  },
): Promise<void> {
  const nowMs = (input.clock ?? Date.now)();
  if (!isActiveReportRunStatus(input.reportRun.status)) {
    await persistReportRunProgressEstimate(client, {
      reportRunId: input.reportRun.id,
      estimatedCompletionAtMs: null,
      estimateFingerprint: null,
    });
    return;
  }
  const writeThroughput = await loadPipelineThroughput(client, "write", nowMs);
  const outputTokens = expectedOutputTokens(4000, writeThroughput.outputInputRatio);
  const remainingMs = expectedDurationMs(outputTokens, writeThroughput.outputTokensPerSecond);
  const fingerprint = buildReportRunProgressFingerprint({
    status: input.reportRun.status,
    attemptCount: input.reportRun.attemptCount,
  });
  if (remainingMs <= QUICK_FINISH_MS) {
    await persistReportRunProgressEstimate(client, {
      reportRunId: input.reportRun.id,
      estimatedCompletionAtMs: null,
      estimateFingerprint: null,
    });
    return;
  }
  await persistReportRunProgressEstimate(client, {
    reportRunId: input.reportRun.id,
    estimatedCompletionAtMs: nowMs + remainingMs,
    estimateFingerprint: fingerprint,
  });
}

/** Owner poll: read persisted anchor; backfill once when missing. */
export async function materializeProcessingRunProgressEstimate(
  client: ProgressEstimateRpcClient,
  input: {
    run: ProcessingRun;
    snapshot: SourceSnapshot;
    correlationId: string;
    reportRuns?: readonly ReportRun[];
    nowMs: number;
    extractThroughput: ProgressEstimateInput["extractThroughput"];
    canonicalizeThroughput: ProgressEstimateInput["canonicalizeThroughput"];
    writeThroughput: ProgressEstimateInput["writeThroughput"];
    snapshotState: Awaited<ReturnType<typeof loadProgressEstimateSnapshotState>>;
  },
): Promise<ProgressEstimate | null> {
  const estimateInput = buildProcessingRunProgressEstimateInput({
    nowMs: input.nowMs,
    run: input.run,
    snapshot: input.snapshot,
    ...input.snapshotState,
    extractThroughput: input.extractThroughput,
    canonicalizeThroughput: input.canonicalizeThroughput,
    writeThroughput: input.writeThroughput,
    reportRuns: input.reportRuns,
  });
  const fingerprint = buildProcessingRunProgressFingerprint({
    run: input.run,
    extractedDocumentIds: input.snapshotState.extractedDocumentIds,
    savedRangeKeysByDocument: input.snapshotState.savedRangeKeysByDocument,
    reportRuns: input.reportRuns,
  });
  const stored = storedProgressEstimateFromRun(input.run);
  const fromDb = progressEstimateFromStored(stored, fingerprint, input.nowMs);
  if (fromDb) return fromDb;

  if (stored?.estimatedCompletionAt) {
    const completionAtMs = computeFreshProcessingRunCompletionAtMs(estimateInput);
    return completionAtMs === null ? null : spreadProgressEstimate(completionAtMs, input.nowMs);
  }

  const completionAtMs = computeFreshProcessingRunCompletionAtMs(estimateInput);
  if (completionAtMs === null) return null;
  await backfillProcessingRunProgressEstimate(client, {
    runId: input.run.id,
    estimatedCompletionAtMs: completionAtMs,
    estimateFingerprint: fingerprint,
  });
  return spreadProgressEstimate(completionAtMs, input.nowMs);
}

export async function materializeReportRunProgressEstimate(
  client: ProgressEstimateRpcClient,
  input: {
    reportRun: ReportRun;
    nowMs: number;
    writeThroughput: ProgressEstimateInput["writeThroughput"];
  },
): Promise<ProgressEstimate | null> {
  if (!isActiveReportRunStatus(input.reportRun.status)) return null;
  const outputTokens = expectedOutputTokens(4000, input.writeThroughput.outputInputRatio);
  const remainingMs = expectedDurationMs(outputTokens, input.writeThroughput.outputTokensPerSecond);
  if (remainingMs <= QUICK_FINISH_MS) return null;

  const fingerprint = buildReportRunProgressFingerprint({
    status: input.reportRun.status,
    attemptCount: input.reportRun.attemptCount,
  });
  const stored = storedProgressEstimateFromRun(input.reportRun);
  const fromDb = progressEstimateFromStored(stored, fingerprint, input.nowMs);
  if (fromDb) return fromDb;

  if (stored?.estimatedCompletionAt) {
    return null;
  }

  const completionAtMs = input.nowMs + remainingMs;
  await backfillReportRunProgressEstimate(client, {
    reportRunId: input.reportRun.id,
    estimatedCompletionAtMs: completionAtMs,
    estimateFingerprint: fingerprint,
  });
  return spreadProgressEstimate(completionAtMs, input.nowMs);
}
