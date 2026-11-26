/**
 * Chooses one published, approved Domain Pack edition for a Hive.
 * Domain knowledge stays on the edition. This module only compares versions,
 * publication, approval, and the edition's own applicability hints.
 */
import { PACK_SELECTION_THRESHOLD } from "./pack-selection";

export const PUBLISHED_DOMAIN_PACK_CATALOG_SCHEMA = "hive.published-domain-pack-catalog/1" as const;

export type PublishedEditionCandidate = {
  readonly domain: string;
  readonly packId: string;
  readonly version: string;
  readonly publication: string;
  readonly approval: string;
  readonly investigationPromptId: string;
  readonly intentHints: readonly string[];
  readonly documentHints: readonly string[];
};

export type HiveDomainText = {
  readonly intentText: string;
  readonly documents: readonly string[];
};

export type PublishedPackSelection =
  | { readonly status: "none" }
  | { readonly status: "selected"; readonly edition: PublishedEditionCandidate; readonly score: number };

const VERSION_PART = /^\d+$/;

function countMatches(needles: readonly string[], haystack: string): number {
  const lower = haystack.toLowerCase();
  let hits = 0;
  for (const needle of needles) {
    const term = needle.trim().toLowerCase();
    if (term !== "" && lower.includes(term)) hits += 1;
  }
  return hits;
}

/** Numeric dotted versions only. Anything else sorts below a valid version. */
export function compareEditionVersions(left: string, right: string): number {
  const a = left.split(".");
  const b = right.split(".");
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? "0";
    const bv = b[index] ?? "0";
    const aOk = VERSION_PART.test(av);
    const bOk = VERSION_PART.test(bv);
    if (!aOk || !bOk) return aOk === bOk ? 0 : aOk ? 1 : -1;
    const delta = Number(av) - Number(bv);
    if (delta !== 0) return delta;
  }
  return 0;
}

function isApproved(edition: PublishedEditionCandidate): boolean {
  return edition.publication === "PUBLISHED" && edition.approval === "APPROVED";
}

function scoreEdition(edition: PublishedEditionCandidate, hive: HiveDomainText): number {
  const haystack = [hive.intentText, ...hive.documents].join("\n");
  return countMatches([...edition.intentHints, ...edition.documentHints], haystack);
}

/**
 * Latest approved edition whose own hints match the Hive text.
 * A higher version in another domain does not win. A draft or unpublished edition does not win.
 */
export function selectPublishedDomainPack(
  editions: readonly PublishedEditionCandidate[],
  hive: HiveDomainText,
  threshold: number = PACK_SELECTION_THRESHOLD,
): PublishedPackSelection {
  const applicable = editions.filter((edition) => isApproved(edition) && scoreEdition(edition, hive) >= threshold);
  if (applicable.length === 0) return { status: "none" };
  const domains = new Map<string, PublishedEditionCandidate[]>();
  for (const edition of applicable) {
    const group = domains.get(edition.domain) ?? [];
    group.push(edition);
    domains.set(edition.domain, group);
  }
  let best: { edition: PublishedEditionCandidate; score: number } | null = null;
  for (const group of domains.values()) {
    const latest = group.reduce((current, edition) =>
      compareEditionVersions(edition.version, current.version) > 0 ? edition : current,
    );
    const score = Math.max(...group.map((edition) => scoreEdition(edition, hive)));
    if (
      !best ||
      score > best.score ||
      (score === best.score && compareEditionVersions(latest.version, best.edition.version) > 0) ||
      (score === best.score &&
        compareEditionVersions(latest.version, best.edition.version) === 0 &&
        latest.packId.localeCompare(best.edition.packId) < 0)
    ) {
      best = { edition: latest, score };
    }
  }
  return best ? { status: "selected", edition: best.edition, score: best.score } : { status: "none" };
}
