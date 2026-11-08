import { describe, expect, it } from "vitest";

import type { DocExtraction } from "./extraction-contracts";
import {
  documentPagesExtractedOrGapped,
  extractionRangeSuccessfullyRead,
  verifiedSavedRangeKeys,
} from "./extraction-range-validity";

const baseExtraction = (pagesRead: number[]): DocExtraction => ({
  schema: "hive.doc-extraction/1",
  documentId: "doc",
  fileName: "a.pdf",
  pageRange: "1",
  document: {
    titleAsPrinted: "",
    documentType: "",
    domain: { label: "", confidence: null },
    summary: "",
    issuer: null,
    aboutPeople: [],
    keyDates: [],
  },
  facts: [],
  emptyFields: [],
  referencedDocuments: [],
  glossary: [],
  instructionsIgnored: [],
  coverage: {
    pageCount: pagesRead.length,
    pagesRead,
    pagesBlankOrUnreadable: [],
    truncated: false,
    lastPageCompleted: pagesRead[pagesRead.length - 1] ?? 0,
  },
});

describe("extractionRangeSuccessfullyRead", () => {
  it("rejects empty extractions cached as range keys", () => {
    expect(extractionRangeSuccessfullyRead(baseExtraction([]), "3", 35)).toBe(false);
    expect(extractionRangeSuccessfullyRead(baseExtraction([]), "1-3", 35)).toBe(false);
  });

  it("accepts ranges whose pagesRead matches the key", () => {
    expect(extractionRangeSuccessfullyRead(baseExtraction([1, 2]), "1-2", 35)).toBe(true);
    expect(extractionRangeSuccessfullyRead(baseExtraction([3]), "3", 35)).toBe(true);
  });

  it("accepts unreadable pages recorded in pagesBlankOrUnreadable", () => {
    const unreadable: DocExtraction = {
      ...baseExtraction([]),
      coverage: {
        pageCount: 1,
        pagesRead: [],
        pagesBlankOrUnreadable: [2],
        truncated: false,
        lastPageCompleted: 0,
      },
    };
    expect(extractionRangeSuccessfullyRead(unreadable, "2", 3)).toBe(true);
  });
});

describe("documentPagesExtractedOrGapped", () => {
  it("counts verified ranges and gap pages", () => {
    const keys = verifiedSavedRangeKeys(
      [
        { pageRange: "1", extraction: baseExtraction([1]) },
        { pageRange: "2", extraction: baseExtraction([]) },
      ],
      3,
    );
    expect(keys).toEqual(new Set(["1"]));
    expect(documentPagesExtractedOrGapped(3, keys, new Set([3]))).toBe(false);
    expect(documentPagesExtractedOrGapped(3, new Set(["1", "2"]), new Set([3]))).toBe(true);
  });

  it("ignores range keys whose coverage.pagesRead does not cover the key", () => {
    const keys = verifiedSavedRangeKeys(
      [
        { pageRange: "1-10", extraction: baseExtraction([1, 2, 3]) },
        { pageRange: "11-20", extraction: baseExtraction(Array.from({ length: 10 }, (_, i) => i + 11)) },
        { pageRange: "21-25", extraction: baseExtraction([21, 22, 23, 24, 25]) },
      ],
      25,
    );
    expect(keys.has("1-10")).toBe(false);
    expect(keys.has("11-20")).toBe(true);
    expect(documentPagesExtractedOrGapped(25, keys, new Set())).toBe(false);
    expect(
      documentPagesExtractedOrGapped(
        25,
        verifiedSavedRangeKeys(
          [
            { pageRange: "1-10", extraction: baseExtraction(Array.from({ length: 10 }, (_, i) => i + 1)) },
            { pageRange: "11-20", extraction: baseExtraction(Array.from({ length: 10 }, (_, i) => i + 11)) },
            { pageRange: "21-25", extraction: baseExtraction([21, 22, 23, 24, 25]) },
          ],
          25,
        ),
        new Set(),
      ),
    ).toBe(true);
  });
});
