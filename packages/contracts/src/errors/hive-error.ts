import type { ErrorCategory } from "./error-categories";
import type { ErrorCode } from "./error-codes";
import type { ProcessingStage } from "./processing-stages";

export type HiveError = {
  errorCode: ErrorCode;
  category: ErrorCategory;
  stage: ProcessingStage;
  retryable: boolean;
  safeMessage: string;
  correlationId: string;
  operationId?: string;
  cause?: unknown;
};

export function createHiveError(input: HiveError): HiveError {
  const error: HiveError = {
    errorCode: input.errorCode,
    category: input.category,
    stage: input.stage,
    retryable: input.retryable,
    safeMessage: input.safeMessage,
    correlationId: input.correlationId,
  };

  if (typeof input.operationId === "string" && input.operationId.length > 0) {
    error.operationId = input.operationId;
  }

  if (input.cause !== undefined) {
    Object.defineProperty(error, "cause", {
      value: input.cause,
      enumerable: false,
      configurable: true,
    });
  }

  return error;
}
