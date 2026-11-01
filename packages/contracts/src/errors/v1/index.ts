// V3 compatibility shim for @hiveforyou/contracts/errors/v1 used by V3 auth modules.
export const ErrorCode = {
  INVALID_REQUEST: "INVALID_REQUEST",
  AUTH_FAILED: "AUTH_FAILED",
  DEPENDENCY_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
