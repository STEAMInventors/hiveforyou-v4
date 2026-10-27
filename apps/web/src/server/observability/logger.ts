export const ALLOWLISTED_LOG_FIELDS = [
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
  "attempt",
  "hiveId",
  "processingRunId",
  "sourceDocumentId",
] as const;

export type AllowlistedLogField = (typeof ALLOWLISTED_LOG_FIELDS)[number];

export type StructuredLogRecord = Partial<
  Record<AllowlistedLogField, string | number | boolean>
> & {
  eventName: string;
  severity: "DEBUG" | "INFO" | "WARN" | "ERROR";
  timestamp: string;
  component: string;
  operation: string;
  correlationId: string;
};

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

function sanitizeValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") {
    if (value.length > 500) {
      return "[redacted:long-string]";
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

export function buildStructuredLogRecord(
  input: Record<string, unknown>,
): StructuredLogRecord {
  const output: Record<string, string | number | boolean> = {};

  for (const key of ALLOWLISTED_LOG_FIELDS) {
    if (!(key in input)) {
      continue;
    }
    const raw = input[key];
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    if (key === "diagnosticReason" && typeof raw === "string") {
      if (!ALLOWED_DIAGNOSTIC_REASONS.has(raw)) {
        output[key] = "unexpected_exception";
      } else {
        output[key] = raw;
      }
      continue;
    }
    const sanitized = sanitizeValue(raw);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }

  if (
    typeof output.eventName !== "string" ||
    typeof output.severity !== "string" ||
    typeof output.timestamp !== "string" ||
    typeof output.component !== "string" ||
    typeof output.operation !== "string" ||
    typeof output.correlationId !== "string"
  ) {
    throw new Error("Structured log record missing required fields");
  }

  return output as StructuredLogRecord;
}

export function emitStructuredEvent(input: Record<string, unknown>): void {
  const record = buildStructuredLogRecord(input);
  const line = JSON.stringify(record);
  const lowered = line.toLowerCase();

  for (const forbidden of ["documenttext", "exactquote", "password", "token"]) {
    if (lowered.includes(forbidden)) {
      throw new Error("Refusing to emit log line containing sensitive marker");
    }
  }

  console.log(line);
}
