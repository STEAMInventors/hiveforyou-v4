export const CORRELATION_HEADER = "x-correlation-id";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveEdgeCorrelationId(headerValue: string | null): string {
  const trimmed = headerValue?.trim();
  if (trimmed && trimmed.length <= 64 && UUID_REGEX.test(trimmed)) {
    return trimmed;
  }
  return crypto.randomUUID();
}

export function jsonResponse(
  body: unknown,
  status = 200,
  correlationId?: string,
): Response {
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
  };
  if (correlationId) {
    headers[CORRELATION_HEADER] = correlationId;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

const ALLOWLISTED_EDGE_LOG_FIELDS = [
  "eventName",
  "severity",
  "timestamp",
  "component",
  "operation",
  "stage",
  "correlationId",
  "status",
  "errorCode",
  "retryable",
  "durationMs",
  "diagnosticReason",
  "hiveId",
] as const;

/** Matches `apps/web/src/server/observability/logger.ts` diagnostic allowlist. */
const ALLOWED_DIAGNOSTIC_REASONS = new Set([
  "correlation_regenerated",
  "unexpected_exception",
  "no_session",
  "session_mismatch",
  "session_expired",
  "invalid_json",
  "invalid_payload_shape",
  "unexpected_field",
  "invalid_client_request_id",
  "invalid_name",
  "invalid_description",
  "invalid_hive_id",
  "invalid_request",
  "idempotency_conflict",
  "unique_violation",
  "not_found",
  "access_denied",
  "timeout",
  "edge_invoke_error",
  "empty_edge_payload",
  "unexpected_edge_shape",
  "persistence_failed",
  "unsupported_operation",
  "sign_in_accepted",
  "sign_up_accepted",
  "sign_up_check_email",
  "sign_out_accepted",
  "session_exchanged",
  "recovery_session",
  "otp_verified",
  "reset_email_accepted",
  "confirmation_resend_accepted",
  "password_updated",
  "recovery_exit_accepted",
  "invalid_credentials",
  "email_not_confirmed",
  "weak_password",
  "same_password",
  "rate_limited",
  "fetch_failed",
  "link_expired",
  "link_reused",
  "link_invalid",
  "missing_code",
  "email_invalid",
  "email_or_password_missing",
  "password_policy",
  "password_mismatch",
  "password_missing",
  "recovery_cookie_missing",
  "session_missing",
  "unclassified",
]);

const SENSITIVE_KEY_PATTERN =
  /password|token|quote|documenttext|prompt|authorization|secret|credential|ssn|phi|pii/i;

const FORBIDDEN_LOG_MARKERS = [
  "documenttext",
  "exactquote",
  "password",
  "token",
] as const;

export function logEdgeEvent(fields: Record<string, unknown>): void {
  const record: Record<string, string | number | boolean> = {};
  for (const key of ALLOWLISTED_EDGE_LOG_FIELDS) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    const value = fields[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      if (key === "diagnosticReason" && typeof value === "string") {
        record[key] = ALLOWED_DIAGNOSTIC_REASONS.has(value)
          ? value
          : "unexpected_exception";
        continue;
      }
      record[key] =
        typeof value === "string" && value.length > 200
          ? value.slice(0, 200)
          : value;
    }
  }
  if (!record.timestamp) {
    record.timestamp = new Date().toISOString();
  }
  if (!record.component) {
    record.component = "edge-v1-hives";
  }
  const line = JSON.stringify(record);
  const lowered = line.toLowerCase();
  for (const forbidden of FORBIDDEN_LOG_MARKERS) {
    if (lowered.includes(forbidden)) {
      return;
    }
  }
  console.log(line);
}

export type PublicErrorBody = {
  error: {
    errorCode: string;
    category: string;
    message: string;
    stage: string;
    retryable: boolean;
    correlationId: string;
    timestamp: string;
  };
};

export function buildPublicErrorBody(input: {
  errorCode: string;
  category: string;
  message: string;
  stage?: string;
  retryable: boolean;
  correlationId: string;
}): PublicErrorBody {
  return {
    error: {
      errorCode: input.errorCode,
      category: input.category,
      message: input.message,
      stage: input.stage ?? "SHELL",
      retryable: input.retryable,
      correlationId: input.correlationId,
      timestamp: new Date().toISOString(),
    },
  };
}
