import { describe, expect, it } from "vitest";

import { pageExtractionCoverageGaps } from "./extraction-coverage-gaps";

const DOC = "abcdef12-3456-4789-8abc-def012345678";
const DIGEST = "sha256:" + "a".repeat(64);

describe("pageExtractionCoverageGaps", () => {
  it("builds nonmaterial per-page gaps for extraction failures", () => {
    expect(
      pageExtractionCoverageGaps({
        sourceDocumentId: DOC,
        fileName: "schedules.pdf",
        pageSetDigest: DIGEST,
        pageNumbers: [13, 3],
      }),
    ).toEqual([
      {
        key: `PAGES_NOT_EXTRACTED:${DOC}:${DIGEST}:3`,
        sourceDocumentId: DOC,
        fileName: "schedules.pdf",
        reason: "PAGES_NOT_EXTRACTED",
        pageNumbers: [3],
        material: false,
      },
      {
        key: `PAGES_NOT_EXTRACTED:${DOC}:${DIGEST}:13`,
        sourceDocumentId: DOC,
        fileName: "schedules.pdf",
        reason: "PAGES_NOT_EXTRACTED",
        pageNumbers: [13],
        material: false,
      },
    ]);
  });
});
