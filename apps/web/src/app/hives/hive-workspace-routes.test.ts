import type { Hive } from "@hiveforyou/contracts";
import type { HiveWorkspaceSection } from "@/lib/hive-routes";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadOwnedHiveOrNotFoundMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  permanentRedirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("@/server/hives/load-owned-hive", () => ({
  loadOwnedHiveOrNotFound: (...args: unknown[]) => loadOwnedHiveOrNotFoundMock(...args),
}));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: vi.fn(async () => ({
    ok: true,
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    client: {
      schema: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { assistant_name: "Sam" } }),
            }),
          }),
        }),
      }),
    },
  })),
  createServerSupabaseClient: vi.fn(async () => ({})),
}));

vi.mock("@/server/auth/action-support", () => ({
  requestCorrelationId: vi.fn(async () => "2eb8421a-b784-4bf8-ac2b-540299b61d13"),
}));

vi.mock("@/server/hives/hive-board-loader", () => ({
  loadHiveBoard: vi.fn(async () => ({
    board: { kicker: "", headline: "Everything is in and checked", needs: [], checklist: [], activity: [], readiness: [], progress: null, next: null, checklistNote: "" },
    uploads: [],
    overview: {
      preparation: {
        eligibility: { documents: [], excluded: [], coverageComplete: true, activeReadCount: 0, coverageDigest: null, gaps: [] },
      },
    },
  })),
}));

vi.mock("@/server/firm/load-firm", () => ({
  loadFirm: vi.fn(async () => ({
    firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera", assistantName: "Sam", callerRole: "owner" },
    members: [],
    pendingInvitations: [],
  })),
}));

vi.mock("@/server/firm/load-firm-board", () => ({
  loadLatestHandover: vi.fn(async () => null),
  loadTeamNotes: vi.fn(async () => []),
}));

vi.mock("@/server/hives/hive-poll-snapshot", () => ({
  loadHivePollSnapshot: vi.fn(async () => ({ version: "v1", fastPoll: false })),
}));

vi.mock("@/server/hives/hive-summary", () => ({
  loadHiveOverview: vi.fn(async () => ({
    preparation: {
      eligibility: { documents: [], excluded: [], coverageComplete: true, activeReadCount: 0, coverageDigest: null, gaps: [] },
    },
    studyTab: null,
    studyView: null,
    canonicalStudy: null,
    referencedDocuments: [],
    summary: { study: null },
    studyLoadError: null,
  })),
  documentPageCounts: vi.fn(() => ({})),
}));

vi.mock("@/server/hives/load-study-revision-history", () => ({
  loadStudyRevisionHistory: vi.fn(async () => []),
}));

vi.mock("@/components/audit/AuditTrailPageView", () => ({ AuditTrailPageView: () => null }));

vi.mock("@/server/source-documents/hive-vault-upload-adapter", () => ({
  listHiveSourceDocumentsWithV3Vault: vi.fn(async () => ({ sourceDocuments: [] })),
  createLiveHiveVaultUploadAdapterDeps: vi.fn(async () => ({})),
}));

vi.mock("@/server/hives/hive-conversation", () => ({
  loadHiveConversation: vi.fn(async () => ({ ok: false, message: "x", correlationId: "c", retryable: true })),
  loadUnreadMessageCount: vi.fn(async () => null),
}));

vi.mock("@/components/hives/HiveConversation", () => ({ HiveConversation: () => null }));
vi.mock("@/components/hives/HiveStillToCome", () => ({ HiveStillToCome: () => null }));
vi.mock("@/components/workspace/HiveHandoverBanner", () => ({ HiveHandoverBanner: () => null }));
vi.mock("@/components/hives/DocumentsPanel", () => ({ DocumentsPanel: () => null }));
vi.mock("@/components/hives/HiveTeamNotesPanel", () => ({ HiveTeamNotesPanel: () => null }));
vi.mock("@/components/hives/HiveActivityPanel", () => ({ HiveActivityPanel: () => null }));
vi.mock("@/components/reports/ReportsPanel", () => ({ ReportsPanel: () => null }));
vi.mock("@/components/workspace/HivePageHead", () => ({ HivePageHead: () => null }));
vi.mock("@/components/study/StudyTabPanel", () => ({ StudyTabPanel: () => null }));
vi.mock("@/components/study/StudyView", () => ({ StudyView: () => null }));
vi.mock("@/components/study/StudyPromptPreview", () => ({ StudyPromptPreview: () => null }));
vi.mock("@/components/workspace/WorkspaceError", () => ({ WorkspaceError: () => null }));
vi.mock("@/components/tab-empty-state", () => ({ TabEmptyState: () => null }));
vi.mock("@/components/workspace/Card", () => ({ Card: () => null }));
vi.mock("@/components/pane-error-boundary", () => ({ PaneErrorBoundary: ({ children }: { children: unknown }) => children }));

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";

function firmClientHive(): Hive {
  return {
    id: HIVE_ID,
    hiveId: HIVE_ID,
    name: "Ruth Ortiz",
    description: null,
    kind: "client",
    clientRequestId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    firmId: "33333333-3333-4333-8333-333333333333",
    membershipRole: "firm",
  };
}

function ownHive(): Hive {
  return {
    ...firmClientHive(),
    kind: "own",
    firmId: null,
    membershipRole: "owner",
  };
}

type SectionPage = () => Promise<{
  default: (props: {
    params: Promise<{ hiveId: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }) => Promise<unknown>;
}>;

const SECTIONS: readonly { section: HiveWorkspaceSection; page: SectionPage }[] = [
  { section: "documents", page: () => import("./[hiveId]/documents/page") },
  { section: "reports", page: () => import("./[hiveId]/reports/page") },
  { section: "audit", page: () => import("./[hiveId]/audit/page") },
  { section: "notes", page: () => import("./[hiveId]/notes/page") },
];

describe("hive workspace section pages", () => {
  beforeEach(() => {
    loadOwnedHiveOrNotFoundMock.mockReset();
    notFoundMock.mockClear();
    loadOwnedHiveOrNotFoundMock.mockResolvedValue(firmClientHive());
  });

  it.each(SECTIONS)(
    "loadOwnedHiveOrNotFound for %s with matching returnPath",
    async ({ section, page }) => {
      const mod = await page();
      await mod.default({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        ...(section === "reports" ? { searchParams: Promise.resolve({}) } : {}),
      });
      expect(loadOwnedHiveOrNotFoundMock).toHaveBeenCalledWith(HIVE_ID, `/hives/${HIVE_ID}/${section}`);
    },
    20_000,
  );
});

describe("moved hive routes", () => {
  it("sends the board to Home", async () => {
    loadOwnedHiveOrNotFoundMock.mockClear();
    const mod = await import("./[hiveId]/board/page");
    await expect(
      mod.default({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(`REDIRECT:/hives/${HIVE_ID}`);
    expect(loadOwnedHiveOrNotFoundMock).not.toHaveBeenCalled();
  });

  it("sends findings to Home#show", async () => {
    const mod = await import("./[hiveId]/findings/page");
    await expect(mod.default({ params: Promise.resolve({ hiveId: HIVE_ID }) })).rejects.toThrow(
      `REDIRECT:/hives/${HIVE_ID}#show`,
    );
  });
});

describe("notes page firm gate", () => {
  beforeEach(() => {
    loadOwnedHiveOrNotFoundMock.mockReset();
    notFoundMock.mockClear();
  });

  it("calls notFound when showsFirmThreePane is false (own hive)", async () => {
    loadOwnedHiveOrNotFoundMock.mockResolvedValue(ownHive());
    const NotesPage = (await import("./[hiveId]/notes/page")).default;
    await expect(NotesPage({ params: Promise.resolve({ hiveId: HIVE_ID }) })).rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });
});

import { showsFirmThreePane } from "@/lib/hives/firm-board";

describe("showsFirmThreePane gate", () => {
  it("is true for firm staff on a client hive", () => {
    expect(showsFirmThreePane(firmClientHive())).toBe(true);
  });

  it("is false for client members and own hives", () => {
    expect(showsFirmThreePane({ ...firmClientHive(), membershipRole: "client" })).toBe(false);
    expect(showsFirmThreePane(ownHive())).toBe(false);
  });
});