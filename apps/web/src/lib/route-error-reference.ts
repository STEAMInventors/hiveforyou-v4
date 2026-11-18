type RoutedError = Error & { digest?: string; correlationId?: string };

function correlationIdFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.correlationId === "string" && record.correlationId.trim()) {
    return record.correlationId.trim();
  }
  if (record.cause) return correlationIdFromUnknown(record.cause);
  return null;
}

/** Prefer our correlation id; only otherwise expose Next's digest as an error code (not a reference). */
export function routeErrorReferences(error: RoutedError): {
  correlationId: string | null;
  errorDigest: string | null;
} {
  const correlationId = correlationIdFromUnknown(error);
  if (correlationId) {
    return { correlationId, errorDigest: null };
  }
  const digest = typeof error.digest === "string" && error.digest.trim() ? error.digest.trim() : null;
  return { correlationId: null, errorDigest: digest };
}