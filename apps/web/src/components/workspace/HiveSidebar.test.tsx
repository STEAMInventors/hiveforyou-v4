// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Hive } from "@hiveforyou/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111/board",
}));

import { hiveFindingsPath, hiveSectionFromPathname, type FindingsTab } from "@/lib/hive-routes";

import { HiveSidebar } from "./HiveSidebar";
import { findingsToReviewCount, sidebarCounts } from "./sidebar-counts";
import type { HiveSummary } from "@/server/hives/hive-summary";

const hive: Hive = {
  id: "11111111-1111-4111-8111-111111111111",
  hiveId: "11111111-1111-4111-8111-111111111111",
  name: "Client hive",
  kind: "client",
  firmId: "33333333-3333-4333-8333-333333333333",
  clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const firm = {
  firm: { id: hive.firmId!, name: "Firm", assistantName: "Assistant" },
  members: [],
  invites: [],
};

afterEach(() => {
  cleanup();
});

function renderRail(overrides: Partial<ComponentProps<typeof HiveSidebar>> = {}) {
  return render(
    <HiveSidebar
      hive={hive}
      startingView="clients"
      active="board"
      counts={{ toReviewCount: 2, documents: 3, reports: 1, teamNotes: 4, unreadMessages: null }}
      firm={firm}
      currentUserId="user"
      assigneeLabel="You"
      assigneeTitle="Attorney"
      assistantName="Assistant"
      summaryLoaded
      studyRevision={{ revisionNumber: 3, acceptedAt: "2026-11-17T12:00:00.000Z" }}
      {...overrides}
    />,
  );
}

describe("HiveSidebar", () => {
  it("lists Your hive in order, with Findings carrying the to-review count", () => {
    renderRail();
    expect(screen.getByText("Your hive")).toBeTruthy();
    const labels = screen.getAllByRole("link").map((link) => (link.textContent ?? "").replace(/\d+/g, "").trim());
    expect(labels).toEqual(["Hive board", "Documents", "Findings", "Reports", "Audit trail", "Team notes"]);
    expect(screen.getByLabelText("2 to review")).toBeTruthy();
    const board = screen.getByRole("link", { name: "Hive board" });
    expect(board.textContent).toBe("Hive board");
    expect(findingsToReviewCount(null)).toBeNull();
  });

  it("shows Team notes for firm staff and hides it from clients", () => {
    renderRail();
    expect(screen.getByRole("link", { name: /Team notes/ })).toBeTruthy();
    cleanup();
    renderRail({
      hive: { ...hive, membershipRole: "client" },
      counts: { toReviewCount: 1, documents: 1, reports: null, teamNotes: null, unreadMessages: null },
    });
    expect(screen.queryByRole("link", { name: /Team notes/ })).toBeNull();
    cleanup();
    renderRail({
      hive: { ...hive, firmId: undefined },
      startingView: "own",
      firm: null,
      assigneeLabel: null,
      assigneeTitle: null,
      assistantName: "HiveForYou",
      counts: { toReviewCount: 1, documents: 1, reports: null, teamNotes: null, unreadMessages: null },
    });
    expect(screen.queryByRole("link", { name: /Team notes/ })).toBeNull();
  });

  it("marks Findings current for every findings address and hides a zero count", () => {
    const paths = [
      hiveFindingsPath(hive.id),
      hiveFindingsPath(hive.id, "gaps"),
      hiveFindingsPath(hive.id, "timeline"),
    ];
    for (const path of paths) {
      const base = path.split("#")[0] ?? "";
      expect(hiveSectionFromPathname(base, hive.id)).toBe("findings");
    }
    renderRail({
      active: "findings",
      counts: { toReviewCount: null, documents: null, reports: null, teamNotes: null, unreadMessages: null },
    });
    const findings = screen.getByRole("link", { name: "Findings" });
    expect(findings.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByLabelText(/to review/)).toBeNull();
  });

  it("puts the unread message count on Hive board, hidden when there is none", () => {
    renderRail({ counts: { toReviewCount: null, documents: null, reports: null, teamNotes: null, unreadMessages: 3 } });
    const board = screen.getByRole("link", { name: /Hive board/ });
    expect(board.textContent).toBe("Hive board3");
    expect(screen.getByLabelText("3 unread messages")).toBeTruthy();
    cleanup();
    renderRail({ counts: { toReviewCount: null, documents: null, reports: null, teamNotes: null, unreadMessages: null } });
    expect(screen.getByRole("link", { name: "Hive board" }).textContent).toBe("Hive board");
    expect(screen.queryByLabelText(/unread messages/)).toBeNull();
  });

  it("keeps the uppercase group label as the only uppercase text in the rail", () => {
    const { container } = renderRail();
    const uppercase = Array.from(container.querySelectorAll<HTMLElement>("[class*='uppercase']"));
    expect(uppercase.map((el) => el.textContent)).toEqual(["Your hive"]);
    expect(uppercase[0]!.className).toContain("text-[11px]");
  });

  it("shows the study footer on the desktop rail", () => {
    renderRail();
    const footer = screen.getByTestId("study-rail-footer");
    const accepted = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
      new Date("2026-11-17T12:00:00.000Z"),
    );
    expect(footer.textContent).toContain("Study revision");
    expect(footer.textContent).toContain("v3");
    expect(footer.textContent).toContain("Every finding links to its source page.");
    expect(footer.textContent).toContain(`Accepted ${accepted}`);
  });

  it("says there is no study yet when the summary loaded without one", () => {
    renderRail({ studyRevision: null });
    const footer = screen.getByTestId("study-rail-footer");
    expect(footer.textContent).toContain("No Study yet");
    expect(footer.textContent).toContain("Builds once documents are read");
  });

  it("hides the footer when the summary failed and on the phone rail", () => {
    renderRail({ summaryLoaded: false });
    expect(screen.queryByTestId("study-rail-footer")).toBeNull();
    cleanup();
    renderRail({ compact: true });
    expect(screen.getByTestId("hive-sidebar-compact")).toBeTruthy();
    expect(screen.queryByTestId("study-rail-footer")).toBeNull();
  });
});

describe("sidebarCounts", () => {
  it("carries unread messages even when the summary failed, and never shows zero", () => {
    expect(sidebarCounts(null, { reportCount: null, teamNotesCount: null, unreadMessageCount: 2 }).unreadMessages).toBe(2);
    expect(sidebarCounts(null, { reportCount: null, teamNotesCount: null, unreadMessageCount: 0 }).unreadMessages).toBeNull();
    expect(sidebarCounts(null, { reportCount: null, teamNotesCount: null, unreadMessageCount: null }).unreadMessages).toBeNull();
  });
});

describe("findingsToReviewCount", () => {
  it("sums needs and changed and hides zero", () => {
    const summary = {
      study: { counts: { needs: 1, changed: 2, missing: 4, checked: 5 } },
    } as HiveSummary;
    expect(findingsToReviewCount(summary)).toBe(3);
    expect(
      findingsToReviewCount({ study: { counts: { needs: 0, changed: 0, missing: 2, checked: 1 } } } as HiveSummary),
    ).toBeNull();
  });
});
