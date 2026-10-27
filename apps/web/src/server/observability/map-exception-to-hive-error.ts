import {
  createHiveError,
  isErrorCategory,
  isErrorCode,
  isProcessingStage,
  type HiveError,
} from "@hiveforyou/contracts";

function isHiveError(value: unknown): value is HiveError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.errorCode === "string" &&
    isErrorCode(record.errorCode) &&
    typeof record.category === "string" &&
    isErrorCategory(record.category) &&
    typeof record.stage === "string" &&
    isProcessingStage(record.stage) &&
    typeof record.retryable === "boolean" &&
    typeof record.safeMessage === "string" &&
    typeof record.correlationId === "string"
  );
}

export function mapExceptionToHiveError(
  error: unknown,
  correlationId: string,
): HiveError {
  if (isHiveError(error)) {
    return createHiveError({
      errorCode: error.errorCode,
      category: error.category,
      stage: error.stage,
      retryable: error.retryable,
      safeMessage: error.safeMessage,
      correlationId,
      operationId: error.operationId,
      cause: error.cause,
    });
  }

  return createHiveError({
    errorCode: "INTERNAL_ERROR",
    category: "INTERNAL",
    stage: "SHELL",
    retryable: false,
    safeMessage: "Something went wrong. You can try again or contact support with your reference.",
    correlationId,
    cause: error,
  });
}
