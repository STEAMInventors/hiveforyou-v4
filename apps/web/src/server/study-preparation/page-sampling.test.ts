import { describe, expect, it, vi } from "vitest";

import { loadFrozenSampleDocuments, samplePageOrder, selectDomainSamples } from "./page-sampling";
import { DOC_1, DOC_2, HIVE_ID, snapshotDocument } from "./study-preparation.fixtures";

vi.mock("@/server/source-documents/document-pages-persistence", () => ({
  listDocumentPagesForSource: vi.fn(async (_client: unknown, input: { sourceDocumentId: string }) => ({
    found: true,
    readFingerprint: input.sourceDocumentId === DOC_2 ? "fp-changed" : `fp-${input.sourceDocumentId.slice(0, 8)}`,
    pageSetDigest: `sha256:${"a".repeat(64)}`,
    pages: [{ page_number: 1, page_text: "text" }],
  })),
}));

function pages(count: number, empty: number[] = []) {
  return Array.from({ length: count }, (_, index) => ({
    pageNumber: index + 1,
    text: empty.includes(index + 1) ? "   " : `page ${index + 1} `.repeat(20),
  }));
}

describe("samplePageOrder", () => {
  it("takes the first and last non-empty page, then evenly spaced interior pages", () => {
    expect(samplePageOrder(pages(10), 4)).toEqual([1, 10, 4, 7]);
    expect(samplePageOrder(pages(10, [1, 10]), 4)).toEqual([2, 9, 4, 7]);
    expect(samplePageOrder(pages(1), 4)).toEqual([1]);
    expect(samplePageOrder(pages(3, [1, 2, 3]), 4)).toEqual([]);
  });
});

describe("selectDomainSamples", () => {
  it("represents every document before giving any document a second page", () => {
    const { samples } = selectDomainSamples([
      { sourceDocumentId: DOC_1, pages: pages(5) },
      { sourceDocumentId: DOC_2, pages: pages(5) },
    ]);
    expect(samples.slice(0, 2).map((s) => s.sourceDocumentId)).toEqual([DOC_1, DOC_2]);
    expect(samples.map((s) => s.pageNumber).slice(0, 4)).toEqual([1, 1, 5, 5]);
  });

  it("truncates pages and stops at the total budget, recording what was left out", () => {
    const long = Array.from({ length: 4 }, (_, index) => ({ pageNumber: index + 1, text: "é".repeat(5000) }));
    const { samples, coverage } = selectDomainSamples(
      [
        { sourceDocumentId: DOC_1, pages: long },
        { sourceDocumentId: DOC_2, pages: [{ pageNumber: 1, text: "" }] },
      ],
      { perPageCharacterLimit: 1000, totalCharacterBudget: 2500, maxPagesPerDocument: 4 },
    );
    expect(samples.every((s) => s.truncated)).toBe(true);
    expect(samples.map((s) => Array.from(s.untrustedText).length)).toEqual([1000, 1000, 500]);
    expect(coverage.sampledCharacterCount).toBe(2500);
    expect(coverage.documentsWithoutSample).toEqual([{ sourceDocumentId: DOC_2, reason: "NO_CONTENT_PAGE" }]);
  });

  it("is deterministic", () => {
    const docs = [
      { sourceDocumentId: DOC_1, pages: pages(12) },
      { sourceDocumentId: DOC_2, pages: pages(7, [1]) },
    ];
    expect(selectDomainSamples(docs)).toEqual(selectDomainSamples(docs));
  });
});

describe("loadFrozenSampleDocuments", () => {
  it("treats a page set that no longer matches the frozen read as a source change", async () => {
    await expect(
      loadFrozenSampleDocuments({ rpc: vi.fn() }, {
        hiveId: HIVE_ID,
        documents: [snapshotDocument(DOC_1, "A.pdf"), snapshotDocument(DOC_2, "B.pdf")],
        correlationId: "66666666-6666-4666-8666-666666666666",
      }),
    ).rejects.toMatchObject({ errorCode: "COVERAGE_INCOMPLETE", diagnosticReason: "source_changed" });
  });
});
