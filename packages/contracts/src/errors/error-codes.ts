export const ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "ACCESS_DENIED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
