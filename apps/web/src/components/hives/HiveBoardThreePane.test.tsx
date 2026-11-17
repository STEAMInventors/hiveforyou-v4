// @vitest-environment jsdom
import type { Hive, HiveBoardModel, ListFirmResponse } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { HiveBoardPanel } from "./HiveBoardPanel";
import { HiveBoardThreePane } from "./HiveBoardThreePane";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/hives/useStudyPreparation", () => ({
  useStudyPreparation: () => ({
    rebuildAvailability: { canRebuild: false, reason: "NO_ACCEPTED_STUDY" },
    starting: false,
    active: false,
    rebuild: vi.fn(),
    state: null,
  }),
}));

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const MARIA = "11111111-1111-4111-8111-111111111111";

const firm: ListFirmResponse = {
  firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera Law", assistantName: "Sarah", callerRole: "owner" },
  members: [
    { userId: MARIA, email: "maria@example.com", role: "owner", title: "Attorney", state: "active", joined: true, displayName: "Maria Alvarez" },
  ],
  pendingInvitations: [],
};

const board: HiveBoardModel = {
  kicker: "Intake for Ruth Ortiz",
  headline: "2 things need you",
  progress: { in: 1, total: 2, segments: ["in", "not_in"] },
  needs: [
    {
      kind: "conflict",
      kindLabel: "Needs you",
      title: "Dates disagree",
      detail: "One record says May.",
      sourceChips: [],
      action: { kind: "link", label: "Review", href: "/hives/x/missing" },
    },
    {
      kind: "conflict",
      kindLabel: "Changed",
      title: "Another point",
      detail: "Detail.",
      sourceChips: [],
      action: { kind: "link", label: "Open", href: "/hives/x/missing" },
    },
  ],
  next: null,
  checklist: [
    { gapId: "X1", title: "Pay stubs", status: "not_in", statusText: "Not in yet.", action: { kind: "link", label: "Add it", href: "/docs" } },
    { gapId: "X2", title: "Lease", status: "in", statusText: "In.", action: { kind: "link", label: "Add it", href: "/docs" } },
  ],
  activity: [],
  readiness: [],
  checklistNote: "1 of 2 in",
};

function hive(overrides: Partial<Hive> = {}): Hive {
  return {
    id: HIVE_ID,
    hiveId: HIVE_ID,
    name: "Ruth Ortiz",
    description: "Benefits",
    kind: "client",
    clientRequestId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    firmId: firm.firm?.firmId,
    assigneeUserId: MARIA,
    assigneeDisplayName: "Maria Alvarez",
    stage: "open",
    clientShareStatus: "invited",
    membershipRole: "firm",
    isOwner: false,
    ...overrides,
  };
}

function renderPane(overrides: Partial<Hive> = {}) {
  return render(
    <HiveBoardThreePane
      hive={hive(overrides)}
      currentUserId={MARIA}
      board={board}
      firm={firm}
      uploads={[{ sourceDocumentId: "d1", fileName: "stubs.pdf", canonicalGapId: "X1", canonicalGapTitle: "Pay stubs" }]}
      documentLabels={{}}
    />,
  );
}

function primaryActions(): HTMLElement[] {
  const mark = "bg-cell-blue-deep";
  return [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")].filter((element) =>
    element.className.includes(mark),
  );
}

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hive: {} }) }));
});

describe("HiveBoardThreePane", () => {
  it("renders two columns without the team pane", () => {
    renderPane();
    expect(screen.queryByRole("region", { name: "Your team" })).toBeNull();
    expect(screen.getByRole("region", { name: "Hive board" })).toBeTruthy();
    expect(screen.getByTestId("hive-board-client-pane")).toBeTruthy();
    expect(screen.getByTestId("hive-board-stage-strip")).toBeTruthy();
    expect(screen.getByText("Collecting · 1 of 2 in")).toBeTruthy();
  });

  it("hides plain Needs you kind label and keeps one WORKSPACE_PRIMARY", () => {
    renderPane();
    const needsCard = screen.getByTestId("hive-board-needs-card");
    expect(within(needsCard).queryByText("Needs you", { selector: "[data-state]" })).toBeNull();
    expect(within(needsCard).getByText("Changed")).toBeTruthy();
    expect(primaryActions()).toHaveLength(1);
  });

  it("shows client waiting line and auto-remind switch on wide layout", () => {
    renderPane();
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.getByText(/Waiting on Ruth/)).toBeTruthy();
    expect(screen.getByText("Remind now")).toBeTruthy();
  });

  it("shows Items and client tabs below 1100px without Team", () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("1099"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;

    renderPane();
    const tabs = screen.getByRole("tablist", { name: "Board panes" });
    expect(within(tabs).getByRole("tab", { name: "Items" }).getAttribute("aria-selected")).toBe("true");
    expect(within(tabs).queryByRole("tab", { name: "Team" })).toBeNull();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Ruth" }));
    expect(screen.getByTestId("hive-board-client-pane")).toBeTruthy();
  });

  it("individual board in workspace mode omits repeated hive title", () => {
    expect(showsFirmThreePane(hive({ kind: "own", firmId: null, membershipRole: "owner" }))).toBe(false);
    render(
      <HiveBoardPanel
        hive={hive({ kind: "own", firmId: null, membershipRole: "owner", name: "Home renovation" })}
        currentUserId={MARIA}
        hiveId={HIVE_ID}
        hiveName="Home renovation"
        hiveDescription="Kitchen"
        hasDocuments
        board={{ ...board, kicker: "Your hive", headline: "Everything is in and checked", needs: [] }}
        documentLabels={{}}
        workspaceMode
      />,
    );
    expect(screen.getByTestId("hive-board-workspace")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Home renovation" })).toBeNull();
  });
});
