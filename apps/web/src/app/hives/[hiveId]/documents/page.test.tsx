// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadHiveBoardMock, loadHiveOverviewMock } = vi.hoisted(() => ({
  loadHiveBoardMock: vi.fn(),
  loadHiveOverviewMock: vi.fn(),
}));

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
vi.mock("@/server/hives/hive-summary", () => ({ loadHiveOverview: (...args: unknown[]) => loadHiveOverviewMock(...args) }));
vi.mock("@/server/hives/hive-board-loader", () => ({ loadHiveBoard: (...args: unknown[]) => loadHiveBoardMock(...args) }));
vi.mock("@/server/pipeline/pack-loader", () => ({ loadPackById: () => null }));

type PanelProps = { checklist?: { gapId: string; title: string }[]; openItems?: unknown[]; topics?: unknown[] };
let lastPanelProps: PanelProps | null = null;

vi.mock("@/components/hives/DocumentsPanel", () => ({
  DocumentsPanel: (props: PanelProps) => {
    lastPanelProps = props;
    return (
      <div data-testid="documents-panel">
        {props.checklist && props.checklist.length > 0 ? <div id="requested" data-testid="requested-anchor" /> : null}
      </div>
    );
  },
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
    loadHiveOverviewMock.mockReset();
    lastPanelProps = null;
  });

  it("passes checklist, open items, and topics into DocumentsPanel with the #requested anchor inside it", async () => {
    loadHiveBoardMock.mockResolvedValue({
      board,
      overview: {
        studyTab: { view: { schema: "hive.study-view/1", sections: [], blocks: [], components: [] }, sources: { facts: {} } },
        canonicalStudy: null,
        referencedDocuments: [],
        preparation: { studyRevision: null },
      },
    });
    render(await DocumentsPage({ params: Promise.resolve({ hiveId: HIVE_ID }) }));
    expect(screen.getByTestId("requested-anchor")).toBeTruthy();
    expect(lastPanelProps?.checklist?.length).toBe(1);
    expect(Array.isArray(lastPanelProps?.openItems)).toBe(true);
    expect(Array.isArray(lastPanelProps?.topics)).toBe(true);
  });

  it("leaves the page without a requested anchor when there is no checklist", async () => {
    loadHiveBoardMock.mockResolvedValue({
      board: { ...board, checklist: [] },
      overview: null,
    });
    const { container } = render(await DocumentsPage({ params: Promise.resolve({ hiveId: HIVE_ID }) }));
    expect(container.querySelector("#requested")).toBeNull();
    expect(screen.getByTestId("documents-panel")).toBeTruthy();
  });
});