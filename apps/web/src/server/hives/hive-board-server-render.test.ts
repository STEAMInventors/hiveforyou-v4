import {
  DOCUMENT_REQUEST_LIST_COMPONENT,
  type GetStudyPreparationResponse,
  type Hive,
  type StudyView,
  type StudyViewRow,
  type StudyViewSources,
} from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import { loadHiveBoard } from "./hive-board-loader";
import { summarizeHive } from "./hive-summary";

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const SOURCE_REF = { sourceDocumentId: "doc-1", pageNumber: 1, quote: "quoted text" };

function spineRow(id: string, status: string): StudyViewRow {
  return {
    id,
    status,
    values: [{ factId: `${id}-0`, valueAsWritten: "value", sourceRef: SOURCE_REF, relation: "supporting" }],
  };
}

function minimalStudyView(): StudyView {
  return {
    intent: "Review uploaded documents",
    blocks: [
      { name: "spine_table", rows: [spineRow("S1", "CONFLICTED"), spineRow("S2", "SUPPORTED")] },
      { name: "conflicts", rows: [] },
      { name: "documents", rows: [] },
    ],
    components: [{ name: DOCUMENT_REQUEST_LIST_COMPONENT, items: [], legacyLines: [], courtRecordCount: 0 }],
  } as StudyView;
}

const MINIMAL_SOURCES = { byFactId: {}, bySourceDocumentId: {} } as StudyViewSources;

function baseHive(kind: Hive["kind"]): Hive {
  return {
    id: HIVE_ID,
    hiveId: HIVE_ID,
    name: kind === "client" ? "Ruth Ortiz" : "My tax return",
    description: null,
    kind,
    clientRequestId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    firmId: kind === "client" ? "33333333-3333-4333-8333-333333333333" : null,
    membershipRole: kind === "client" ? "firm" : "owner",
  };
}

function preparationWithStudy(): GetStudyPreparationResponse {
  return {
    eligibility: {
      documents: [{ sourceDocumentId: "doc-1", fileName: "packet.pdf", totalPhysicalPages: 12 }],
      excluded: [],
      activeReadCount: 0,
      coverageComplete: true,
      coverageDigest: null,
      gaps: [],
    },
    studyRevision: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revisionNumber: 3,
      createdAt: "2026-11-02T00:00:00.000Z",
      format: "canonical-study-1",
      coverageGaps: [],
    },
    processingRun: null,
    reportRuns: [],
    staleness: null,
  } as unknown as GetStudyPreparationResponse;
}

vi.mock("@/server/source-documents/hive-vault-upload-adapter", () => ({
  listHiveSourceDocumentsWithV3Vault: vi.fn(async () => ({
    sourceDocuments: [
      {
        sourceDocumentId: "doc-1",
        fileName: "packet.pdf",
        registeredAt: "2026-11-01T00:00:00.000Z",
        createdAt: "2026-11-01T00:00:00.000Z",
        readStatus: "SUCCEEDED",
        canonicalGapId: null,
        canonicalGapTitle: null,
      },
    ],
  })),
  createLiveHiveVaultUploadAdapterDeps: vi.fn(() => ({})),
}));

vi.mock("@/server/source-documents/document-reads", () => ({
  listDocumentReads: vi.fn(async () => ({ documentReads: [] })),
}));

vi.mock("./hive-summary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hive-summary")>();
  return {
    ...actual,
    loadHiveOverview: vi.fn(async () => {
      const view = minimalStudyView();
      const preparation = preparationWithStudy(view);
      return {
        preparation,
        reports: null,
        studyView: null,
        studyTab: { view, sources: MINIMAL_SOURCES },
        canonicalStudy: null,
        referencedDocuments: [],
        summary: actual.summarizeHive(preparation, null, { view }, null, null),
      };
    }),
  };
});

describe("hive board server render", () => {
  it.each([
    ["own", baseHive("own")],
    ["client", baseHive("client")],
  ] as const)("loadHiveBoard for %s hives with a study", async (_label, hive) => {
    const client = {
      schema: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [] }),
            }),
          }),
        }),
      }),
    };
    const loaded = await loadHiveBoard(client as never, {
      hive,
      correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
      userId: USER_ID,
    });
    expect(loaded.board.headline.length).toBeGreaterThan(0);
    expect(loaded.overview.summary.study?.counts).not.toBeNull();
  });

  it("summarizeHive without a study leaves board counts empty", () => {
    const preparation = {
      eligibility: {
        documents: [],
        excluded: [],
        activeReadCount: 0,
        coverageComplete: true,
        coverageDigest: null,
        gaps: [],
      },
      studyRevision: null,
      processingRun: null,
      reportRuns: [],
      staleness: null,
    } as unknown as GetStudyPreparationResponse;
    const summary = summarizeHive(preparation, null, null, null, null);
    expect(summary.study).toBeNull();
  });

  it("summarizeHive with study rows computes counts on the server", () => {
    const view = minimalStudyView();
    const preparation = preparationWithStudy(view);
    const summary = summarizeHive(preparation, null, { view }, null, null);
    expect(summary.study?.counts).toEqual({ needs: 1, changed: 0, missing: 0, checked: 1 });
  });
});