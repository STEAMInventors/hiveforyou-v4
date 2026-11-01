import type { DomainPackAvailabilityStatus } from "./enums.js";

export type RoutingEvidenceRef = {
  inputDocumentIndex: number;
  pageRange: { startPage: number; endPage: number } | null;
  sourceDocumentId?: string | undefined;
};

export type DomainResolutionCandidate = {
  domain: string;
  confidence: number | null;
  evidenceRefs: RoutingEvidenceRef[];
};

export type HiveDiscoverDomainPack = {
  status: DomainPackAvailabilityStatus;
  domain: string | null;
  packId: string | null;
  version: string | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export const hiveDiscoverDomainPackSchema = {
  safeParse(
    candidate: unknown,
  ): { success: true; data: HiveDiscoverDomainPack } | { success: false } {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { success: false };
    }
    const obj = candidate as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (
      keys.length !== 4 ||
      !keys.every((k) => k === "status" || k === "domain" || k === "packId" || k === "version")
    ) {
      return { success: false };
    }
    const { status, domain, packId, version } = obj;
    if (status === "AVAILABLE") {
      if (isNonEmptyString(domain) && isNonEmptyString(packId) && isNonEmptyString(version)) {
        return { success: true, data: { status, domain, packId, version } };
      }
      return { success: false };
    }
    if (status === "NOT_AVAILABLE") {
      if (isNonEmptyString(domain) && packId === null && version === null) {
        return { success: true, data: { status, domain, packId: null, version: null } };
      }
      return { success: false };
    }
    if (status === "NOT_APPLICABLE") {
      if (domain === null && packId === null && version === null) {
        return { success: true, data: { status, domain: null, packId: null, version: null } };
      }
      return { success: false };
    }
    return { success: false };
  },
};
