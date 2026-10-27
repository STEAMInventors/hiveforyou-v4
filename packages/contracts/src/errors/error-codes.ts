export const ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "ACCESS_DENIED",
  "NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "PERSISTENCE_FAILED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
