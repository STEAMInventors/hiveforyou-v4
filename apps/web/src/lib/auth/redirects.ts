export function safeNextPath(value: string | null | undefined, fallback = "/hives"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value;
}
