// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Hive } from "@hiveforyou/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111/documents",
}));

import { hiveFindingsPath, hiveSectionFromPathname } from "@/lib/hive-routes";

import { HiveSidebar } from "./HiveSidebar";
import { findingsToReviewCount, sidebarCounts } from "./sidebar-counts";
import type { HiveSummary } from "@/server/hives/hive-summary";

const hive: Hive = {
  id: "11111111-1111-4111-8111-111111111111",
  hiveId: "11111111-1111-4111-8111-111111111111",
  name: "Dana Ellis",
  description: "Family benefits application",
  kind: "client",
  firmId: "33333333-3333-4333-8333-333333333333",
  clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
});

function renderMenu(overrides: Partial<ComponentProps<typeof HiveSidebar>> = {}) {
  return render(
    <HiveSidebar
      hive={hive}
      startingView="clients"
      active="documents"
      counts={{ toReviewCount: 2, documents: 9, reports: 1, teamNotes: 4, unreadMessages: null }}
      assigneeLabel="Priya"
      assistantName="Sarah"
      {...overrides}
    />,
  );
}

describe("HiveSidebar (D24 left menu)", () => {
  it("lists Home through Team notes with Documents current and count from data", () => {
    renderMenu();
    const nav = screen.getByRole("navigation", { name: "Hive pages" });
    const scoped = within(nav);
    const current = scoped.getByRole("link", { name: /Documents/ });
    expect(current.getAttribute("data-tab")).toBe("documents");
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(scoped.getByLabelText("9 documents")).toBeTruthy();
    expect(scoped.getByRole("link", { name: /Home/ }).getAttribute("data-tab")).toBe("home");
    expect(scoped.getByRole("link", { name: /Report/ }).getAttribute("data-tab")).toBe("report");
  });

  it("marks Report current on findings and reports routes", () => {
    for (const path of [hiveFindingsPath(hive.id), `/hives/${hive.id}/reports`]) {
      expect(hiveSectionFromPathname(path.split("#")[0] ?? "", hive.id)).toBeTruthy();
    }
    renderMenu({ active: "findings" });
    const report = screen.getByRole("link", { name: /Report/ });
    expect(report.getAttribute("aria-current")).toBe("page");
    expect(report.getAttribute("data-tab")).toBe("report");
  });

  it("shows ← All hives for staff client hives and people footer", () => {
    renderMenu();
    expect(screen.getByRole("link", { name: /All hives/ })).toBeTruthy();
    expect(screen.getByTestId("hive-people-line").textContent).toContain("Sarah");
  });

  it("hides Team notes on own hives", () => {
    renderMenu({
      hive: { ...hive, kind: "own", firmId: undefined, name: "Tax prep" },
      startingView: "own",
    });
    expect(screen.queryByRole("link", { name: /Team notes/ })).toBeNull();
    expect(screen.getByTestId("hive-people-line").textContent).toMatch(/You and Sarah/);
  });
});

describe("sidebarCounts", () => {
  it("carries unread messages even when the summary failed, and never shows zero", () => {
    expect(sidebarCounts(null, { reportCount: null, teamNotesCount: null, unreadMessageCount: 2 }).unreadMessages).toBe(2);
    expect(sidebarCounts(null, { reportCount: null, teamNotesCount: null, unreadMessageCount: 0 }).unreadMessages).toBeNull();
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
