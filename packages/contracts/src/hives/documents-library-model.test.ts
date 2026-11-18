import type { SourceDocument } from "../source-documents/source-document-contracts";
import type { StudyView } from "../pipeline/study-view-contracts";
import { describe, expect, it } from "vitest";

import {
  buildDocumentsLibraryRows,
  documentReadState,
  filterDocumentsLibraryRows,
} from "./documents-library-model";

const HIVE = "11111111-1111-4111-8111-111111111111";

function doc(index: number, overrides: Partial<SourceDocument> = {}): SourceDocument & { contentFingerprint?: string | null; pageCount?: number | null } {
  const id = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
  return {
    id,
    sourceDocumentId: id,
    hiveId: HIVE,
    clientRequestId: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    fileName: `file-${index}.pdf`,
    mimeType: "application/pdf",
    byteSize: 1000,
    status: "REGISTERED",
    failureReason: null,
    scanStatus: "NOT_SCANNED",
    readStatus: "PENDING",
    registeredAt: "2026-03-01T00:00:00.000Z",
    createdAt: index === 0 ? "2026-03-01T00:00:00.000Z" : "2026-03-02T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    contentFingerprint: `sha256:${"a".repeat(64)}`,
    pageCount: 4,
    ...overrides,
  } as SourceDocument & { contentFingerprint?: string | null; pageCount?: number | null };
}

const baseDoc = doc(0, { readStatus: "SUCCEEDED" });

const studyView: StudyView = {
  schema: "hive.study-view/1",
  sections: [],
  blocks: [
    {
      name: "documents",
      rows: [
        {
          id: baseDoc.sourceDocumentId,
          label: "Bank statement",
          typeInPlainWords: "Bank statement",
          date: "2026-03-04",
          role: "ANCHOR",
          values: [],
        },
      ],
    },
  ],
  components: [],
};

describe("documents-library-model", () => {
  it("classifies each read-state variant", () => {
    expect(documentReadState(doc(0, { readStatus: "SUCCEEDED" }), false, null, 4, 4, null).state).toBe("pages-read");
    expect(
      documentReadState(doc(1, { readStatus: "PARTIAL" }), false, null, 2, 4, 3).state,
    ).toBe("partial");
    expect(documentReadState(doc(2), true, null, null, null, null).state).toBe("reading");
    expect(documentReadState(doc(3, { readStatus: "FAILED" }), false, null, null, null, null).state).toBe("failed");
    expect(documentReadState(doc(4, { readStatus: "UNREADABLE" }), false, null, null, null, null).state).toBe("unreadable");
    expect(documentReadState(doc(5), false, "earlier.pdf", 4, 4, null).state).toBe("duplicate");
  });

  it("detects duplicate files by sha256 after the first succeeded registration", () => {
    const first = doc(0, { readStatus: "SUCCEEDED", fileName: "statement-a.pdf" });
    const dupe = doc(1, { readStatus: "SUCCEEDED", fileName: "statement-b.pdf" });
    const rows = buildDocumentsLibraryRows({
      documents: [first, dupe],
      documentMeta: {},
      studyView: null,
      pageCounts: {},
      verifiedPages: {},
      unreadableFirstPage: {},
      readingInProgress: false,
    });
    const duplicate = rows.find((row) => row.sourceDocumentId === dupe.sourceDocumentId);
    expect(duplicate?.readState).toBe("duplicate");
    expect(duplicate?.readDetail).toBe("Same as statement-a.pdf");
  });

  it("filters to-review and read completely", () => {
    const rows = buildDocumentsLibraryRows({
      documents: [
        doc(0, { readStatus: "SUCCEEDED" }),
        doc(1, { readStatus: "PARTIAL" }),
        doc(2, { readStatus: "FAILED" }),
      ],
      documentMeta: {},
      studyView: null,
      pageCounts: { [doc(1).sourceDocumentId]: 4 },
      verifiedPages: { [doc(1).sourceDocumentId]: 2 },
      unreadableFirstPage: { [doc(1).sourceDocumentId]: 3 },
      readingInProgress: false,
    });
    expect(filterDocumentsLibraryRows(rows, "all")).toHaveLength(3);
    expect(filterDocumentsLibraryRows(rows, "read")).toHaveLength(1);
    expect(filterDocumentsLibraryRows(rows, "to-review")).toHaveLength(2);
  });

  it("uses study document type and formatted period", () => {
    const rows = buildDocumentsLibraryRows({
      documents: [baseDoc],
      documentMeta: {},
      studyView,
      pageCounts: { [baseDoc.sourceDocumentId]: 12 },
      verifiedPages: { [baseDoc.sourceDocumentId]: 12 },
      unreadableFirstPage: {},
      readingInProgress: false,
    });
    expect(rows[0]?.titleLine).toBe("Bank statement");
    expect(rows[0]?.periodLabel).toBe("Mar 4, 2026");
  });
});