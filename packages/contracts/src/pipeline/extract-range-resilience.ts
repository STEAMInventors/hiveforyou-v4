/** After this many cut-offs or planner timeouts on one multi-page range, split it before retrying again. */
export const EXTRACT_RANGE_CUTOFF_OR_TIMEOUT_LIMIT = 2;

/** After this many attempts on one page, record a page extraction gap and stop retrying that page. */
export const EXTRACT_SINGLE_PAGE_ATTEMPT_LIMIT = 3;

/** Cloudflare (and similar) proxy read limits often surface near 100 s wall clock. */
export const CLOUDFLARE_PROXY_LIMIT_MS = 100_000;
export const CLOUDFLARE_PROXY_LIMIT_TOLERANCE_MS = 5_000;

export type ExtractRangeFailureAction = "retry" | "split" | "record_gap" | "fail";

export function plannerCallDurationMs(input: {
  roundTripMs: number;
  latencyMs: number | null;
}): number {
  const roundTrip =
    typeof input.roundTripMs === "number" && Number.isFinite(input.roundTripMs)
      ? Math.max(0, Math.trunc(input.roundTripMs))
      : 0;
  if (typeof input.latencyMs === "number" && Number.isFinite(input.latencyMs) && input.latencyMs >= 0) {
    return Math.max(roundTrip, Math.trunc(input.latencyMs));
  }
  return roundTrip;
}

export function cloudflareProxyLimitSuspect(durationMs: number): boolean {
  if (!Number.isFinite(durationMs)) return false;
  const delta = Math.abs(durationMs - CLOUDFLARE_PROXY_LIMIT_MS);
  return delta <= CLOUDFLARE_PROXY_LIMIT_TOLERANCE_MS;
}

export function isTimeoutOrCutoffFailure(input: {
  errorCode: string | null | undefined;
  diagnosticReason: string | null | undefined;
  abortedByInvocationDeadline?: boolean;
}): boolean {
  if (input.abortedByInvocationDeadline) return true;
  if (input.errorCode === "MODEL_TIMEOUT") return true;
  const reason = input.diagnosticReason ?? "";
  return (
    reason === "planner_timeout" ||
    reason === "planner_gateway_timeout" ||
    reason === "invocation_deadline_abort" ||
    reason === "litellm_timeout" ||
    reason === "invocation_ended"
  );
}

export function decideExtractRangeFailureAction(input: {
  pageCount: number;
  timeoutOrCutoffAttempts: number;
  totalAttempts: number;
  retryable: boolean;
}): ExtractRangeFailureAction {
  const pageCount = Number.isInteger(input.pageCount) && input.pageCount > 0 ? input.pageCount : 1;
  const cutoffAttempts = Math.max(0, input.timeoutOrCutoffAttempts);
  const totalAttempts = Math.max(0, input.totalAttempts);

  if (pageCount === 1) {
    if (totalAttempts >= EXTRACT_SINGLE_PAGE_ATTEMPT_LIMIT) return "record_gap";
    return input.retryable ? "retry" : "fail";
  }

  if (cutoffAttempts >= EXTRACT_RANGE_CUTOFF_OR_TIMEOUT_LIMIT) return "split";
  if (!input.retryable) return "fail";
  return "retry";
}

export function parseExtractPageRangeLabel(
  pageRange: string | null,
  verifiedPageCount: number,
): number[] {
  if (pageRange === null) {
    return verifiedPageCount > 0
      ? Array.from({ length: verifiedPageCount }, (_, index) => index + 1)
      : [];
  }
  const trimmed = pageRange.trim();
  if (/^\d+$/.test(trimmed)) return [Number(trimmed)];
  const match = /^(\d+)-(\d+)$/.exec(trimmed);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function labelExtractPageRange(pageNumbers: readonly number[]): string | null {
  const sorted = [...pageNumbers].filter((page) => Number.isInteger(page) && page > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return String(sorted[0]);
  return `${sorted[0]}-${sorted[sorted.length - 1]}`;
}

/** Split one scheduled page range into two smaller ranges (first half / second half). */
export function splitExtractPageRangeLabel(
  pageRange: string | null,
  verifiedPageCount: number,
): [string | null, string | null] | null {
  const pages = parseExtractPageRangeLabel(pageRange, verifiedPageCount);
  if (pages.length <= 1) return null;
  const mid = Math.ceil(pages.length / 2);
  const left = labelExtractPageRange(pages.slice(0, mid));
  const right = labelExtractPageRange(pages.slice(mid));
  if (!left || !right) return null;
  return [left, right];
}
