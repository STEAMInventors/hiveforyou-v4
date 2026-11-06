import {
  type PipelineThroughputStats,
  type ProcessingRun,
  type ProgressEstimate,
  type ReportRun,
  type ReportRunStatus,
  type SourceSnapshot,
  type StageMetric,
  EXTRACTING_CONCURRENCY_FOR_ESTIMATE,
  defaultPipelineThroughput,
  expectedDurationMs,
  expectedOutputTokens,
  estimateInputTokensFromPageText,
  isActiveReportRunStatus,
  spreadProgressEstimate,
  type PageTextSlice,
} from "@hiveforyou/contracts";

import { missingExtractWorkItems } from "@/server/pipeline/extract-runner";

export type ProgressEstimateInput = {
  nowMs: number;
  run: Pick<
    ProcessingRun,
    "status" | "stageAttempt" | "extractedDocumentCount" | "extractingPageCompleted" | "extractingPageTotal"
  >;
  snapshot: SourceSnapshot | null;
  extractedDocumentIds: ReadonlySet<string>;
  savedRangeKeysByDocument: ReadonlyMap<string, ReadonlySet<string>>;
  pagesByDocument: ReadonlyMap<string, readonly PageTextSlice[]>;
  extractThroughput: PipelineThroughputStats;
  canonicalizeThroughput: PipelineThroughputStats;
  writeThroughput: PipelineThroughputStats;
  reportRuns?: readonly ReportRun[];
};

function remainingExtractWorkMs(input: ProgressEstimateInput): number {
  if (!input.snapshot) return 0;
  const rangeDurations: number[] = [];
  for (const document of input.snapshot.documents) {
    if (input.extractedDocumentIds.has(document.sourceDocumentId.toLowerCase())) continue;
    const docKey = document.sourceDocumentId.toLowerCase();
    const saved = input.savedRangeKeysByDocument.get(docKey) ?? new Set<string>();
    const pages = input.pagesByDocument.get(docKey) ?? [];
    for (const item of missingExtractWorkItems(pages, saved, input.extractThroughput)) {
      const inputTokens = item.pages.reduce(
        (total, page) =>
          total + estimateInputTokensFromPageText(page.text, input.extractThroughput.inputTokensPerPage),
        0,
      );
      const outputTokens = expectedOutputTokens(inputTokens, input.extractThroughput.outputInputRatio);
      rangeDurations.push(expectedDurationMs(outputTokens, input.extractThroughput.outputTokensPerSecond));
    }
  }
  if (rangeDurations.length === 0) return 0;
  rangeDurations.sort((left, right) => right - left);
  const workers = EXTRACTING_CONCURRENCY_FOR_ESTIMATE;
  const workerLoads = Array.from({ length: workers }, () => 0);
  for (const duration of rangeDurations) {
    workerLoads.sort((left, right) => left - right);
    workerLoads[0] = (workerLoads[0] ?? 0) + duration;
  }
  return Math.max(...workerLoads);
}

function canonicalizeEstimateMs(input: ProgressEstimateInput): number {
  if (!input.snapshot) return 0;
  const pageCount = input.snapshot.documents.reduce((total, document) => {
    const pages = input.pagesByDocument.get(document.sourceDocumentId.toLowerCase()) ?? [];
    return total + pages.length;
  }, 0);
  const inputTokens = Math.max(500, pageCount * 120);
  const outputTokens = expectedOutputTokens(inputTokens, input.canonicalizeThroughput.outputInputRatio);
  return expectedDurationMs(outputTokens, input.canonicalizeThroughput.outputTokensPerSecond);
}

function writeEstimateMs(input: ProgressEstimateInput): number {
  const outputTokens = expectedOutputTokens(4000, input.writeThroughput.outputInputRatio);
  const perReport = expectedDurationMs(outputTokens, input.writeThroughput.outputTokensPerSecond);
  const activeReports =
    input.reportRuns?.filter((run) => run.status !== "SUCCEEDED" && run.status !== "FAILED").length ?? 2;
  return perReport * Math.max(1, activeReports);
}

export function computeProgressEstimateMs(input: ProgressEstimateInput): number {
  const status = input.run.status;
  if (status === "SUCCEEDED" || status === "FAILED" || status === "NEEDS_CLARIFICATION") return 0;
  let total = 0;
  if (status === "EXTRACTING" || status === "READING_DOCUMENTS" || status === "QUEUED") {
    total += remainingExtractWorkMs(input);
    total += canonicalizeEstimateMs(input);
    total += writeEstimateMs(input);
  } else if (status === "CANONICALIZING") {
    total += canonicalizeEstimateMs(input);
    total += writeEstimateMs(input);
  } else if (status === "ACCEPTING_STUDY") {
    total += writeEstimateMs(input);
  }
  return total;
}

export function buildProgressEstimate(input: ProgressEstimateInput): ProgressEstimate | null {
  const remainingMs = computeProgressEstimateMs(input);
  if (remainingMs <= 0) return null;
  return spreadProgressEstimate(input.nowMs + remainingMs, input.nowMs);
}

export function defaultProgressEstimateThroughputs(): {
  extract: PipelineThroughputStats;
  canonicalize: PipelineThroughputStats;
  write: PipelineThroughputStats;
} {
  return {
    extract: defaultPipelineThroughput("extract"),
    canonicalize: defaultPipelineThroughput("canonicalize"),
    write: defaultPipelineThroughput("write"),
  };
}

const QUICK_FINISH_MS = 3_000;

const EXTRACTING_RUN_FOR_ESTIMATE: ProgressEstimateInput["run"] = {
  status: "EXTRACTING",
  stageAttempt: 1,
  extractedDocumentCount: 0,
  extractingPageCompleted: null,
  extractingPageTotal: null,
};

/** Initial pipeline duration estimate (full extract + canonicalize + write) from a frozen snapshot. */
export function estimateInitialProcessingRunDurationMs(input: Omit<ProgressEstimateInput, "run">): number {
  return computeProgressEstimateMs({ ...input, run: EXTRACTING_RUN_FOR_ESTIMATE });
}

export function buildRunTimingStageMetric(input: {
  estimatedDurationMs: number;
  actualDurationMs: number;
  startedAt: string;
  completedAt: string;
}): StageMetric {
  return {
    stage: "ACCEPTING_STUDY",
    outcome: "SUCCEEDED",
    estimatedDurationMs: input.estimatedDurationMs,
    actualDurationMs: input.actualDurationMs,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
}

export function buildReportRunProgressEstimate(input: {
  nowMs: number;
  status: ReportRunStatus;
  writeThroughput: PipelineThroughputStats;
}): ProgressEstimate | null {
  if (!isActiveReportRunStatus(input.status)) return null;
  const outputTokens = expectedOutputTokens(4000, input.writeThroughput.outputInputRatio);
  const remainingMs = expectedDurationMs(outputTokens, input.writeThroughput.outputTokensPerSecond);
  if (remainingMs <= QUICK_FINISH_MS) return null;
  return spreadProgressEstimate(input.nowMs + remainingMs, input.nowMs);
}
