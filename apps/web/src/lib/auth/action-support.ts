import "server-only";

import { cookies, headers } from "next/headers";

import { CORRELATION_HEADER, resolveCorrelationId } from "@/lib/correlation/constants";
import { resolveAppOrigin } from "@/lib/config/app-origin";
import { logServerEvent } from "@/lib/server/log";

import type { MappedAuthError } from "./map-auth-error";
import { authLogLevel, sanitizeDiagnostic } from "./map-auth-error";
import { RECOVERY_COOKIE_NAME, recoveryCookieIsSecure, recoveryCookieOptions } from "./recovery";

export async function requestCorrelationId(): Promise<string> {
  const headerStore = await headers();
  return resolveCorrelationId(headerStore.get(CORRELATION_HEADER));
}

export async function requestAppOrigin(): Promise<string> {
  const headerStore = await headers();
  return resolveAppOrigin({ hostHeader: headerStore.get("host") });
}

export function logAuthFailure(
  route: string,
  correlationId: string,
  mapped: MappedAuthError,
  durationMs?: number,
): void {
  logServerEvent({
    level: authLogLevel(mapped),
    service: "web",
    correlation_id: correlationId,
    route,
    error_code: mapped.errorCode,
    retryable: mapped.retryable,
    diagnostic_detail: sanitizeDiagnostic(mapped.diagnostic),
    duration_ms: durationMs,
  });
}

export function logAuthInfo(
  route: string,
  correlationId: string,
  diagnostic: string,
  durationMs?: number,
): void {
  logServerEvent({
    level: "info",
    service: "web",
    correlation_id: correlationId,
    route,
    retryable: false,
    diagnostic_detail: sanitizeDiagnostic(diagnostic),
    duration_ms: durationMs,
  });
}

export async function clearRecoveryCookies(): Promise<void> {
  const cookieStore = await cookies();
  const options = recoveryCookieOptions(recoveryCookieIsSecure(), 0);
  cookieStore.set(RECOVERY_COOKIE_NAME, "", options);
}

/** Issued only after successful recovery OTP or callback verification. */
export async function issueRecoveryMarker(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_COOKIE_NAME, "1", recoveryCookieOptions(recoveryCookieIsSecure()));
}
