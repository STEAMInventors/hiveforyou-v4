import { cookies, headers } from "next/headers";

import { resolveAppOrigin } from "@/server/config/app-origin";
import {
  CORRELATION_HEADER,
  resolveCorrelationId,
} from "@/server/observability/correlation";
import { emitStructuredEvent } from "@/server/observability/logger";

import type { MappedAuthError } from "./map-auth-error";
import { authLogSeverity, sanitizeDiagnostic } from "./map-auth-error";
import {
  RECOVERY_COOKIE_NAME,
  recoveryCookieIsSecure,
  recoveryCookieOptions,
} from "./recovery";

export async function requestCorrelationId(): Promise<string> {
  const headerStore = await headers();
  return resolveCorrelationId(headerStore.get(CORRELATION_HEADER)).correlationId;
}

export async function requestAppOrigin(): Promise<string> {
  const headerStore = await headers();
  return resolveAppOrigin({ hostHeader: headerStore.get("host") });
}

export function logAuthFailure(
  operation: string,
  correlationId: string,
  mapped: MappedAuthError,
  durationMs?: number,
): void {
  emitStructuredEvent({
    eventName: `${operation}.failed`,
    severity: authLogSeverity(mapped),
    timestamp: new Date().toISOString(),
    component: "auth",
    operation,
    stage: "SHELL",
    correlationId,
    status: "FAILED",
    errorCode: mapped.errorCode,
    retryable: mapped.retryable,
    diagnosticReason: sanitizeDiagnostic(mapped.diagnostic),
    ...(durationMs !== undefined ? { durationMs } : {}),
  });
}

export function logAuthInfo(
  operation: string,
  correlationId: string,
  diagnosticReason: string,
  durationMs?: number,
): void {
  emitStructuredEvent({
    eventName: `${operation}.completed`,
    severity: "INFO",
    timestamp: new Date().toISOString(),
    component: "auth",
    operation,
    stage: "SHELL",
    correlationId,
    status: "SUCCEEDED",
    retryable: false,
    diagnosticReason: sanitizeDiagnostic(diagnosticReason),
    ...(durationMs !== undefined ? { durationMs } : {}),
  });
}

export async function clearRecoveryCookies(): Promise<void> {
  const cookieStore = await cookies();
  const options = recoveryCookieOptions(recoveryCookieIsSecure(), 0);
  cookieStore.set(RECOVERY_COOKIE_NAME, "", options);
}

export async function issueRecoveryMarker(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    RECOVERY_COOKIE_NAME,
    "1",
    recoveryCookieOptions(recoveryCookieIsSecure()),
  );
}
