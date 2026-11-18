import { createHiveError, type HiveError } from "@hiveforyou/contracts";

type SupabaseRpcError = {
  code?: string;
  message?: string;
};

export const CONVERSATION_SEND_FAILED = "Could not send right now. Try again.";
export const CONVERSATION_LOAD_FAILED = "Could not load the conversation. Try again.";
export const CONVERSATION_RATE_LIMITED = "You're sending messages quickly. Wait a moment and try again.";

const FIELD_MESSAGES: Record<string, string> = {
  body: "Write a message of up to 4,000 characters.",
  client_request_id: "This message could not be sent.",
  reply_to: "The message you replied to isn't in this hive.",
  up_to: "Request could not be processed.",
  before: "Request could not be processed.",
};

export function withHttpStatus(error: HiveError, httpStatus: number): HiveError {
  Object.defineProperty(error, "httpStatus", { value: httpStatus, enumerable: false, configurable: true });
  return error;
}

export function conversationInvalidRequest(field: string, correlationId: string, cause?: unknown): HiveError {
  return withHttpStatus(
    createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: FIELD_MESSAGES[field] ?? "Request could not be processed.",
      correlationId,
      diagnosticReason: "invalid_request",
      ...(cause !== undefined ? { cause } : {}),
    }),
    400,
  );
}

/**
 * One mapper for every conversation RPC. The public message never carries RPC text.
 * `fallbackMessage` is used for anything unrecognised (503, retryable).
 */
export function mapConversationRpcError(
  error: SupabaseRpcError,
  correlationId: string,
  fallbackMessage: string = CONVERSATION_SEND_FAILED,
): HiveError {
  const code = typeof error.code === "string" ? error.code.trim() : "";
  const message = typeof error.message === "string" ? error.message : "";
  const lowered = message.toLowerCase();

  if (code === "42501" || lowered.includes("hive_not_found")) {
    return withHttpStatus(
      createHiveError({
        errorCode: "NOT_FOUND",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "We could not find that hive.",
        correlationId,
        diagnosticReason: "not_found",
        cause: error,
      }),
      404,
    );
  }

  if (code === "22023" || lowered.includes("invalid_request")) {
    const field = /invalid_request:([a-z_]+)/i.exec(message)?.[1]?.toLowerCase() ?? "";
    return conversationInvalidRequest(field, correlationId, error);
  }

  if (code === "23505" || lowered.includes("idempotency_conflict")) {
    return withHttpStatus(
      createHiveError({
        errorCode: "IDEMPOTENCY_CONFLICT",
        category: "PERSISTENCE",
        stage: "SHELL",
        retryable: false,
        safeMessage: "This message was already sent with different text.",
        correlationId,
        diagnosticReason: "idempotency_conflict",
        cause: error,
      }),
      409,
    );
  }

  if (lowered.includes("rate_limited")) {
    return withHttpStatus(
      createHiveError({
        errorCode: "QUOTA_EXCEEDED",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: true,
        safeMessage: CONVERSATION_RATE_LIMITED,
        correlationId,
        diagnosticReason: "rate_limited",
        cause: error,
      }),
      429,
    );
  }

  return withHttpStatus(
    createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: fallbackMessage,
      correlationId,
      diagnosticReason: "persistence_failed",
      cause: error,
    }),
    503,
  );
}
