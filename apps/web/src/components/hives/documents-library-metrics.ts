import type { CoverageGap } from "@hiveforyou/contracts";

type EligibilityDocument = {
  readonly sourceDocumentId: string;
  readonly totalPhysicalPages?: number;
  readonly verifiedPageCount?: number;
  readonly missingPageNumbers?: readonly number[];
};

export type DocumentsLibraryReadMetrics = {
  readonly pageCounts: Readonly<Record<string, number>>;
  readonly verifiedPages: Readonly<Record<string, number>>;
  readonly unreadableFirstPage: Readonly<Record<string, number>>;
  readonly coverageLineFor: (sourceDocumentId: string) => string | null;
};

export function buildDocumentsLibraryReadMetrics(
  eligibilityDocuments: readonly EligibilityDocument[],
  coverageGaps: readonly CoverageGap[],
): DocumentsLibraryReadMetrics {
  const pageCounts: Record<string, number> = {};
  const verifiedPages: Record<string, number> = {};
  const unreadableFirstPage: Record<string, number> = {};

  for (const document of eligibilityDocuments) {
    const key = document.sourceDocumentId;
    if (document.totalPhysicalPages != null) pageCounts[key] = document.totalPhysicalPages;
    if (document.verifiedPageCount != null) verifiedPages[key] = document.verifiedPageCount;
    const firstMissing = document.missingPageNumbers?.[0];
    if (firstMissing != null) unreadableFirstPage[key] = firstMissing;
  }

  for (const gap of coverageGaps) {
    if (gap.reason !== "PAGES_NOT_READ" || gap.pageNumbers.length === 0) continue;
    const key = gap.sourceDocumentId;
    const sorted = [...gap.pageNumbers].sort((a, b) => a - b);
    if (unreadableFirstPage[key] == null) unreadableFirstPage[key] = sorted[0]!;
  }

  const coverageLineFor = (sourceDocumentId: string): string | null => {
    const key = sourceDocumentId;
    const total = pageCounts[key];
    const verified = verifiedPages[key];
    if (total == null || verified == null) return null;
    const unreadable = unreadableFirstPage[key];
    const base = verified >= total ? `${total} of ${total} pages read` : `${verified} of ${total} pages read`;
    if (unreadable != null) return `${base}; p.${unreadable} unreadable`;
    return base;
  };

  return { pageCounts, verifiedPages, unreadableFirstPage, coverageLineFor };
}