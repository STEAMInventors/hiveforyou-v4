// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { bankruptcyC13Fixture } from "./fixtures/bankruptcy-c13";
import { noAnchorHouseholdFixture } from "./fixtures/no-anchor-household";
import { StudyReport } from "./StudyReport";
import { StudyView } from "./StudyView";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

function renderReport(audience: "CUSTOMER" | "PRO", fixture = bankruptcyC13Fixture(audience), coverageGaps = fixture.coverageGaps) {
  return render(
    <StudyReport
      hiveId={fixture.hiveId}
      view={fixture.view}
      sources={fixture.sources}
      header={{ kind: "report", audience, fallbackTitle: fixture.title, revisionNumber: 3, writtenAt: fixture.writtenAt }}
      coverageGaps={coverageGaps}
      documentPages={fixture.documentPages}
    />,
  );
}

describe("StudyReport", () => {
  it("shows the same state counts for both audiences", () => {
    renderReport("CUSTOMER");
    const customer = screen.getAllByRole("link").filter((link) => link.closest('[data-testid="state-bar"]')).map((link) => link.textContent);
    cleanup();
    renderReport("PRO");
    const pro = screen.getAllByRole("link").filter((link) => link.closest('[data-testid="state-bar"]')).map((link) => link.textContent);
    expect(customer).toEqual(["4 need you", "6 changed", "2 missing", "3 checked"]);
    expect(pro).toEqual(customer);
  });

  it("renders the header from the intent and meta, and never shows a file name outside the evidence viewer", () => {
    renderReport("PRO");
    const header = screen.getByTestId("report-header");
    expect(within(header).getByRole("heading", { level: 2 }).textContent).toBe(
      "Will the amended plan be approved at the May hearing, and what could stop it?",
    );
    expect(header.textContent).toContain("Pro report · From study revision 3 · Written Nov 6, 2026");
    expect(header.textContent).toContain("You asked:");
    expect(document.body.textContent).not.toMatch(/\.pdf/);
    expect(screen.getAllByTestId("source-chip").every((chip) => /^.+ · p\.\d+$/.test(chip.textContent ?? ""))).toBe(true);
  });

  it("builds At a glance from code: the upcoming hearing, the first disagreement and the open items", () => {
    renderReport("PRO");
    const glance = document.getElementById("at-a-glance")!;
    const text = glance.textContent ?? "";
    expect(text).toContain("Upcoming in the documents");
    expect(text).toContain("May 14, 2026 · Confirmation hearing.");
    expect(text).toContain("Where documents disagree");
    expect(text).toContain("Gross monthly wages: the schedules report $4,850.00");
    expect(text).toContain("Open items4Cure of the mortgage arrearage through the plan");
  });

  it("shows one comparison card per conflict with the code-computed difference", () => {
    renderReport("PRO");
    const cards = screen.getAllByTestId("comparison-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getAllByTestId("comparison-value").map((node) => node.textContent)).toEqual(["$4,850.00", "$5,325.00"]);
    expect(within(cards[0]!).getByTestId("comparison-difference").textContent).toContain(
      "Difference: $475.00 · calculated from the two amounts above",
    );
    expect(within(cards[1]!).getByTestId("comparison-difference").textContent).toContain("$2,580.00");
  });

  it("strikes through replaced values and groups what is missing", () => {
    renderReport("PRO");
    const superseded = document.querySelector('[data-row-id="S2"]') as HTMLElement;
    expect(within(superseded).getByText("Changed")).toBeTruthy();
    expect(within(superseded).getByTestId("changed-value").querySelector("s")?.textContent).toContain("$510.00 per month for 60 months");
    const missing = screen.getByTestId("missing-list");
    expect(missing.querySelector('[data-group="referenced"]')?.textContent).toContain("2025 federal income tax return");
    expect(within(missing.querySelector('[data-group="referenced"]') as HTMLElement).getAllByTestId("source-chip")).toHaveLength(3);
    expect(missing.querySelector('[data-group="expected"]')?.textContent).toContain("No pay records after February 2026");
    expect(missing.querySelector('[data-group="unreadable"]')).toBeNull();
  });

  it("labels documents by kind, with month and year for the two plan versions, and plain roles", () => {
    renderReport("PRO");
    const table = screen.getByTestId("documents-table");
    const rows = within(table).getAllByRole("row").slice(1).map((row) => Array.from(row.children).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["Bankruptcy petition", "Supporting", "Mar 2, 2026", "35"],
      ["Repayment plan · Mar 2026", "Main document, earlier version", "Mar 2, 2026", "2"],
      ["Trustee's objection", "Supporting", "Apr 10, 2026", "1"],
      ["Repayment plan · Apr 2026", "Main document", "Apr 28, 2026", "2"],
      ["Employer pay summary", "Supporting", "Feb 27, 2026", "1"],
      ["Mortgage servicer letter", "Supporting", "Apr 2, 2026", "1"],
    ]);
  });

  it("collapses the tables for Customer under one disclosure and keeps them expanded for Pro", () => {
    renderReport("CUSTOMER");
    const toggle = screen.getByTestId("see-details");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("establish-table").closest("[hidden]")).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("establish-table").closest("[hidden]")).toBeNull();
    cleanup();

    renderReport("PRO");
    expect(screen.queryByTestId("see-details")).toBeNull();
    expect(screen.getByTestId("establish-table").closest("[hidden]")).toBeNull();
  });

  it("opens the details when the rail links to a collapsed section", () => {
    renderReport("CUSTOMER");
    const rail = screen.getByRole("complementary", { name: "On this page" });
    fireEvent.click(within(rail).getByRole("link", { name: "Timeline" }));
    expect(screen.getByTestId("see-details").getAttribute("aria-expanded")).toBe("true");
  });

  it("notes the missing anchor without listing it as missing, and picks the next due date as upcoming", () => {
    const fixture = noAnchorHouseholdFixture("CUSTOMER");
    renderReport("CUSTOMER", fixture);
    expect(document.getElementById("what-documents-establish")?.textContent).toContain("No single document governs this case");
    expect(screen.getByTestId("missing-list").textContent).not.toContain("No single document governs");
    expect(document.querySelector('[data-upcoming="true"]')?.textContent).toContain("Insurance premium due.");
    expect(screen.getByTestId("comparison-difference").textContent).toContain("$82.00");
  });

  it("shows the read-problem notice and a coral role when a document could not be read", () => {
    const fixture = noAnchorHouseholdFixture("PRO");
    renderReport("PRO", fixture, [
      {
        key: "k",
        sourceDocumentId: "40e10002-0000-4000-8000-000000000002",
        fileName: "02_water_bill.pdf",
        reason: "NO_TEXT",
        pageNumbers: [],
        material: true,
      },
    ]);
    const notice = screen.getByTestId("read-problem-notice");
    expect(notice.textContent).toContain("Water bill could not be read.");
    expect(notice.textContent).toContain("1 page came back without text, so it is not part of this report.");
    expect(within(notice).getByRole("link", { name: "Upload a clearer copy" }).getAttribute("href")).toBe(
      "/hives/40e140e1-0000-4000-8000-000000000000/documents",
    );
    expect(within(notice).queryByTestId("source-chip")).toBeNull();
    expect(screen.getByTestId("missing-list").querySelector('[data-group="unreadable"]')?.textContent).toContain("Water bill");
    expect(screen.getByText("Could not be read", { selector: "td" })).toBeTruthy();
    expect(screen.getByText("3 missing")).toBeTruthy();
  });
});

describe("StudyView", () => {
  it("renders the study in the report layout without narrative or audience switch", () => {
    const fixture = bankruptcyC13Fixture("CUSTOMER");
    render(
      <StudyView
        hiveId={HIVE_ID}
        revisionFormat="canonical-study-1"
        view={fixture.view}
        sources={fixture.sources}
        revisionNumber={2}
        documentPages={fixture.documentPages}
      />,
    );
    expect(screen.getByTestId("report-header").textContent).toContain("From study revision 2");
    expect(screen.queryAllByTestId("study-view-section")).toHaveLength(0);
    expect(document.getElementById("at-a-glance")).toBeNull();
    expect(screen.getAllByTestId("comparison-card")).toHaveLength(2);
    expect(screen.queryByTestId("see-details")).toBeNull();
    expect(screen.getByTestId("establish-table")).toBeTruthy();
  });

  it("shows a Rebuild notice instead of a view for investigation-1 revisions", () => {
    const fixture = bankruptcyC13Fixture("CUSTOMER");
    render(<StudyView hiveId={HIVE_ID} revisionFormat="investigation-1" view={fixture.view} sources={fixture.sources} />);
    expect(screen.getByTestId("study-legacy-notice")).toBeTruthy();
    expect(screen.getByTestId("study-legacy-rebuild").getAttribute("href")).toBe(`/hives/${HIVE_ID}/documents`);
    expect(screen.queryByTestId("study-view")).toBeNull();
  });

  it("treats a revision without a format as investigation-1", () => {
    render(<StudyView hiveId={HIVE_ID} revisionFormat={undefined} view={null} sources={null} />);
    expect(screen.getByTestId("study-legacy-notice")).toBeTruthy();
  });

  it("says the view is not written yet when a canonical revision has no study view", () => {
    render(<StudyView hiveId={HIVE_ID} revisionFormat="canonical-study-1" view={null} sources={null} />);
    expect(screen.getByTestId("study-view-pending")).toBeTruthy();
  });
});
