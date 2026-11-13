// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { HiveSummary } from "@/server/hives/hive-summary";

import { HiveTabNav } from "./hive-tab-nav";
import { HivePageHeader, HiveWorkspaceLayout } from "./hive-workspace-layout";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

const WITH_STUDY: HiveSummary = {
  documentCount: 4,
  study: {
    revisionNumber: 3,
    acceptedAt: "2026-11-04T10:00:00.000Z",
    counts: { needs: 4, changed: 6, missing: 2, checked: 3 },
    targets: {
      needs: "where-documents-disagree",
      changed: "what-documents-establish",
      missing: "what-is-missing",
      checked: "what-documents-establish",
    },
  },
};

const NO_STUDY: HiveSummary = { documentCount: 1, study: null };

afterEach(cleanup);

describe("HivePageHeader", () => {
  it("shows the name, description, meta line and the state bar of the accepted study", () => {
    render(
      <HivePageHeader
        hiveId={HIVE_ID}
        hiveName="Widget batch review"
        hiveDescription="Plan payments and the trustee's objection."
        summary={WITH_STUDY}
        onStudyTab={false}
      />,
    );
    const header = within(screen.getByTestId("hive-page-header"));
    expect(header.getByRole("heading", { level: 1 }).textContent).toBe("Widget batch review");
    expect(header.getByText("Plan payments and the trustee's objection.")).toBeTruthy();
    expect(screen.getByTestId("hive-meta").textContent).toBe("4 documents · Study revision 3, accepted Nov 4, 2026");
    const pills = within(screen.getByTestId("state-bar")).getAllByRole("link");
    expect(pills.map((pill) => pill.textContent)).toEqual([
      "4 issues to resolve",
      "2 documents would help complete this review",
      "6 changes from the original",
      "3 facts confirmed",
    ]);
    expect(pills[0]!.getAttribute("href")).toBe(`/hives/${HIVE_ID}/study#where-documents-disagree`);
  });

  it("links the state bar within the page on the Study tab", () => {
    render(<HivePageHeader hiveId={HIVE_ID} hiveName="Widget batch review" hiveDescription="" summary={WITH_STUDY} onStudyTab />);
    const pills = within(screen.getByTestId("state-bar")).getAllByRole("link");
    expect(pills[1]!.getAttribute("href")).toBe("#what-is-missing");
  });

  it("says there is no study yet and hides the state bar without one", () => {
    render(<HivePageHeader hiveId={HIVE_ID} hiveName="Lease renewal" hiveDescription="" summary={NO_STUDY} onStudyTab={false} />);
    expect(screen.getByTestId("hive-meta").textContent).toBe("1 document · No study yet");
    expect(screen.queryByTestId("state-bar")).toBeNull();
    expect(screen.getByTestId("hive-page-header").querySelectorAll("p")).toHaveLength(1);
  });

  it("hides the state bar while an accepted study has no study view yet", () => {
    const summary: HiveSummary = { documentCount: 2, study: { ...WITH_STUDY.study!, counts: null, targets: null } };
    render(<HivePageHeader hiveId={HIVE_ID} hiveName="Household bills" hiveDescription="" summary={summary} onStudyTab />);
    expect(screen.getByTestId("hive-meta").textContent).toContain("Study revision 3");
    expect(screen.queryByTestId("state-bar")).toBeNull();
  });
});

describe("HiveTabNav", () => {
  it("marks only the active tab with aria-current and the underline", () => {
    render(<HiveTabNav hiveId={HIVE_ID} active="study" />);
    const nav = screen.getByRole("navigation", { name: "Hive sections" });
    const tabs = within(nav).getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Documents", "Study", "Reports"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-current"))).toEqual([null, "page", null]);
    expect(tabs[1]!.className).toContain("after:bg-cell-blue");
    expect(tabs[1]!.className).toContain("after:-bottom-px");
    expect(tabs[0]!.className).not.toContain("after:bg-cell-blue");
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual([
      `/hives/${HIVE_ID}/documents`,
      `/hives/${HIVE_ID}/study`,
      `/hives/${HIVE_ID}/reports`,
    ]);
  });

  it("never scrolls or clips: no overflow and no negative margin on the tabs", () => {
    render(<HiveTabNav hiveId={HIVE_ID} active="documents" />);
    const nav = screen.getByTestId("hive-tabs");
    for (const element of [nav, ...nav.querySelectorAll("*")]) {
      expect(element.getAttribute("class") ?? "").not.toMatch(/overflow-|(^|\s)-mb-/);
    }
  });
});

describe("HiveWorkspaceLayout", () => {
  it("shows the Ask field on Study and Reports, not on Documents", () => {
    const { rerender } = render(
      <HiveWorkspaceLayout hiveId={HIVE_ID} hiveName="Widget batch review" hiveDescription="" activeTab="study" summary={WITH_STUDY}>
        <p>Pane</p>
      </HiveWorkspaceLayout>,
    );
    const ask = screen.getByRole("textbox", { name: "Ask about these documents" });
    expect(ask.getAttribute("placeholder")).toBe("Ask about these documents");
    expect(ask.closest(".hive-ask")).not.toBeNull();
    rerender(
      <HiveWorkspaceLayout hiveId={HIVE_ID} hiveName="Widget batch review" hiveDescription="" activeTab="documents" summary={WITH_STUDY}>
        <p>Pane</p>
      </HiveWorkspaceLayout>,
    );
    expect(screen.queryByRole("textbox", { name: "Ask about these documents" })).toBeNull();
  });
});
