import type { DocumentsLibraryRow, FindingsOpenItem, SourceDocument, StudyViewSources } from "@hiveforyou/contracts";

import type { ChipRef } from "@/components/study/SourceChip";
import type { DocumentsLibraryReadMetrics } from "./documents-library-metrics";

export function openItemForChecklistGap(
  gapId: string,
  openItems: readonly FindingsOpenItem[],
): FindingsOpenItem | null {
  const id = gapId.trim();
  if (id === "") return null;
  return openItems.find((item) => item.id === `gap-${id}` || item.id === `request-${id}`) ?? null;
}

export function firstChipForOpenItem(item: FindingsOpenItem, sources: StudyViewSources | null): ChipRef | null {
  if (!sources) return null;
  for (const factId of item.factIds) {
    const ref = sources.facts[factId];
    if (!ref) continue;
    return {
      sourceDocumentId: ref.sourceDocumentId,
      pageNumber: ref.pageNumber,
      quote: ref.quote,
      factIds: [factId],
    };
  }
  return null;
}

export function stillToComeCount(checklist: readonly { status: string }[]): number {
  return checklist.filter((item) => item.status === "not_in").length;
}

export type DocumentsSummaryParts = {
  fileCount: number;
  pageCount: number;
  unreadableFiles: number;
  duplicateSets: number;
};

export function buildDocumentsSummaryParts(
  documents: readonly SourceDocument[],
  rows: readonly DocumentsLibraryRow[],
  metrics: DocumentsLibraryReadMetrics,
): DocumentsSummaryParts {
  let pageCount = 0;
  let unreadableFiles = 0;
  for (const document of documents) {
    const pages = metrics.pageCounts[document.sourceDocumentId] ?? null;
    if (pages != null) pageCount += pages;
    const unreadable =
      document.readStatus === "UNREADABLE" ||
      document.readStatus === "FAILED" ||
      metrics.unreadableFirstPage[document.sourceDocumentId] != null;
    if (unreadable) unreadableFiles += 1;
  }
  const duplicateSets = rows.filter((row) => row.readState === "duplicate").length;
  return {
    fileCount: documents.length,
    pageCount,
    unreadableFiles,
    duplicateSets,
  };
}