import {
  createHiveError,
  isErrorCategory,
  isErrorCode,
  isProcessingStage,
  type HiveError,
} from "@hiveforyou/contracts";

import { VaultAdminConfigError } from "@/server/source-documents/v3-vault/persistence/vault-admin-config-error";

const ALLOWED_EXCEPTION_TYPE = /^[A-Z][A-Za-z0-9]{0,63}$/;

export type FailureDiagnostics = {
  exceptionType: string;
  diagnosticReason: string;
};

export function resolveFailureDiagnostics(error: unknown, hiveError: HiveError): FailureDiagnostics {
  if (error instanceof VaultAdminConfigError) {
    return {
      exceptionType: "VaultAdminConfigError",
      diagnosticReason: error.diagnosticReason,
    };
  }

  if (isHiveError(error)) {
    return {
      exceptionType: "HiveError",
      diagnosticReason: error.diagnosticReason ?? "unexpected_exception",
    };
  }

  const fromHive = hiveError.diagnosticReason;
  if (typeof fromHive === "string" && fromHive.length > 0) {
    const exceptionType =
      error instanceof Error && ALLOWED_EXCEPTION_TYPE.test(error.name) ? error.name : "HiveError";
    return { exceptionType, diagnosticReason: fromHive };
  }

  if (error instanceof Error) {
    const name = ALLOWED_EXCEPTION_TYPE.test(error.name) ? error.name : "Error";
    return { exceptionType: name, diagnosticReason: "unexpected_exception" };
  }

  return { exceptionType: "Unknown", diagnosticReason: "unexpected_exception" };
}

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
  if (error instanceof VaultAdminConfigError) {
    return createHiveError({
      errorCode: "INTERNAL_ERROR",
      category: "INTERNAL",
      stage: "SHELL",
      retryable: false,
      safeMessage:
        "Document storage is not configured correctly. Contact support with your reference.",
      correlationId,
      diagnosticReason: error.diagnosticReason,
      cause: error,
    });
  }

  if (isHiveError(error)) {
    return createHiveError({
      errorCode: error.errorCode,
      category: error.category,
      stage: error.stage,
      retryable: error.retryable,
      safeMessage: error.safeMessage,
      correlationId,
      operationId: error.operationId,
      diagnosticReason: error.diagnosticReason,
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
