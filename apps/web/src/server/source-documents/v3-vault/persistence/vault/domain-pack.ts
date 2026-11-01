import { hiveDiscoverDomainPackSchema, type HiveDiscoverDomainPack } from "@hives/contracts";
import { createCorrelationId, HiveError } from "@hives/core";

export function parsePersistedDomainPack(value: unknown): HiveDiscoverDomainPack | null {
  if (value === null || value === undefined) {
    return null;
  }
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      throw invalidDomainPack();
    }
  }
  const parsed = hiveDiscoverDomainPackSchema.safeParse(candidate);
  if (!parsed.success) {
    throw invalidDomainPack();
  }
  return parsed.data;
}

function invalidDomainPack(): HiveError {
  return new HiveError({
    code: "DOMAIN_PACK_PAYLOAD_INVALID",
    category: "STORAGE_ERROR",
    message: "Persisted domain pack availability is invalid.",
    retryable: false,
    severity: "FATAL",
    correlationId: createCorrelationId(),
  });
}
