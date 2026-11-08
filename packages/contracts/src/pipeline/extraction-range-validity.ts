import type { DocExtraction } from "./extraction-contracts";

/** Planner HTTP failures that mark a page as an extraction coverage gap (not a cached range). */
export const PAGE_EXTRACTION_GAP_ERROR_CODE = "PAGE_EXTRACTION_GAP";
export const PAGE_EXTRACTION_GAP_DIAGNOSTIC = "page_could_not_be_fully_extracted";

export function parsePageNumbersFromRangeKey(pageRange: string, totalPages: number): number[] {
  if (pageRange === "all") {
    return totalPages > 0 ? Array.from({ length: totalPages }, (_, index) => index + 1) : [];
  }
  if (/^\d+$/.test(pageRange)) return [Number(pageRange)];
  const match = /^(\d+)-(\d+)$/.exec(pageRange);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

/** True when the model reported every page in the range key as read (successful extract call). */
export function extractionRangeSuccessfullyRead(
  extraction: DocExtraction,
  pageRangeKey: string,
  verifiedPageCount: number,
): boolean {
  const expected = parsePageNumbersFromRangeKey(pageRangeKey.toLowerCase(), verifiedPageCount);
  if (expected.length === 0) return false;
  const read = new Set(extraction.coverage.pagesRead.filter((p) => Number.isInteger(p) && p > 0));
  const blank = new Set(
    extraction.coverage.pagesBlankOrUnreadable.filter((p) => Number.isInteger(p) && p > 0),
  );
  return expected.every((page) => read.has(page) || blank.has(page));
}

/** Keys for range rows that came from a successful model read (reusable cache). */
export function verifiedSavedRangeKeys(
  ranges: readonly { pageRange: string; extraction: DocExtraction }[],
  verifiedPageCount: number,
): Set<string> {
  const keys = new Set<string>();
  for (const row of ranges) {
    const key = row.pageRange.toLowerCase();
    if (extractionRangeSuccessfullyRead(row.extraction, key, verifiedPageCount)) keys.add(key);
  }
  return keys;
}

export function documentPagesExtractedOrGapped(
  verifiedPageCount: number,
  savedRangeKeys: ReadonlySet<string>,
  gapPageNumbers: ReadonlySet<number>,
): boolean {
  if (verifiedPageCount <= 0) return savedRangeKeys.size > 0 || gapPageNumbers.size > 0;
  const covered = new Set<number>();
  for (const key of savedRangeKeys) {
    for (const page of parsePageNumbersFromRangeKey(key, verifiedPageCount)) covered.add(page);
  }
  for (const page of gapPageNumbers) covered.add(page);
  for (let page = 1; page <= verifiedPageCount; page += 1) {
    if (!covered.has(page)) return false;
  }
  return true;
}
