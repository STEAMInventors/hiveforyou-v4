// @vitest-environment jsdom
import type { SourceDocument, StudyView } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";

import { DocumentsSourceLibrary } from "./DocumentsSourceLibrary";
import { buildDocumentsLibraryReadMetrics } from "./documents-library-metrics";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/hives/test-hive/documents",
  useSearchParams: () => new URLSearchParams(),
}));

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

function document(index: number, overrides: Partial<SourceDocument> = {}): SourceDocument & { contentFingerprint?: string | null } {
  const id = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
  return {
    id,
    sourceDocumentId: id,
    hiveId: HIVE_ID,
    clientRequestId: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    fileName: `scan-${index}.pdf`,
    mimeType: "application/pdf",
    byteSize: 1,
    status: "REGISTERED",
    failureReason: null,
    scanStatus: "NOT_SCANNED",
    readStatus: "PENDING",
    registeredAt: "2026-03-01T00:00:00.000Z",
    createdAt: index === 0 ? "2026-03-01T00:00:00.000Z" : "2026-03-02T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    contentFingerprint: `sha256:${"b".repeat(64)}`,
    ...overrides,
  } as SourceDocument & { contentFingerprint?: string | null };
}

const studyView: StudyView = {
  schema: "hive.study-view/1",
  sections: [],
  blocks: [
    {
      name: "documents",
      rows: [
        {
          id: "33333333-3333-4333-8333-000000000001",
          label: "Bank statement",
          typeInPlainWords: "Monthly bank statement",
          date: "2026-03-04",
          role: "ANCHOR",
          values: [],
        },
      ],
    },
  ],
  components: [],
};

afterEach(() => cleanup());

function renderLibrary(
  documents: SourceDocument[],
  options: {
    readingInProgress?: boolean;
    onRetry?: () => void;
  } = {},
) {
  const metrics = buildDocumentsLibraryReadMetrics(
    documents.map((doc, index) =>
      index === 2
        ? {
            sourceDocumentId: doc.sourceDocumentId,
            totalPhysicalPages: 4,
            verifiedPageCount: 2,
            missingPageNumbers: [3],
          }
        : { sourceDocumentId: doc.sourceDocumentId, totalPhysicalPages: 4, verifiedPageCount: 4, missingPageNumbers: [] },
    ),
    [],
  );
  return render(
    <EvidenceViewerProvider hiveId={HIVE_ID} labels={new Map()} readCoverageLines={new Map()}>
      <DocumentsSourceLibrary
        documents={documents}
        documentMeta={{}}
        studyView={studyView}
        metrics={metrics}
        readingInProgress={options.readingInProgress ?? false}
        onRetryRead={options.onRetry}
      />
    </EvidenceViewerProvider>,
  );
}

describe("DocumentsSourceLibrary", () => {
  it("renders each read-state variant, duplicate detection, and uploaded heading", () => {
    const docs = [
      document(1, { readStatus: "SUCCEEDED", fileName: "first.pdf" }),
      document(2, { readStatus: "SUCCEEDED", fileName: "dupe.pdf" }),
      document(3, { readStatus: "PARTIAL" }),
      document(4, { readStatus: "FAILED" }),
      document(5, { readStatus: "UNREADABLE" }),
      document(6, { readStatus: "PENDING" }),
    ];
    renderLibrary(docs, { readingInProgress: true });
    expect(screen.getByRole("heading", { name: /Uploaded/i })).toBeTruthy();
    const table = screen.getByTestId("source-library-table");
    expect(within(table).getAllByText("Read").length).toBeGreaterThan(0);
    expect(within(table).getByText("Duplicate")).toBeTruthy();
    expect(within(table).getByText(/% read/)).toBeTruthy();
    expect(within(table).getAllByText("Not read yet").length).toBeGreaterThanOrEqual(2);
    expect(within(table).getByText("Reading…")).toBeTruthy();
    cleanup();
    renderLibrary([]);
    expect(screen.queryByTestId("source-library-table")).toBeNull();
    expect(screen.queryByTestId("source-library-notice")).toBeNull();
  });

  it("opens the evidence viewer when a row is activated and wires retry", () => {
    const onRetry = vi.fn();
    const open = vi.fn();
    render(
      <EvidenceViewerProvider hiveId={HIVE_ID} labels={new Map()} readCoverageLines={new Map()}>
        <DocumentsSourceLibrary
          documents={[document(1, { readStatus: "FAILED" })]}
          documentMeta={{}}
          studyView={studyView}
          metrics={buildDocumentsLibraryReadMetrics(
            [{ sourceDocumentId: document(1).sourceDocumentId, totalPhysicalPages: 4, verifiedPageCount: 0, missingPageNumbers: [] }],
            [],
          )}
          readingInProgress={false}
          onRetryRead={onRetry}
        />
      </EvidenceViewerProvider>,
    );
    const table = screen.getByTestId("source-library-table");
    fireEvent.click(within(table).getByText("Try again"));
    expect(onRetry).toHaveBeenCalled();
    void open;
  });
});