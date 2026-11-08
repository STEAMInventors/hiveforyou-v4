import { describe, expect, it } from "vitest";

import {
  EXTRACT_RANGE_CUTOFF_OR_TIMEOUT_LIMIT,
  EXTRACT_SINGLE_PAGE_ATTEMPT_LIMIT,
  EXTRACT_ZERO_PROGRESS_HANDOFF_LIMIT,
  cloudflareProxyLimitSuspect,
  decideExtractRangeFailureAction,
  isTimeoutOrCutoffFailure,
  labelExtractPageRange,
  parseExtractPageRangeLabel,
  plannerCallDurationMs,
  resolveExtractZeroProgressHandoffLimit,
  splitExtractPageRangeLabel,
} from "./extract-range-resilience";

describe("extract range resilience", () => {
  it("treats invocation deadline aborts and planner timeouts as cut-offs", () => {
    expect(isTimeoutOrCutoffFailure({ errorCode: "MODEL_TIMEOUT", diagnosticReason: "planner_timeout" })).toBe(true);
    expect(isTimeoutOrCutoffFailure({ errorCode: "MODEL_TIMEOUT", diagnosticReason: "planner_gateway_timeout" })).toBe(true);
    expect(
      isTimeoutOrCutoffFailure({
        errorCode: "MODEL_UNAVAILABLE",
        diagnosticReason: "planner_network_error",
        abortedByInvocationDeadline: true,
      }),
    ).toBe(true);
    expect(isTimeoutOrCutoffFailure({ errorCode: "MODEL_UNAVAILABLE", diagnosticReason: "planner_network_error" })).toBe(
      false,
    );
    expect(isTimeoutOrCutoffFailure({ errorCode: "MODEL_TIMEOUT", diagnosticReason: "invocation_ended" })).toBe(true);
  });

  it("records a single-page truncation as a gap instead of failing the run", () => {
    expect(
      decideExtractRangeFailureAction({
        pageCount: 1,
        timeoutOrCutoffAttempts: 0,
        totalAttempts: 0,
        retryable: false,
        truncationGap: true,
      }),
    ).toBe("record_gap");
  });

  it("splits multi-page ranges after repeated cut-offs and gaps single pages after three attempts", () => {
    expect(
      decideExtractRangeFailureAction({
        pageCount: 4,
        timeoutOrCutoffAttempts: EXTRACT_RANGE_CUTOFF_OR_TIMEOUT_LIMIT,
        totalAttempts: 2,
        retryable: true,
      }),
    ).toBe("split");
    expect(
      decideExtractRangeFailureAction({
        pageCount: 1,
        timeoutOrCutoffAttempts: 2,
        totalAttempts: EXTRACT_SINGLE_PAGE_ATTEMPT_LIMIT,
        retryable: true,
      }),
    ).toBe("record_gap");
  });

  it("parses and splits page range labels", () => {
    expect(parseExtractPageRangeLabel("11-30", 40)).toEqual(Array.from({ length: 20 }, (_, index) => 11 + index));
    expect(splitExtractPageRangeLabel("11-30", 40)).toEqual(["11-20", "21-30"]);
    expect(labelExtractPageRange([3, 4])).toBe("3-4");
  });

  it("defaults zero-progress handoff cap to three", () => {
    expect(resolveExtractZeroProgressHandoffLimit()).toBe(EXTRACT_ZERO_PROGRESS_HANDOFF_LIMIT);
  });

  it("flags failures near 100 s as possible proxy limits", () => {
    expect(cloudflareProxyLimitSuspect(99_500)).toBe(true);
    expect(cloudflareProxyLimitSuspect(100_400)).toBe(true);
    expect(cloudflareProxyLimitSuspect(60_000)).toBe(false);
    expect(plannerCallDurationMs({ roundTripMs: 10, latencyMs: 99_800 })).toBe(99_800);
  });
});
