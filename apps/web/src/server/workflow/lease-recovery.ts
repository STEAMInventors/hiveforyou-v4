import { createHiveError, isValidUuid, type HiveError } from "@hiveforyou/contracts";

import type { DocumentPageRpcClient } from "@/server/source-documents/document-pages-persistence";

import { parseWorkItem, type Dispatch, type WorkItem } from "./dispatch";

/** How long a poll's re-dispatch reservation lasts. A second poll in that window does nothing. */
export const LEASE_RECOVERY_RESERVATION_MS = 50_000;

/**
 * Same ceiling as `claim_processing_run` (`v_attempt > 3`). Report runs use the row's `maxAttempts`
 * (constrained to 3). Recovery counts the attempt; a later claim does not count it again.
 */
export const PROCESSING_ATTEMPT_LIMIT = 3;

export const REPORT_INTERRUPTED_MESSAGE = "The report stopped before it finished. You can generate it again.";
export const PREPARATION_INTERRUPTED_MESSAGE = "Analysis stopped before it finished. You can try again.";

const TERMINAL_REPORT = new Set(["SUCCEEDED", "FAILED"]);
const SKIP_PROCESSING = new Set(["AWAITING_ACKNOWLEDGEMENT", "SUCCEEDED", "NEEDS_CLARIFICATION", "FAILED"]);

/**
 * One non-terminal run whose lease may have expired. `attemptCount` is `attempt_count` for a report
 * and `stage_attempt` for a processing run. Mirrors `public.recover_expired_workflow_leases`.
 */
export type ExpiredLeaseRow = {
  kind: "report" | "analysis";
  id: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  leaseExpiresAtMs: number | null;
  nextDispatchAtMs: number | null;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
  retryable?: boolean | null;
};

export type LeaseRecoveryPlan = {
  /** Re-dispatch. `attemptCount` on the row already includes this attempt. */
  dispatch: WorkItem[];
  /** Attempts were already exhausted; the row is FAILED and retryable. */
  failed: WorkItem[];
};

function leaseExpired(row: ExpiredLeaseRow, nowMs: number): boolean {
  return row.leaseExpiresAtMs !== null && row.leaseExpiresAtMs <= nowMs;
}

function reserved(row: ExpiredLeaseRow, nowMs: number): boolean {
  return row.nextDispatchAtMs !== null && row.nextDispatchAtMs > nowMs;
}

function attemptsExhausted(row: ExpiredLeaseRow): boolean {
  if (row.kind === "report") return row.attemptCount >= row.maxAttempts;
  if (row.status === "READING_DOCUMENTS") return false;
  return row.attemptCount >= row.maxAttempts;
}

function skip(row: ExpiredLeaseRow): boolean {
  return row.kind === "report" ? TERMINAL_REPORT.has(row.status) : SKIP_PROCESSING.has(row.status);
}

/**
 * Expired non-terminal leases: reserve a re-dispatch and count an attempt, or fail the row as
 * retryable when another attempt would be refused. `claim_*` does not count again while that
 * reservation is set. A row reserved until `nowMs` is left alone, so overlapping polls dispatch once.
 */
export function applyExpiredLeaseRecovery(rows: readonly ExpiredLeaseRow[], nowMs: number): LeaseRecoveryPlan {
  const dispatch: WorkItem[] = [];
  const failed: WorkItem[] = [];
  for (const row of rows) {
    if (skip(row) || !leaseExpired(row, nowMs) || reserved(row, nowMs)) continue;
    if (attemptsExhausted(row)) {
      row.status = "FAILED";
      row.leaseExpiresAtMs = null;
      row.nextDispatchAtMs = null;
      row.errorCode = row.kind === "report" ? "REPORT_INTERRUPTED" : "PREPARATION_INTERRUPTED";
      row.errorMessageSafe = row.kind === "report" ? REPORT_INTERRUPTED_MESSAGE : PREPARATION_INTERRUPTED_MESSAGE;
      row.retryable = true;
      failed.push({ kind: row.kind, id: row.id });
      continue;
    }
    if (!(row.kind === "analysis" && row.status === "READING_DOCUMENTS")) row.attemptCount += 1;
    row.nextDispatchAtMs = nowMs + LEASE_RECOVERY_RESERVATION_MS;
    dispatch.push({ kind: row.kind, id: row.id });
  }
  return { dispatch, failed };
}

function persistenceError(correlationId: string, diagnosticReason: string, cause?: unknown): HiveError {
  return createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "Could not reach your reports right now. Please try again.",
    correlationId,
    diagnosticReason,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function recoveryRpcMissing(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("recover_expired_workflow_leases") && (text.includes("does not exist") || text.includes("schema cache"));
}

function mapRpcError(error: { message?: string }, correlationId: string): HiveError {
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("hive_not_found")) {
    return createHiveError({
      errorCode: "NOT_FOUND",
      category: "SECURITY",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "We could not find that Hive.",
      correlationId,
      diagnosticReason: "not_found",
    });
  }
  if (message.includes("auth_required")) {
    return createHiveError({
      errorCode: "UNAUTHENTICATED",
      category: "SECURITY",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "Sign in to continue.",
      correlationId,
      diagnosticReason: "no_session",
    });
  }
  return persistenceError(correlationId, "persistence_failed", error);
}

function parsePayload(data: unknown): Record<string, unknown> | null {
  let payload: unknown = data;
  if (typeof data === "string") {
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

function workItemsFrom(payload: Record<string, unknown> | null): WorkItem[] | null {
  if (!payload || !Array.isArray(payload.dispatch)) return null;
  const items: WorkItem[] = [];
  for (const entry of payload.dispatch) {
    const item = parseWorkItem(entry);
    if (item && item.kind !== "document_read") items.push(item);
  }
  return items;
}

/**
 * On a Hive poll: atomically fail exhausted expired leases and reserve the rest, then dispatch
 * those reservations. `createDispatch` runs only when there is work, and a failure to build it
 * leaves the reservation to lapse so the next poll can try again.
 */
export async function recoverExpiredWorkflowLeases(input: {
  readonly client: DocumentPageRpcClient;
  readonly hiveId: string;
  readonly correlationId: string;
  readonly createDispatch: () => Dispatch;
}): Promise<void> {
  const hiveId = input.hiveId.trim().toLowerCase();
  if (!isValidUuid(hiveId)) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "Invalid Hive identifier.",
      correlationId: input.correlationId,
      diagnosticReason: "invalid_payload_shape",
    });
  }
  const { data, error } = await input.client.rpc("recover_expired_workflow_leases", { p_hive_id: hiveId });
  if (error) {
    if (recoveryRpcMissing(error.message ?? "")) return;
    throw mapRpcError(error, input.correlationId);
  }
  const items = workItemsFrom(parsePayload(data));
  if (!items) throw persistenceError(input.correlationId, "unexpected_edge_shape");
  if (items.length === 0) return;
  let dispatch: Dispatch;
  try {
    dispatch = input.createDispatch();
  } catch {
    return;
  }
  for (const item of items) {
    await dispatch(item, input.correlationId);
  }
}
