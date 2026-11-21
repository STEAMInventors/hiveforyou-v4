// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadHiveBoardMock } = vi.hoisted(() => ({ loadHiveBoardMock: vi.fn() }));

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/hives/load-owned-hive", () => ({
  loadOwnedHiveOrNotFound: async () => ({ id: HIVE_ID, name: "Ortiz family", kind: "client" }),
}));
vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: async () => ({ ok: true, userId: "u", client: {} }),
}));
vi.mock("@/server/source-documents/hive-vault-upload-adapter", () => ({
  createLiveHiveVaultUploadAdapterDeps: () => ({}),
  listHiveSourceDocumentsWithV3Vault: async () => ({ sourceDocuments: [] }),
}));
vi.mock("@/server/hives/hive-summary", () => ({ loadHiveOverview: async () => null }));
vi.mock("@/server/hives/hive-board-loader", () => ({ loadHiveBoard: (...args: unknown[]) => loadHiveBoardMock(...args) }));
vi.mock("@/components/hives/DocumentsPanel", () => ({
  DocumentsPanel: () => <div data-testid="documents-panel" />,
}));

import DocumentsPage from "./page";

const board = {
  progress: { in: 0, total: 1 },
  checklistNote: "",
  checklist: [
    { gapId: "g1", title: "Current lease", status: "not_in", statusText: "", action: { label: "Add it", href: "/x" } },
  ],
};

afterEach(() => cleanup());

describe("Documents page", () => {
  beforeEach(() => {
    loadHiveBoardMock.mockReset();
  });

  it("renders study-dependent alerts above the documents panel", async () => {
    loadHiveBoardMock.mockResolvedValue({ board, overview: { preparation: { studyRevision: null }, studyTab: null, studyLoadError: null } });
    render(await DocumentsPage({ params: Promise.resolve({ hiveId: HIVE_ID }) }));
    expect(screen.getByTestId("study-dependent-no-study")).toBeTruthy();
    expect(screen.getByTestId("documents-panel")).toBeTruthy();
  });

  it("leaves the page as it was when there is no checklist or it fails to load", async () => {
    loadHiveBoardMock.mockResolvedValue({ board: { ...board, checklist: [] } });
    const first = render(await DocumentsPage({ params: Promise.resolve({ hiveId: HIVE_ID }) }));
    expect(first.container.querySelector("#requested")).toBeNull();
    cleanup();
    loadHiveBoardMock.mockImplementation(async () => {
      throw new Error("board unavailable");
    });
    const second = render(await DocumentsPage({ params: Promise.resolve({ hiveId: HIVE_ID }) }));
    expect(second.container.querySelector("#requested")).toBeNull();
    expect(screen.getByTestId("documents-panel")).toBeTruthy();
  });
});
