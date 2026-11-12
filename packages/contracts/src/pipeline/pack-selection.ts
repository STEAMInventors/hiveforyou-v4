import type { DocExtraction } from "./extraction-contracts";
import type { Pack } from "./pack-contracts";

export type PackIndexEntry = {
  readonly id: string;
  readonly fileName: string;
  readonly pack: Pack;
};

/** Minimum score to select a pack (intent + document hits). */
export const PACK_SELECTION_THRESHOLD = 2;

export type PackSelectionResult = {
  readonly id: string;
  readonly version: number;
  readonly score: number;
  readonly pack: Pack;
} | null;

function countMatches(needles: readonly string[], haystack: string): number {
  const lower = haystack.toLowerCase();
  let hits = 0;
  for (const needle of needles) {
    const term = needle.trim().toLowerCase();
    if (term !== "" && lower.includes(term)) hits += 1;
  }
  return hits;
}

function documentHaystack(extractions: readonly DocExtraction[]): string {
  return extractions
    .flatMap((extraction) => [
      extraction.fileName,
      extraction.document.documentType,
      extraction.document.titleAsPrinted,
      extraction.document.summary,
    ])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join("\n");
}

export function scorePack(
  entry: PackIndexEntry,
  requestText: string,
  extractions: readonly DocExtraction[],
): number {
  const pack = entry.pack;
  if (pack.briefOnly) return 0;
  const intentHits = countMatches(pack.meta.matches.intent, requestText);
  const docHits = countMatches(pack.meta.matches.documents, documentHaystack(extractions));
  return intentHits + docHits;
}

export function selectDomainPack(
  entries: readonly PackIndexEntry[],
  requestText: string,
  extractions: readonly DocExtraction[],
  threshold: number = PACK_SELECTION_THRESHOLD,
): PackSelectionResult {
  let best: PackSelectionResult = null;
  for (const entry of entries) {
    const score = scorePack(entry, requestText, extractions);
    if (score < threshold) continue;
    if (!best || score > best.score) {
      best = { id: entry.id, version: entry.pack.meta.version, score, pack: entry.pack };
    }
  }
  return best;
}
