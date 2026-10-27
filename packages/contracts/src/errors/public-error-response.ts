import type { HiveError } from "./hive-error";

export type PublicErrorBody = {
  error: {
    errorCode: string;
    category: string;
    message: string;
    stage: string;
    retryable: boolean;
    correlationId: string;
    timestamp: string;
    operationId?: string;
  };
};

export function toPublicErrorResponse(error: HiveError): PublicErrorBody {
  return {
    error: {
      errorCode: error.errorCode,
      category: error.category,
      message: error.safeMessage,
      stage: error.stage,
      retryable: error.retryable,
      correlationId: error.correlationId,
      timestamp: new Date().toISOString(),
      ...(error.operationId ? { operationId: error.operationId } : {}),
    },
  };
}

export function suggestedHttpStatus(errorCode: string): number {
  switch (errorCode) {
    case "INVALID_REQUEST":
      return 422;
    case "UNAUTHENTICATED":
      return 401;
    case "ACCESS_DENIED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "PERSISTENCE_FAILED":
      return 503;
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
}
