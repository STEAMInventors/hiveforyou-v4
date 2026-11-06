import { describe, expect, it } from "vitest";

import {
  CHARS_PER_INPUT_TOKEN,
  DEFAULT_EXTRACT_INPUT_TOKENS_PER_PAGE,
  DEFAULT_OUTPUT_INPUT_RATIO,
  DEFAULT_OUTPUT_TOKENS_PER_SECOND,
  EXTRACTING_CONCURRENCY_FOR_ESTIMATE,
  EXTRACT_TARGET_RANGE_MS,
  INVOCATION_HANDOFF_MARGIN_MS,
  MIN_PLANNER_CALL_MS,
  PIPELINE_THROUGHPUT_MIN_SAMPLES,
  V5_CLIENT_TASK_TIMEOUT_MS,
  canStartPlannerCall,
  computePlannerCallTimeoutMs,
  defaultPipelineThroughput,
  estimateInputTokensFromPageText,
  estimateInputTokensFromUtf8Bytes,
  expectedDurationMs,
  expectedOutputTokens,
  invocationRemainingMs,
  normalizePipelineThroughput,
  planExtractPageRanges,
  spreadProgressEstimate,
} from "./pipeline-timing";

describe("planExtractPageRanges", () => {
  const stats = defaultPipelineThroughput("extract");

  it("gives dense pages smaller ranges than light pages", () => {
    const denseText = "x".repeat(stats.inputTokensPerPage * CHARS_PER_INPUT_TOKEN * 12);
    const lightText = "brief";
    const densePages = Array.from({ length: 12 }, (_, index) => ({
      pageNumber: index + 1,
      text: denseText,
    }));
    const lightPages = Array.from({ length: 12 }, (_, index) => ({
      pageNumber: index + 1,
      text: lightText,
    }));
    const denseRanges = planExtractPageRanges(densePages, stats);
    const lightRanges = planExtractPageRanges(lightPages, stats);
    const maxDense = Math.max(...denseRanges.map((range) => range.pages.length));
    const maxLight = Math.max(...lightRanges.map((range) => range.pages.length));
    expect(maxDense).toBeLessThan(maxLight);
  });

  it("keeps at least one page per range", () => {
    const text = "x".repeat(stats.inputTokensPerPage * CHARS_PER_INPUT_TOKEN * 10);
    const ranges = planExtractPageRanges([{ pageNumber: 1, text }], stats);
    expect(ranges).toEqual([{ pageRange: null, pages: [{ pageNumber: 1, text }] }]);
  });
});

describe("normalizePipelineThroughput and total timing helpers", () => {
  it("falls back to documented defaults when throughput is missing, zero, negative, or NaN", () => {
    for (const task of ["extract", "canonicalize", "write"] as const) {
      const defaults = defaultPipelineThroughput(task);
      expect(normalizePipelineThroughput(task, undefined)).toEqual(defaults);
      expect(normalizePipelineThroughput(task, null)).toEqual(defaults);
      expect(normalizePipelineThroughput(task, {})).toEqual(defaults);
      expect(
        normalizePipelineThroughput(task, {
          sampleCount: PIPELINE_THROUGHPUT_MIN_SAMPLES,
          outputTokensPerSecond: 0,
          outputInputRatio: 0,
          inputTokensPerPage: 0,
        }),
      ).toEqual({ ...defaults, sampleCount: PIPELINE_THROUGHPUT_MIN_SAMPLES });
      expect(
        normalizePipelineThroughput(task, {
          sampleCount: PIPELINE_THROUGHPUT_MIN_SAMPLES,
          outputTokensPerSecond: -50,
          outputInputRatio: -1,
          inputTokensPerPage: -400,
        }),
      ).toEqual({ ...defaults, sampleCount: PIPELINE_THROUGHPUT_MIN_SAMPLES });
      expect(
        normalizePipelineThroughput(task, {
          sampleCount: PIPELINE_THROUGHPUT_MIN_SAMPLES,
          outputTokensPerSecond: Number.NaN,
          outputInputRatio: Number.NaN,
          inputTokensPerPage: Number.NaN,
        }),
      ).toEqual({ ...defaults, sampleCount: PIPELINE_THROUGHPUT_MIN_SAMPLES });
      expect(
        normalizePipelineThroughput(task, {
          sampleCount: PIPELINE_THROUGHPUT_MIN_SAMPLES,
          outputTokensPerSecond: Number.POSITIVE_INFINITY,
          outputInputRatio: Number.POSITIVE_INFINITY,
          inputTokensPerPage: Number.POSITIVE_INFINITY,
        }),
      ).toEqual({ ...defaults, sampleCount: PIPELINE_THROUGHPUT_MIN_SAMPLES });
    }
  });

  it("never produces NaN or undefined in token, duration, timeout, or start decisions", () => {
    for (const bad of [undefined as unknown as number, 0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const pageTokens = estimateInputTokensFromPageText("", bad);
      expect(Number.isFinite(pageTokens)).toBe(true);
      expect(pageTokens).toBe(DEFAULT_EXTRACT_INPUT_TOKENS_PER_PAGE);

      const byteTokens = estimateInputTokensFromUtf8Bytes(bad);
      expect(Number.isFinite(byteTokens)).toBe(true);
      expect(byteTokens).toBeGreaterThanOrEqual(1);

      const outTokens = expectedOutputTokens(100, bad);
      expect(Number.isFinite(outTokens)).toBe(true);
      expect(outTokens).toBe(100 * DEFAULT_OUTPUT_INPUT_RATIO);

      const duration = expectedDurationMs(1000, bad);
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBe((1000 / DEFAULT_OUTPUT_TOKENS_PER_SECOND.write) * 1000);

      const timeout = computePlannerCallTimeoutMs({
        expectedOutputTokens: bad,
        outputTokensPerSecond: bad,
        taskMaxMs: V5_CLIENT_TASK_TIMEOUT_MS,
        remainingInvocationMs: 299_000,
      });
      expect(timeout).not.toBe("expired");
      expect(typeof timeout).toBe("number");
      expect(Number.isFinite(timeout as number)).toBe(true);
      expect(timeout as number).toBeGreaterThanOrEqual(MIN_PLANNER_CALL_MS);

      expect(
        canStartPlannerCall({
          remainingInvocationMs: 299_000,
          callTimeoutMs: bad,
        }),
      ).toBe(false);
    }
  });
});

describe("computePlannerCallTimeoutMs", () => {
  it("floors short expected durations to MIN_PLANNER_CALL_MS when the invocation cap allows it", () => {
    const remaining = invocationRemainingMs(1_000, 0);
    const timeout = computePlannerCallTimeoutMs({
      expectedOutputTokens: 120,
      outputTokensPerSecond: 100,
      taskMaxMs: V5_CLIENT_TASK_TIMEOUT_MS,
      remainingInvocationMs: remaining,
    });
    expect(timeout).toBe(MIN_PLANNER_CALL_MS);
  });

  it("respects remaining invocation time minus the handoff margin", () => {
    const remaining = INVOCATION_HANDOFF_MARGIN_MS + MIN_PLANNER_CALL_MS + 5_000;
    const timeout = computePlannerCallTimeoutMs({
      expectedOutputTokens: 50_000,
      outputTokensPerSecond: 1,
      taskMaxMs: V5_CLIENT_TASK_TIMEOUT_MS,
      remainingInvocationMs: remaining,
    });
    expect(timeout).toBeLessThanOrEqual(remaining - INVOCATION_HANDOFF_MARGIN_MS);
    expect(timeout).toBeGreaterThanOrEqual(MIN_PLANNER_CALL_MS);
  });

  it("returns expired when less than 60 s is available for a call", () => {
    expect(
      computePlannerCallTimeoutMs({
        expectedOutputTokens: 1000,
        outputTokensPerSecond: 100,
        taskMaxMs: V5_CLIENT_TASK_TIMEOUT_MS,
        remainingInvocationMs: INVOCATION_HANDOFF_MARGIN_MS + MIN_PLANNER_CALL_MS - 1,
      }),
    ).toBe("expired");
  });
});

describe("canStartPlannerCall", () => {
  it("refuses to start when less than 60 s is available for the call budget", () => {
    expect(
      canStartPlannerCall({
        remainingInvocationMs: INVOCATION_HANDOFF_MARGIN_MS + MIN_PLANNER_CALL_MS - 1,
        callTimeoutMs: MIN_PLANNER_CALL_MS,
      }),
    ).toBe(false);
  });

  it("allows a start when the call timeout and handoff margin fit", () => {
    expect(
      canStartPlannerCall({
        remainingInvocationMs: INVOCATION_HANDOFF_MARGIN_MS + MIN_PLANNER_CALL_MS + 1_000,
        callTimeoutMs: MIN_PLANNER_CALL_MS,
      }),
    ).toBe(true);
  });
});

describe("expectedDurationMs", () => {
  it("targets extract ranges under the 120 s budget", () => {
    const stats = defaultPipelineThroughput("extract");
    const pages = [{ pageNumber: 1, text: "x".repeat(4000) }];
    const inputTokens = estimateInputTokensFromPageText(pages[0]!.text, stats.inputTokensPerPage);
    const outputTokens = expectedOutputTokens(inputTokens, stats.outputInputRatio);
    expect(expectedDurationMs(outputTokens, stats.outputTokensPerSecond)).toBeLessThanOrEqual(
      EXTRACT_TARGET_RANGE_MS,
    );
  });
});

describe("spreadProgressEstimate", () => {
  it("returns null when everything finishes in seconds", () => {
    const now = 1_000_000;
    expect(spreadProgressEstimate(now + 400, now)).toBeNull();
  });

  it("builds low and high bounds at ±35%", () => {
    const now = 1_000_000;
    const completion = now + 600_000;
    const estimate = spreadProgressEstimate(completion, now);
    expect(estimate).not.toBeNull();
    const low = Date.parse(estimate!.estimatedCompletionLowAt);
    const high = Date.parse(estimate!.estimatedCompletionHighAt);
    expect(low).toBeGreaterThanOrEqual(now);
    expect(high).toBeGreaterThan(completion);
  });
});

describe("invocationRemainingMs", () => {
  it("counts down from the 300 s route window", () => {
    const start = 10_000;
    expect(invocationRemainingMs(start + 60_000, start)).toBe(240_000);
  });
});

describe("concurrency constant", () => {
  it("uses 4 workers for estimates", () => {
    expect(EXTRACTING_CONCURRENCY_FOR_ESTIMATE).toBe(4);
  });
});
