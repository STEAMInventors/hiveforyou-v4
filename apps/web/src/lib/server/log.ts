import type { ErrorCode } from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";

export type ServerLogEvent = {
  level: "info" | "warn" | "error";
  service: string;
  correlation_id: string;
  route: string;
  error_code?: string;
  retryable: boolean;
  diagnostic_detail?: string;
  duration_ms?: number;
};

function mapV3AuthErrorCode(code: string | undefined): ErrorCode {
  if (code === "INVALID_REQUEST") {
    return "INVALID_REQUEST";
  }
  if (code === "DEPENDENCY_UNAVAILABLE") {
    return "PERSISTENCE_FAILED";
  }
  return "UNAUTHENTICATED";
}

export function logServerEvent(event: ServerLogEvent): void {
  const isFailure = Boolean(event.error_code);
  const operation = event.route.replace(/^auth\./, "");
  emitStructuredEvent({
    eventName: `${operation}.${isFailure ? "failed" : "completed"}`,
    severity: event.level === "error" ? "ERROR" : event.level === "warn" ? "WARN" : "INFO",
    timestamp: new Date().toISOString(),
    component: "auth",
    operation,
    stage: "SHELL",
    correlationId: event.correlation_id,
    status: isFailure ? "FAILED" : "SUCCEEDED",
    ...(isFailure ? { errorCode: mapV3AuthErrorCode(event.error_code) } : {}),
    retryable: event.retryable,
    ...(event.diagnostic_detail ? { diagnosticReason: event.diagnostic_detail } : {}),
    ...(event.duration_ms !== undefined ? { durationMs: event.duration_ms } : {}),
  });
}
