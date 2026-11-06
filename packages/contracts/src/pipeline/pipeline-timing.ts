import { PLANNER_MAX_OUTPUT_TOKENS, type PipelinePlannerTask } from "../study-preparation/planner-wire-contracts";

export type PipelineThroughputTask = PipelinePlannerTask;

export type PipelineThroughputStats = {
  outputTokensPerSecond: number;
  outputInputRatio: number;
  /** Present for extract; used when page text is empty. */
  inputTokensPerPage: number;
  sampleCount: number;
};

export const PIPELINE_THROUGHPUT_MIN_SAMPLES = 5;
export const PIPELINE_THROUGHPUT_HISTORY_LIMIT = 50;
export const PIPELINE_THROUGHPUT_CACHE_MS = 10 * 60 * 1000;

export const DEFAULT_OUTPUT_TOKENS_PER_SECOND: Record<PipelineThroughputTask, number> = {
  extract: 110,
  canonicalize: 70,
  write: 100,
};

export const DEFAULT_OUTPUT_INPUT_RATIO = 1;
export const DEFAULT_EXTRACT_INPUT_TOKENS_PER_PAGE = 400;

export const INVOCATION_MAX_DURATION_MS = 300_000;
export const INVOCATION_HANDOFF_MARGIN_MS = 45_000;
export const MIN_PLANNER_CALL_MS = 60_000;
export const PLANNER_TIMEOUT_MULTIPLIER = 1.6;
export const PLANNER_TIMEOUT_PADDING_MS = 20_000;
export const EXTRACT_TARGET_RANGE_MS = 120_000;
export const EXTRACT_OUTPUT_CAP_FRACTION = 0.5;
export const PROGRESS_ESTIMATE_SPREAD = 0.35;
export const EXTRACTING_CONCURRENCY_FOR_ESTIMATE = 4;

/** V5 pipeline model calls: 270 s client (30 s margin under 300 s lease / Vercel). */
export const V5_CLIENT_TASK_TIMEOUT_MS = 270_000;

export const CHARS_PER_INPUT_TOKEN = 4;

function positiveFiniteOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeFiniteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function defaultPipelineThroughput(task: PipelineThroughputTask): PipelineThroughputStats {
  const defaultTps = positiveFiniteOrDefault(DEFAULT_OUTPUT_TOKENS_PER_SECOND[task], 100);
  return {
    outputTokensPerSecond: defaultTps,
    outputInputRatio: DEFAULT_OUTPUT_INPUT_RATIO,
    inputTokensPerPage: DEFAULT_EXTRACT_INPUT_TOKENS_PER_PAGE,
    sampleCount: 0,
  };
}

export function normalizePipelineThroughput(
  task: PipelineThroughputTask,
  raw: unknown,
): PipelineThroughputStats {
  const defaults = defaultPipelineThroughput(task);
  if (!raw || typeof raw !== "object") return defaults;
  const record = raw as Record<string, unknown>;
  const sampleCount =
    typeof record.sampleCount === "number" && Number.isFinite(record.sampleCount)
      ? Math.max(0, Math.floor(record.sampleCount))
      : 0;
  if (sampleCount < PIPELINE_THROUGHPUT_MIN_SAMPLES) return defaults;
  const outputTokensPerSecond = positiveFiniteOrDefault(
    record.outputTokensPerSecond,
    defaults.outputTokensPerSecond,
  );
  const outputInputRatio = positiveFiniteOrDefault(
    record.outputInputRatio,
    defaults.outputInputRatio,
  );
  const inputTokensPerPage =
    task === "extract"
      ? positiveFiniteOrDefault(record.inputTokensPerPage, defaults.inputTokensPerPage)
      : defaults.inputTokensPerPage;
  return { outputTokensPerSecond, outputInputRatio, inputTokensPerPage, sampleCount };
}

export function estimateInputTokensFromPageText(text: string, fallbackTokensPerPage: number): number {
  const fallback = positiveFiniteOrDefault(fallbackTokensPerPage, DEFAULT_EXTRACT_INPUT_TOKENS_PER_PAGE);
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length === 0) return Math.max(1, fallback);
  return Math.max(1, Math.ceil(trimmed.length / CHARS_PER_INPUT_TOKEN));
}

export function estimateInputTokensFromUtf8Bytes(byteLength: number): number {
  const safeBytes = nonNegativeFiniteOrZero(byteLength);
  return Math.max(1, Math.ceil(safeBytes / CHARS_PER_INPUT_TOKEN));
}

export function expectedOutputTokens(inputTokens: number, outputInputRatio: number): number {
  const safeInput = positiveFiniteOrDefault(inputTokens, 1);
  const safeRatio = positiveFiniteOrDefault(outputInputRatio, DEFAULT_OUTPUT_INPUT_RATIO);
  return Math.max(1, safeInput * safeRatio);
}

export function expectedDurationMs(outputTokens: number, outputTokensPerSecond: number): number {
  const safeOutput = positiveFiniteOrDefault(outputTokens, 1);
  const safeTps = positiveFiniteOrDefault(outputTokensPerSecond, DEFAULT_OUTPUT_TOKENS_PER_SECOND.write);
  return (safeOutput / safeTps) * 1000;
}

export function extractRangeOutputCapTokens(): number {
  return PLANNER_MAX_OUTPUT_TOKENS.extract * EXTRACT_OUTPUT_CAP_FRACTION;
}

export type PageTextSlice = { pageNumber: number; text: string };

export type PlannedExtractRange = { pageRange: string | null; pages: PageTextSlice[] };

function rangeLabelFromPages(pages: PageTextSlice[]): string | null {
  if (pages.length === 0) return null;
  if (pages.length === 1) return String(pages[0]!.pageNumber);
  return `${pages[0]!.pageNumber}-${pages[pages.length - 1]!.pageNumber}`;
}

function rangeWithinExtractLimits(input: {
  pages: PageTextSlice[];
  stats: PipelineThroughputStats;
  outputCapTokens: number;
  maxRangeDurationMs: number;
}): boolean {
  const inputTokens = input.pages.reduce(
    (total, page) => total + estimateInputTokensFromPageText(page.text, input.stats.inputTokensPerPage),
    0,
  );
  const outputTokens = expectedOutputTokens(inputTokens, input.stats.outputInputRatio);
  if (outputTokens > input.outputCapTokens) return false;
  const durationMs = expectedDurationMs(outputTokens, input.stats.outputTokensPerSecond);
  return durationMs <= input.maxRangeDurationMs;
}

/** Size-driven page ranges from measured page text and throughput stats. */
export function planExtractPageRanges(
  pages: readonly PageTextSlice[],
  stats: PipelineThroughputStats,
): PlannedExtractRange[] {
  const sorted = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);
  if (sorted.length === 0) return [];
  const outputCapTokens = extractRangeOutputCapTokens();
  const maxRangeDurationMs = EXTRACT_TARGET_RANGE_MS;
  if (
    rangeWithinExtractLimits({
      pages: sorted,
      stats,
      outputCapTokens,
      maxRangeDurationMs,
    })
  ) {
    return [{ pageRange: null, pages: sorted }];
  }
  const ranges: PlannedExtractRange[] = [];
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length) {
      const candidate = sorted.slice(index, end + 2);
      if (
        !rangeWithinExtractLimits({
          pages: candidate,
          stats,
          outputCapTokens,
          maxRangeDurationMs,
        })
      ) {
        break;
      }
      end += 1;
    }
    const slice = sorted.slice(index, end + 1);
    ranges.push({ pageRange: rangeLabelFromPages(slice), pages: slice });
    index = end + 1;
  }
  return ranges;
}

export function computePlannerCallTimeoutMs(input: {
  expectedOutputTokens: number;
  outputTokensPerSecond: number;
  taskMaxMs: number;
  remainingInvocationMs: number;
}): number | "expired" {
  const safeTaskMaxMs = positiveFiniteOrDefault(input.taskMaxMs, V5_CLIENT_TASK_TIMEOUT_MS);
  const safeRemainingMs = nonNegativeFiniteOrZero(input.remainingInvocationMs);
  const cap = Math.min(
    safeTaskMaxMs,
    Math.max(0, safeRemainingMs - INVOCATION_HANDOFF_MARGIN_MS),
  );
  if (!Number.isFinite(cap) || cap < MIN_PLANNER_CALL_MS) return "expired";
  const expectedMs = expectedDurationMs(input.expectedOutputTokens, input.outputTokensPerSecond);
  const rawComputed = Math.ceil(expectedMs * PLANNER_TIMEOUT_MULTIPLIER + PLANNER_TIMEOUT_PADDING_MS);
  const computed = Number.isFinite(rawComputed) ? Math.max(MIN_PLANNER_CALL_MS, rawComputed) : MIN_PLANNER_CALL_MS;
  return Math.min(computed, cap);
}

export function canStartPlannerCall(input: {
  remainingInvocationMs: number;
  callTimeoutMs: number;
}): boolean {
  if (!Number.isFinite(input.callTimeoutMs) || input.callTimeoutMs < MIN_PLANNER_CALL_MS) return false;
  if (!Number.isFinite(input.remainingInvocationMs)) return false;
  return input.remainingInvocationMs >= input.callTimeoutMs + INVOCATION_HANDOFF_MARGIN_MS;
}

export function invocationRemainingMs(clockMs: number, invocationStartedAtMs: number): number {
  if (!Number.isFinite(clockMs) || !Number.isFinite(invocationStartedAtMs)) return 0;
  return Math.max(0, invocationStartedAtMs + INVOCATION_MAX_DURATION_MS - clockMs);
}

export type ProgressEstimate = {
  estimatedCompletionAt: string;
  estimatedCompletionLowAt: string;
  estimatedCompletionHighAt: string;
};

export function spreadProgressEstimate(completionAtMs: number, nowMs: number): ProgressEstimate | null {
  if (!Number.isFinite(completionAtMs) || !Number.isFinite(nowMs) || completionAtMs <= nowMs + 500) return null;
  const lowMs = completionAtMs * (1 - PROGRESS_ESTIMATE_SPREAD);
  const highMs = completionAtMs * (1 + PROGRESS_ESTIMATE_SPREAD);
  return {
    estimatedCompletionAt: new Date(completionAtMs).toISOString(),
    estimatedCompletionLowAt: new Date(Math.max(nowMs, lowMs)).toISOString(),
    estimatedCompletionHighAt: new Date(highMs).toISOString(),
  };
}

export function formatEstimateRangeMinutes(lowAtMs: number, highAtMs: number): string {
  const lowMin = Math.max(1, Math.round((lowAtMs - Date.now()) / 60_000));
  const highMin = Math.max(lowMin, Math.round((highAtMs - Date.now()) / 60_000));
  if (lowMin === highMin) return `estimated ${lowMin} min`;
  return `estimated ${lowMin}–${highMin} min`;
}
