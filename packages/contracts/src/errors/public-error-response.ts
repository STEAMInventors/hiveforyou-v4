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
    case "INVALID_DOCUMENT":
    case "DOCUMENT_UNREADABLE":
    case "COVERAGE_INCOMPLETE":
    case "PAGE_READ_FAILED":
      return 422;
    case "UNAUTHENTICATED":
      return 401;
    case "ACCESS_DENIED":
    case "SOURCE_ACCESS_DENIED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "IDEMPOTENCY_CONFLICT":
    case "QUOTA_EXCEEDED":
      return 409;
    case "MODEL_OUTPUT_INVALID":
      return 502;
    case "PERSISTENCE_FAILED":
    case "STORAGE_UNAVAILABLE":
    case "MODEL_UNAVAILABLE":
      return 503;
    case "MODEL_TIMEOUT":
      return 504;
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
}
