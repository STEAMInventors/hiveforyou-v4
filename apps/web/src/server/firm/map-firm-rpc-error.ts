import { createHiveError, type HiveError } from "@hiveforyou/contracts";

import { attachFirmHttpStatus } from "./validate-practice-areas";

type SupabaseRpcError = {
  code?: string;
  message?: string;
};

const RPC_VALIDATION_MESSAGES: Record<string, string> = {
  name: "Enter a firm name up to 100 characters.",
  assistant_name: "Assistant name must be 40 characters or fewer.",
  practice_areas: `Choose up to 20 areas.`,
  practice_area_id: "Choose from the listed areas.",
  body: "Tell us what you handle in 2000 characters or fewer.",
};

function validationMessageFromRpc(message: string): string | null {
  const match = /invalid_request:([a-z_]+)/i.exec(message);
  if (!match?.[1]) return null;
  return RPC_VALIDATION_MESSAGES[match[1]] ?? null;
}

export function mapFirmRpcError(error: SupabaseRpcError, correlationId: string): HiveError {
  const code = typeof error.code === "string" ? error.code.trim() : "";
  const message = typeof error.message === "string" ? error.message : "";
  const lowered = message.toLowerCase();

  if (code === "42501" || lowered.includes("auth_required") || lowered.includes("access_denied")) {
    return attachFirmHttpStatus(
      createHiveError({
        errorCode: "NOT_FOUND",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "We could not find that.",
        correlationId,
        diagnosticReason: "access_denied",
        cause: error,
      }),
      404,
    );
  }

  if (code === "22023" || lowered.includes("invalid_request")) {
    const fieldMessage = validationMessageFromRpc(message);
    return attachFirmHttpStatus(
      createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: fieldMessage ?? "Check your input and try again.",
        correlationId,
        diagnosticReason: "invalid_request",
        cause: error,
      }),
      400,
    );
  }

  if (lowered.includes("rate_limited") || (code === "P0001" && lowered.includes("rate_limited"))) {
    return attachFirmHttpStatus(
      createHiveError({
        errorCode: "QUOTA_EXCEEDED",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "You've sent several requests today. We'll be in touch.",
        correlationId,
        diagnosticReason: "rate_limited",
        cause: error,
      }),
      429,
    );
  }

  if (code === "23505" && lowered.includes("firm_membership_exists")) {
    return attachFirmHttpStatus(
      createHiveError({
        errorCode: "IDEMPOTENCY_CONFLICT",
        category: "PERSISTENCE",
        stage: "SHELL",
        retryable: false,
        safeMessage: "You already have a practice set up.",
        correlationId,
        diagnosticReason: "firm_membership_exists",
        cause: error,
      }),
      409,
    );
  }

  return attachFirmHttpStatus(
    createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: "Could not save right now. Try again.",
      correlationId,
      diagnosticReason: "persistence_failed",
      cause: error,
    }),
    503,
  );
}

export function firmRpcHttpStatus(error: HiveError): number {
  const status = (error as { httpStatus?: number }).httpStatus;
  return typeof status === "number" ? status : 503;
}