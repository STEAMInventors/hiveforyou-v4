export const ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "ACCESS_DENIED",
  "SOURCE_ACCESS_DENIED",
  "NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_DOCUMENT",
  "DOCUMENT_UNREADABLE",
  "COVERAGE_INCOMPLETE",
  "PAGE_READ_FAILED",
  "STORAGE_UNAVAILABLE",
  "QUOTA_EXCEEDED",
  "PERSISTENCE_FAILED",
  "MODEL_TIMEOUT",
  "CLIENT_DEADLINE",
  "MODEL_UNAVAILABLE",
  "MODEL_OUTPUT_INVALID",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
