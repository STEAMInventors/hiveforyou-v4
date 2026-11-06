import type { CoverageGap } from "../study-preparation/study-preparation-contracts";

/** Owner-visible gaps when a single page could not be extracted within the model output cap. */
export function pageExtractionCoverageGaps(input: {
  sourceDocumentId: string;
  fileName: string;
  pageSetDigest: string;
  pageNumbers: readonly number[];
}): CoverageGap[] {
  const documentId = input.sourceDocumentId.toLowerCase();
  const digest = input.pageSetDigest.toLowerCase();
  return [...input.pageNumbers]
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((a, b) => a - b)
    .map((page) => ({
      key: `PAGES_NOT_EXTRACTED:${documentId}:${digest}:${page}`,
      sourceDocumentId: documentId,
      fileName: input.fileName,
      reason: "PAGES_NOT_EXTRACTED" as const,
      pageNumbers: [page],
      material: false,
    }));
}
