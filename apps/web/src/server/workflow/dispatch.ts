import { createHash, timingSafeEqual } from "node:crypto";

import { isValidUuid } from "@hiveforyou/contracts";
import { after } from "next/server";

import { resolveAppOrigin } from "@/server/config/app-origin";
import { emitStructuredEvent } from "@/server/observability/logger";

/**
 * Server-side hand-off between workflow invocations (D-041 B1). Each model stage runs in its own
 * function invocation; the previous one schedules the next work item on `/api/internal/workflow`.
 * When the HTTP post fails, the same process runs the work item directly so progress does not depend
 * on Cron or browser polling. A successful POST (202) and the in-process fallback are mutually
 * exclusive; duplicate deliveries still converge on one active lease via `claim_processing_run` /
 * `claim_report_run` compare-and-set in the database.
 */

export const WORK_KINDS = ["document_read", "analysis", "report"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
export type WorkItem = { readonly kind: WorkKind; readonly id: string };

export const INTERNAL_WORKFLOW_PATH = "/api/internal/workflow";
const DISPATCH_TIMEOUT_MS = 5_000;
const MIN_TOKEN_LENGTH = 32;

export type DispatchOptions = { readonly delaySeconds?: number };

export type Dispatch = (item: WorkItem, correlationId: string, options?: DispatchOptions) => Promise<boolean>;

export type WorkflowContinuationFallback = (item: WorkItem) => Promise<void>;

/** The shared secret; also stored in Supabase Vault as `hive_internal_worker_token`. */
export function loadInternalWorkerToken(env: NodeJS.ProcessEnv): string | null {
  const token = env.HIVE_INTERNAL_WORKER_TOKEN?.trim() ?? "";
  return token.length >= MIN_TOKEN_LENGTH ? token : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time bearer check. Fails closed when no token is configured. */
export function isAuthorizedWorkerRequest(authorization: string | null, token: string | null): boolean {
  if (!token || !authorization?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(authorization.slice("Bearer ".length).trim()), digest(token));
}

export function parseWorkItem(raw: unknown): WorkItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "kind" && key !== "id")) return null;
  const id = typeof record.id === "string" ? record.id.trim().toLowerCase() : "";
  if (!(WORK_KINDS as readonly string[]).includes(record.kind as string) || !isValidUuid(id)) return null;
  return { kind: record.kind as WorkKind, id };
}

function logDispatch(item: WorkItem, correlationId: string, diagnosticReason?: string): void {
  emitStructuredEvent({
    eventName: diagnosticReason ? "workflow.dispatch_failed" : "workflow.dispatched",
    severity: diagnosticReason ? "WARN" : "INFO",
    timestamp: new Date().toISOString(),
    component: "workflow",
    operation: `dispatch_${item.kind}`,
    correlationId,
    processingRunId: item.id,
    ...(diagnosticReason ? { diagnosticReason } : {}),
  });
}

export function createHttpDispatch(input: {
  readonly token: string | null;
  readonly origin?: string;
  readonly fetchFn?: typeof fetch;
}): Dispatch {
  const origin = input.origin ?? resolveAppOrigin();
  return async (item, correlationId) => {
    if (!input.token) {
      logDispatch(item, correlationId, "dispatch_unconfigured");
      return false;
    }
    try {
      const response = await (input.fetchFn ?? fetch)(`${origin}${INTERNAL_WORKFLOW_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify(item),
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });
      if (response.status !== 202) {
        logDispatch(item, correlationId, "dispatch_failed");
        return false;
      }
      logDispatch(item, correlationId);
      return true;
    } catch {
      logDispatch(item, correlationId, "dispatch_failed");
      return false;
    }
  };
}

/** Schedules the next invocation after an optional delay; runs `fallback` when the HTTP post fails. */
export function scheduleWorkflowContinuation(
  httpDispatch: Dispatch,
  fallback: WorkflowContinuationFallback | null,
  item: WorkItem,
  correlationId: string,
  delaySeconds: number,
): void {
  after(async () => {
    try {
      if (delaySeconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      }
      const accepted = await httpDispatch(item, correlationId);
      if (!accepted && fallback) {
        await fallback(item);
        return;
      }
    } catch {
      if (fallback) {
        await fallback(item).catch(() => null);
      }
    }
  });
}

/** HTTP dispatch to the internal route, with in-process fallback when the post fails. */
export function createWorkflowDispatch(input: {
  readonly token: string | null;
  readonly origin?: string;
  readonly fetchFn?: typeof fetch;
  readonly fallback: WorkflowContinuationFallback | null;
}): Dispatch {
  const httpDispatch = createHttpDispatch(input);
  return (item, correlationId, options) => {
    scheduleWorkflowContinuation(httpDispatch, input.fallback, item, correlationId, options?.delaySeconds ?? 0);
    return Promise.resolve(true);
  };
}
