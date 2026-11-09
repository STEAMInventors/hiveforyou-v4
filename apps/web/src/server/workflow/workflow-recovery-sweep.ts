import { createHiveError, isValidUuid } from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";
import type { DocumentPageRpcClient } from "@/server/source-documents/document-pages-persistence";

import { parseWorkItem, type Dispatch, type WorkItem } from "./dispatch";

/** Hives processed per cron tick; matches `sweep_workflow_recovery` default cap. */
export const WORKFLOW_SWEEP_HIVE_LIMIT = 20;

export type WorkflowRecoverySweepResult = {
  readonly hivesScanned: number;
  readonly hiveIds: readonly string[];
  readonly revived: readonly WorkItem[];
};

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

function workItemsFrom(payload: Record<string, unknown> | null): WorkItem[] {
  if (!payload || !Array.isArray(payload.dispatch)) return [];
  const items: WorkItem[] = [];
  for (const entry of payload.dispatch) {
    const item = parseWorkItem(entry);
    if (item && item.kind !== "document_read") items.push(item);
  }
  return items;
}

function hiveIdsFrom(payload: Record<string, unknown> | null): string[] {
  if (!payload || !Array.isArray(payload.hiveIds)) return [];
  const ids: string[] = [];
  for (const entry of payload.hiveIds) {
    if (typeof entry !== "string") continue;
    const id = entry.trim().toLowerCase();
    if (isValidUuid(id)) ids.push(id);
  }
  return ids;
}

function sweepRpcMissing(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("sweep_workflow_recovery") && (text.includes("does not exist") || text.includes("schema cache"));
}

/**
 * Runs lost-handoff and expired-lease recovery for up to {@link WORKFLOW_SWEEP_HIVE_LIMIT} Hives,
 * then dispatches reserved work items. Idempotent with owner poll recovery.
 */
export async function sweepWorkflowRecovery(input: {
  readonly client: DocumentPageRpcClient;
  readonly correlationId: string;
  readonly createDispatch: () => Dispatch;
  readonly hiveLimit?: number;
}): Promise<WorkflowRecoverySweepResult> {
  const limit = input.hiveLimit ?? WORKFLOW_SWEEP_HIVE_LIMIT;
  const { data, error } = await input.client.rpc("sweep_workflow_recovery", { p_hive_limit: limit });
  if (error) {
    if (sweepRpcMissing(error.message ?? "")) {
      return { hivesScanned: 0, hiveIds: [], revived: [] };
    }
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "Could not reach your reports right now. Please try again.",
      correlationId: input.correlationId,
      diagnosticReason: "persistence_failed",
      cause: error,
    });
  }
  const payload = parsePayload(data);
  if (!payload) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "Could not reach your reports right now. Please try again.",
      correlationId: input.correlationId,
      diagnosticReason: "unexpected_edge_shape",
    });
  }
  const revived = workItemsFrom(payload);
  const hiveIds = hiveIdsFrom(payload);
  const hivesScanned =
    typeof payload.hivesScanned === "number" && Number.isInteger(payload.hivesScanned)
      ? Math.max(0, payload.hivesScanned)
      : hiveIds.length;

  if (revived.length > 0) {
    let dispatch: Dispatch;
    try {
      dispatch = input.createDispatch();
    } catch {
      emitStructuredEvent({
        eventName: "workflow.recovery_sweep.completed",
        severity: "WARN",
        timestamp: new Date().toISOString(),
        component: "workflow",
        operation: "recovery_sweep",
        stage: "ANALYZE",
        correlationId: input.correlationId,
        diagnosticReason: "dispatch_unconfigured",
        diagnosticField: JSON.stringify({ hivesScanned, hiveIds, dispatchCount: revived.length }),
      });
      return { hivesScanned, hiveIds, revived: [] };
    }
    for (const item of revived) {
      await dispatch(item, input.correlationId);
    }
  }

  emitStructuredEvent({
    eventName: "workflow.recovery_sweep.completed",
    severity: "INFO",
    timestamp: new Date().toISOString(),
    component: "workflow",
    operation: "recovery_sweep",
    stage: "ANALYZE",
    correlationId: input.correlationId,
    diagnosticReason: revived.length > 0 ? "workflow_revived" : "workflow_sweep_idle",
    diagnosticField: JSON.stringify({
      hivesScanned,
      hiveIds,
      dispatchCount: revived.length,
      revived: revived.map((item) => ({ kind: item.kind, id: item.id })),
    }),
  });

  return { hivesScanned, hiveIds, revived };
}
