export const ERROR_CATEGORIES = [
  "VALIDATION",
  "SECURITY",
  "DOCUMENT",
  "MODEL",
  "DEPENDENCY",
  "EVIDENCE",
  "PERSISTENCE",
  "SECURITY_PROCESSING",
  "INTERNAL",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export function isErrorCategory(value: string): value is ErrorCategory {
  return (ERROR_CATEGORIES as readonly string[]).includes(value);
}
