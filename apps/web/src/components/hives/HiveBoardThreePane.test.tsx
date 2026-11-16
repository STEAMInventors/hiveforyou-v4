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
  }),
}));

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const MARIA = "11111111-1111-4111-8111-111111111111";
const DANA = "22222222-2222-4222-8222-222222222222";

const firm: ListFirmResponse = {
  firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera Law", assistantName: "Sarah", callerRole: "owner" },
  members: [
    { userId: MARIA, email: "maria@example.com", role: "owner", title: "Attorney", state: "active", joined: true, displayName: "Maria Alvarez" },
    { userId: DANA, email: "dana@example.com", role: "member", title: "Paralegal", state: "active", joined: true, displayName: "Dana Cole" },
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
      kindLabel: "Changed",
      title: "Dates disagree",
      detail: "One record says May.",
      sourceChips: [],
      action: { kind: "link", label: "Review", href: "/hives/x/study" },
    },
  ],
  next: null,
  checklist: [
    { gapId: "X1", title: "Pay stubs", status: "not_in", statusText: "Not in yet.", action: { kind: "link", label: "Add it", href: "/docs" } },
    { gapId: "X2", title: "Lease", status: "in", statusText: "In.", action: { kind: "link", label: "Add it", href: "/docs" } },
  ],
  activity: [
    { at: "2026-11-01T00:00:00.000Z", atLabel: "Nov 1", actor: "You", text: "added a file" },
    { at: "2026-11-02T00:00:00.000Z", atLabel: "Nov 2", actor: "HiveForYou", text: "read a page" },
    { at: "2026-11-03T00:00:00.000Z", atLabel: "Nov 3", actor: "You", text: "saved the intent" },
    { at: "2026-11-04T00:00:00.000Z", atLabel: "Nov 4", actor: "HiveForYou", text: "built the study" },
  ],
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
    assigneeUserId: DANA,
    assigneeDisplayName: "Dana Cole",
    stage: "open",
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
      teamNotes={[
        {
          teamNoteId: "n1",
          authorUserId: MARIA,
          authorDisplayName: "Maria Alvarez",
          body: "On stubs",
          itemRef: "X1",
          createdAt: "2026-11-02T00:00:00.000Z",
        },
        {
          teamNoteId: "n2",
          authorUserId: DANA,
          authorDisplayName: "Dana Cole",
          body: "General note",
          itemRef: null,
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ]}
      handover={{ fromDisplayName: "Dana Cole", note: "Please review the dates.", createdAt: "2026-11-02T00:00:00.000Z" }}
      uploads={[
        { sourceDocumentId: "d1", fileName: "stubs.pdf", canonicalGapId: "X1", canonicalGapTitle: "Pay stubs" },
        { sourceDocumentId: "d2", fileName: "lease.pdf", canonicalGapId: "X2", canonicalGapTitle: "Lease" },
      ]}
      openHiveCounts={{ [MARIA]: 2, [DANA]: 4 }}
      documentLabels={{}}
    />,
  );
}

function filledActions(): HTMLElement[] {
  return [...screen.queryAllByRole("link"), ...screen.queryAllByRole("button")].filter((element) =>
    element.className.includes("bg-cell-blue-deep"),
  );
}

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
  );
});

describe("HiveBoardThreePane", () => {
  it("renders three panes for firm staff and keeps the old board for an own hive", () => {
    expect(showsFirmThreePane(hive())).toBe(true);
    expect(showsFirmThreePane(hive({ kind: "own", firmId: null, membershipRole: "owner" }))).toBe(false);
    expect(showsFirmThreePane(hive({ membershipRole: "client" }))).toBe(false);

    renderPane();
    expect(screen.getByRole("region", { name: "Your team" })).toBeTruthy();
    expect(screen.getByRole("region", { name: /Sarah.s table/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Ruth Ortiz" })).toBeTruthy();
    expect(screen.getByText("Team only")).toBeTruthy();
    expect(screen.getByText("Intake for Ruth Ortiz")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See what Ruth sees" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite Ruth" })).toBeTruthy();
    cleanup();

    render(
      <HiveBoardPanel
        hive={hive({ kind: "own", firmId: null, membershipRole: "owner", name: "Home renovation" })}
        currentUserId={MARIA}
        hiveId={HIVE_ID}
        hiveName="Home renovation"
        hiveDescription=""
        hasDocuments
        board={{ ...board, kicker: "Your hive", headline: "Everything is in and checked", needs: [] }}
        documentLabels={{}}
      />,
    );
    expect(screen.getByTestId("hive-board-main")).toBeTruthy();
    expect(screen.queryByTestId("hive-board-three-pane")).toBeNull();
    expect(screen.queryByTestId("hive-board-firm-controls")).toBeNull();
  });

  it("filters notes and uploads to the selected item and keeps one filled button", () => {
    renderPane();
    expect(filledActions()).toHaveLength(1);
    expect(filledActions()[0]?.textContent).toBe("Review");
    expect(screen.getByText("General note")).toBeTruthy();
    expect(screen.getByText("lease.pdf")).toBeTruthy();
    expect(screen.getByText("built the study")).toBeTruthy();
    expect(screen.queryByText("added a file")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Pay stubs/ }));
    expect(screen.getByText("On stubs")).toBeTruthy();
    expect(screen.queryByText("General note")).toBeNull();
    expect(screen.getByText("stubs.pdf")).toBeTruthy();
    expect(screen.queryByText("lease.pdf")).toBeNull();
    expect(filledActions()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(screen.getByText("added a file")).toBeTruthy();
  });

  it("opens on Items and shows Team, Items, and the client below 1100px", () => {
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
    expect(screen.queryByRole("region", { name: "Your team" })).toBeNull();
    expect(screen.getByRole("region", { name: /Sarah.s table/ })).toBeTruthy();

    fireEvent.click(within(tabs).getByRole("tab", { name: "Team" }));
    expect(screen.getByRole("region", { name: "Your team" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Sarah’s table" })).toBeNull();

    fireEvent.click(within(tabs).getByRole("tab", { name: "Ruth" }));
    expect(screen.getByRole("region", { name: "Ruth Ortiz" })).toBeTruthy();
  });

  it("requires a person before handing a hive over", () => {
    renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    const dialog = screen.getByRole("dialog", { name: "Hand over this hive" });
    expect(within(dialog).getByText("Attorney")).toBeTruthy();
    expect(within(dialog).getByText("2 hives")).toBeTruthy();
    expect(within(dialog).queryByText("Paralegal")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Hand over" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Choose who takes it.");
  });
});
