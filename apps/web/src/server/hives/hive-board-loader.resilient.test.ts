import {
  CANONICAL_STUDY_SCHEMA,
  createHiveError,
  type CanonicalStudy,
  type Hive,
} from "@hiveforyou/contracts";
import { VaultAdminConfigError } from "@/server/source-documents/v3-vault/persistence/vault-admin-config-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listHiveSourceDocumentsWithV3VaultMock = vi.fn();
const createLiveHiveVaultUploadAdapterDepsMock = vi.fn();
const loadHiveOverviewMock = vi.fn();

vi.mock("@/server/source-documents/hive-vault-upload-adapter", () => ({
  createLiveHiveVaultUploadAdapterDeps: (...args: unknown[]) => createLiveHiveVaultUploadAdapterDepsMock(...args),
  listHiveSourceDocumentsWithV3Vault: (...args: unknown[]) => listHiveSourceDocumentsWithV3VaultMock(...args),
}));

vi.mock("./hive-summary", () => ({
  loadHiveOverview: (...args: unknown[]) => loadHiveOverviewMock(...args),
}));

vi.mock("@/server/source-documents/document-reads", () => ({
  listDocumentReads: vi.fn(async () => ({ documentReads: [] })),
}));

function hiveBoardTestClient(): SupabaseClient {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [] }),
  };
  return {
    schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(query) }),
    rpc: vi.fn().mockResolvedValue({ data: null }),
  } as unknown as SupabaseClient;
}

import {
  isRecoverableHiveBoardDocumentListFailure,
  loadHiveBoardResilient,
} from "./hive-board-loader";

const HIVE: Hive = {
  id: "11111111-1111-4111-8111-111111111111",
  hiveId: "11111111-1111-4111-8111-111111111111",
  name: "Maya Carter",
  description: null,
  clientRequestId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const CORR = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

const CANONICAL_STUDY: CanonicalStudy = {
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "Education",
  spineSource: null,
  documents: [],
  spine: [],
  outsideSpine: [],
  conflicts: [{ id: "CF1", statement: "Two attendance rates", factIds: ["F1", "F2"] }],
  timeline: [],
  gaps: [],
};

function richOverview() {
  return {
    preparation: {
      eligibility: {
        documents: [{ sourceDocumentId: "doc-a", fileName: "a.pdf", totalPhysicalPages: 2 }],
        excluded: [],
        coverageComplete: true,
        activeReadCount: 0,
        coverageDigest: null,
        gaps: [],
      },
      staleness: null,
      studyRevision: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        revisionNumber: 6,
        createdAt: "2026-11-01T00:00:00.000Z",
        format: "canonical-study-1",
      },
      reportRuns: [{ status: "SUCCEEDED", finishedAt: "2026-11-02T00:00:00.000Z", audience: "CUSTOMER" as const }],
    },
    studyTab: {
      view: {
        intent: "Review",
        blocks: [
          {
            name: "conflicts",
            rows: [
              {
                id: "CF1",
                statement: "Two attendance rates",
                values: [
                  { factId: "F1", valueAsWritten: "90%", sourceRef: { sourceDocumentId: "doc-a", pageNumber: 1, quote: "90" }, relation: "supporting" },
                  { factId: "F2", valueAsWritten: "70%", sourceRef: { sourceDocumentId: "doc-a", pageNumber: 2, quote: "70" }, relation: "supporting" },
                ],
              },
            ],
          },
        ],
        components: [],
      },
      sources: {
        facts: {
          F1: { sourceDocumentId: "doc-a", pageNumber: 1, quote: "90" },
          F2: { sourceDocumentId: "doc-a", pageNumber: 2, quote: "70" },
        },
      },
    },
    studyView: null,
    canonicalStudy: CANONICAL_STUDY,
    referencedDocuments: [],
    summary: { study: { revisionNumber: 6 } },
    studyLoadError: null,
    reports: null,
  };
}

describe("isRecoverableHiveBoardDocumentListFailure", () => {
  it("treats vault admin config as recoverable", () => {
    expect(isRecoverableHiveBoardDocumentListFailure(new VaultAdminConfigError("vault_admin_secret_missing"))).toBe(true);
  });

  it("does not swallow access-denied style errors", () => {
    expect(
      isRecoverableHiveBoardDocumentListFailure(
        createHiveError({
          errorCode: "NOT_FOUND",
          category: "SECURITY",
          stage: "SHELL",
          retryable: false,
          safeMessage: "We could not find that Hive.",
          correlationId: CORR,
          diagnosticReason: "not_found",
        }),
      ),
    ).toBe(false);
  });
});

describe("loadHiveBoardResilient", () => {
  beforeEach(() => {
    listHiveSourceDocumentsWithV3VaultMock.mockReset();
    createLiveHiveVaultUploadAdapterDepsMock.mockReturnValue({});
    loadHiveOverviewMock.mockReset();
    loadHiveOverviewMock.mockResolvedValue(richOverview());
  });

  it("rethrows unauthorized hive access", async () => {
    const denied = createHiveError({
      errorCode: "NOT_FOUND",
      category: "SECURITY",
      stage: "SHELL",
      retryable: false,
      safeMessage: "We could not find that Hive.",
      correlationId: CORR,
      diagnosticReason: "not_found",
    });
    listHiveSourceDocumentsWithV3VaultMock.mockRejectedValue(denied);

    await expect(
      loadHiveBoardResilient(hiveBoardTestClient(), { hive: HIVE, correlationId: CORR, userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    ).rejects.toBe(denied);
    expect(loadHiveOverviewMock).not.toHaveBeenCalled();
  });

  it("propagates overview failures after a recoverable listing failure", async () => {
    listHiveSourceDocumentsWithV3VaultMock.mockRejectedValue(new VaultAdminConfigError("vault_admin_secret_missing"));
    const overviewFailure = new Error("study database unavailable");
    loadHiveOverviewMock.mockRejectedValue(overviewFailure);

    await expect(
      loadHiveBoardResilient(hiveBoardTestClient(), { hive: HIVE, correlationId: CORR, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ).rejects.toBe(overviewFailure);
  });

  it("propagates overview failures when listing succeeds", async () => {
    listHiveSourceDocumentsWithV3VaultMock.mockResolvedValue({ sourceDocuments: [] });
    const overviewFailure = new Error("study load failed");
    loadHiveOverviewMock.mockRejectedValue(overviewFailure);

    await expect(
      loadHiveBoardResilient(hiveBoardTestClient(), { hive: HIVE, correlationId: CORR, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ).rejects.toBe(overviewFailure);
  });

  it("preserves study, reports and conflicts when listing alone fails", async () => {
    listHiveSourceDocumentsWithV3VaultMock.mockRejectedValue(new VaultAdminConfigError("vault_admin_secret_missing"));

    const loaded = await loadHiveBoardResilient(hiveBoardTestClient(), {
      hive: HIVE,
      correlationId: CORR,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(loaded.uploads).toEqual([]);
    expect(loaded.overview.preparation.studyRevision?.revisionNumber).toBe(6);
    expect(loaded.board.needs.some((need) => need.kind === "conflict")).toBe(true);
    expect(loaded.board.readiness.find((line) => line.label === "Latest report")?.value).toContain("Customer");
    expect(loaded.board.activity.some((item) => item.text.includes("study revision"))).toBe(true);
    const documentsLine = loaded.board.readiness.find((line) => line.label === "Documents");
    expect(documentsLine?.value).toBe("Unavailable right now");
  });

  it("does not invent document-added activity when listing fails", async () => {
    listHiveSourceDocumentsWithV3VaultMock.mockRejectedValue(new VaultAdminConfigError("vault_admin_secret_missing"));

    const loaded = await loadHiveBoardResilient(hiveBoardTestClient(), {
      hive: HIVE,
      correlationId: CORR,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(loaded.board.activity.every((item) => !item.text.startsWith("added "))).toBe(true);
  });

  it("uses confirmed-empty copy only when listing succeeds with zero documents", async () => {
    listHiveSourceDocumentsWithV3VaultMock.mockResolvedValue({ sourceDocuments: [] });
    loadHiveOverviewMock.mockResolvedValue({
      ...richOverview(),
      preparation: {
        ...richOverview().preparation,
        eligibility: {
          documents: [],
          excluded: [],
          coverageComplete: true,
          activeReadCount: 0,
          coverageDigest: null,
          gaps: [],
        },
      },
      canonicalStudy: null,
      studyTab: null,
    });

    const loaded = await loadHiveBoardResilient(hiveBoardTestClient(), {
      hive: HIVE,
      correlationId: CORR,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(loaded.board.headline).toBe("Nothing is in yet");
    expect(loaded.board.readiness.find((line) => line.label === "Documents")?.value).toBe("0 read, 0 new");
  });

  it("distinguishes unavailable listing from confirmed zero documents", async () => {
    listHiveSourceDocumentsWithV3VaultMock.mockRejectedValue(new VaultAdminConfigError("vault_admin_secret_missing"));
    loadHiveOverviewMock.mockResolvedValue({
      ...richOverview(),
      preparation: {
        ...richOverview().preparation,
        eligibility: {
          documents: [],
          excluded: [],
          coverageComplete: true,
          activeReadCount: 0,
          coverageDigest: null,
          gaps: [],
        },
      },
      canonicalStudy: CANONICAL_STUDY,
    });

    const loaded = await loadHiveBoardResilient(hiveBoardTestClient(), {
      hive: HIVE,
      correlationId: CORR,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(loaded.board.headline).not.toBe("Nothing is in yet");
    expect(loaded.board.readiness.find((line) => line.label === "Documents")?.value).toBe("Unavailable right now");
  });
});