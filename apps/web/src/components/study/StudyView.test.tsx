// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, buildStudyView, buildStudyViewSources } from "@hiveforyou/contracts";

import { bankruptcyC13Fixture, bankruptcyC13Revision4Fixture, bankruptcyC13StudyOnlyFixture } from "./fixtures/bankruptcy-c13";
import { legacyCanonicalGapsFixture } from "./fixtures/legacy-canonical-gaps";
import { mayaIepFixture } from "./fixtures/maya-iep";
import { MAYA_REVISION_1_ANCHOR_GAP, MAYA_REVISION_1_PROGRESS_GAP, mayaRevision1Fixture } from "./fixtures/maya-revision-1";
import { noAnchorHouseholdFixture } from "./fixtures/no-anchor-household";
import { studyDocumentMeta, studyDocumentRequestCount, studyStateCounts } from "./study-summary";
import { StudyReport, titleFromIntent } from "./StudyReport";
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
    expect(customer).toEqual([
      "4 issues to resolve",
      "2 documents missing",
      "6 changes from the original",
      "3 facts confirmed",
    ]);
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

  it("hides the in-card state bar when the report revision matches the current revision", () => {
    const fixture = bankruptcyC13Fixture("CUSTOMER");
    render(
      <StudyReport
        hiveId={fixture.hiveId}
        view={fixture.view}
        sources={fixture.sources}
        header={{
          kind: "report",
          audience: "CUSTOMER",
          fallbackTitle: fixture.title,
          revisionNumber: 3,
          writtenAt: fixture.writtenAt,
          currentRevisionNumber: 3,
        }}
        coverageGaps={fixture.coverageGaps}
        documentPages={fixture.documentPages}
      />,
    );
    expect(screen.queryByTestId("state-bar")).toBeNull();
  });

  it("shows “As of revision” when the displayed report is older than the current revision", () => {
    const fixture = bankruptcyC13Fixture("CUSTOMER");
    render(
      <StudyReport
        hiveId={fixture.hiveId}
        view={fixture.view}
        sources={fixture.sources}
        header={{
          kind: "report",
          audience: "CUSTOMER",
          fallbackTitle: fixture.title,
          revisionNumber: 2,
          writtenAt: fixture.writtenAt,
          currentRevisionNumber: 3,
        }}
        coverageGaps={fixture.coverageGaps}
        documentPages={fixture.documentPages}
      />,
    );
    expect(screen.getByText(/As of revision 2/)).toBeTruthy();
    expect(screen.getByTestId("state-bar")).toBeTruthy();
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

  it("strikes through replaced values and lists what to ask for", () => {
    renderReport("PRO");
    const superseded = document.querySelector('[data-row-id="S2"]') as HTMLElement;
    expect(within(superseded).getByText("Changed")).toBeTruthy();
    expect(within(superseded).getByTestId("changed-value").querySelector("s")?.textContent).toContain("$510.00 per month for 60 months");
    const ask = screen.getByTestId("document-request-list");
    expect(ask.textContent).toContain("2025 federal income tax return");
    expect(within(ask).getAllByTestId("source-chip").length).toBeGreaterThanOrEqual(1);
    expect(ask.textContent).toContain("Schedule D");
    expect(ask.textContent).toContain("follow up on later");
    expect(screen.getByRole("heading", { name: "Later" })).toBeTruthy();
    expect(ask.textContent).toContain("Court ruling on confirmation");
    expect(document.getElementById("missing-documents")).not.toBeNull();
  });

  it("labels documents by kind, with month and year for the two plan versions, and plain roles", () => {
    renderReport("PRO");
    const table = screen.getByTestId("documents-table");
    const rows = within(table).getAllByRole("row").slice(1).map((row) => Array.from(row.children).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["Bankruptcy petition", "Supporting", "Mar 2, 2026", "35"],
      ["Repayment plan", "Main document, earlier version", "Mar 2, 2026", "2"],
      ["Trustee's objection", "Supporting", "Apr 10, 2026", "1"],
      ["Repayment plan (amended)", "Main document", "Apr 28, 2026", "2"],
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
    expect(screen.getByTestId("document-request-list").textContent).not.toContain("No single document governs");
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
    expect(screen.getByText("2 documents missing")).toBeTruthy();
  });
});

describe("DocumentRequestList", () => {
  it("bankruptcy revision 4 lists 4 ask-now slots, 3 claims-register items, and 2 later", () => {
    const fixture = bankruptcyC13Revision4Fixture("PRO");
    render(
      <StudyReport
        hiveId={fixture.hiveId}
        view={fixture.view}
        sources={fixture.sources}
        header={{ kind: "report", audience: "PRO", fallbackTitle: fixture.title, revisionNumber: 4, writtenAt: fixture.writtenAt }}
        documentPages={fixture.documentPages}
      />,
    );
    const list = screen.getByTestId("document-request-list");
    expect(list.querySelectorAll('[data-kind="REQUESTABLE_DOCUMENT"]')).toHaveLength(4);
    expect(list.querySelectorAll('[data-kind="FUTURE_RECORD"]')).toHaveLength(2);
    expect(screen.getByTestId("court-register-line").textContent).toContain("3 items");
    expect(screen.getByTestId("court-register-line").textContent).toContain("claims register");
    expect(screen.getByRole("heading", { name: "Missing documents" })).toBeTruthy();
  });

  it("renders statement-only legacy gaps as a plain list under the rebuild hint", () => {
    const fixture = legacyCanonicalGapsFixture();
    render(
      <StudyView
        hiveId={fixture.hiveId}
        revisionFormat="canonical-study-1"
        view={fixture.view}
        sources={fixture.sources}
        revisionNumber={1}
      />,
    );
    const list = screen.getByTestId("document-request-list");
    expect(list.querySelectorAll('[data-kind="REQUESTABLE_DOCUMENT"]')).toHaveLength(0);
    expect(list.querySelectorAll('[data-kind="LEGACY_STATEMENT"]')).toHaveLength(2);
    expect(screen.getByTestId("document-request-legacy-hint").textContent).toContain("Rebuild the study for a clearer list");
    expect(list.textContent).not.toContain("Likely held by");
    expect(list.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryByText(/documents missing/)).toBeNull();
    expect(document.getElementById("missing-documents")).not.toBeNull();
    expect(studyDocumentRequestCount(fixture.view)).toBe(0);
  });

  it("drops Maya revision-1 pipeline gaps from Missing documents and does not count the rest", () => {
    const fixture = mayaRevision1Fixture();
    render(
      <StudyView
        hiveId={fixture.hiveId}
        revisionFormat="canonical-study-1"
        view={fixture.view}
        sources={fixture.sources}
        revisionNumber={1}
      />,
    );
    const missing = document.getElementById("missing-documents");
    expect(missing?.textContent).toContain(MAYA_REVISION_1_PROGRESS_GAP);
    expect(missing?.textContent).not.toContain(MAYA_REVISION_1_ANCHOR_GAP);
    expect(missing?.textContent).not.toContain("page could not");
    expect(missing?.textContent).not.toContain("Likely held by");
    expect(missing?.textContent).not.toContain("You or your client");
    expect(missing?.querySelectorAll('[data-kind="LEGACY_STATEMENT"]')).toHaveLength(1);
    expect(screen.queryByText(/documents missing/)).toBeNull();
    expect(studyDocumentRequestCount(fixture.view)).toBe(0);
  });

  it("does not repeat a reason that equals the title", () => {
    const study = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [
        {
          id: "X1",
          statement: "Tax return",
          relatedSpineIds: [],
          kind: "REQUESTABLE_DOCUMENT" as const,
          title: "Tax return",
          why: "Tax return",
          holder: "Debtor",
          holderType: "ASKER_OR_CLIENT" as const,
          when: null,
          basisType: "USUALLY_EXPECTED" as const,
          relatedFactIds: [],
        },
      ],
    };
    const { view } = buildStudyView(study, { sections: [], blocks: [] }, [], {});
    render(
      <StudyView
        hiveId={HIVE_ID}
        revisionFormat="canonical-study-1"
        view={view}
        sources={buildStudyViewSources(view, [], new Map())}
        revisionNumber={1}
      />,
    );
    const row = document.querySelector('[data-row-id="X1"]');
    expect(row?.textContent?.match(/Tax return/g)).toHaveLength(1);
    expect(row?.textContent).toContain("Likely held by: Debtor");
  });

  it("shows Maya's Hive with 4 ask-now, 2 later, and attaches one observation to the spine row", () => {
    const fixture = mayaIepFixture("CUSTOMER");
    render(
      <StudyReport
        hiveId={fixture.hiveId}
        view={fixture.view}
        sources={fixture.sources}
        header={{ kind: "report", audience: "CUSTOMER", fallbackTitle: fixture.title, revisionNumber: 1, writtenAt: fixture.writtenAt }}
        documentPages={fixture.documentPages}
      />,
    );
    const list = screen.getByTestId("document-request-list");
    expect(list.querySelectorAll('[data-kind="REQUESTABLE_DOCUMENT"]')).toHaveLength(4);
    expect(list.querySelectorAll('[data-kind="FUTURE_RECORD"]')).toHaveLength(2);
    expect(document.querySelector('[data-row-id="S1"] [data-observation="true"]')?.textContent).toContain("comprehension");
  });

  it("falls back to a plain list when the write model invents items", () => {
    const fixture = bankruptcyC13Fixture("PRO");
    const badWrite = {
      ...fixture.view,
      components: [{ ...fixture.view.components[0]!, fallback: true }],
    };
    render(
      <StudyReport
        hiveId={fixture.hiveId}
        view={badWrite}
        sources={fixture.sources}
        header={{ kind: "report", audience: "PRO", fallbackTitle: fixture.title, revisionNumber: 3, writtenAt: fixture.writtenAt }}
        documentPages={fixture.documentPages}
      />,
    );
    expect(screen.getByTestId("document-request-list").getAttribute("data-fallback")).toBe("true");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("StudyView", () => {
  it("renders revision actions beside the revision line", () => {
    const fixture = bankruptcyC13Fixture("CUSTOMER");
    render(
      <StudyView
        hiveId={HIVE_ID}
        revisionFormat="canonical-study-1"
        view={fixture.view}
        sources={fixture.sources}
        revisionNumber={2}
        documentPages={fixture.documentPages}
        revisionActions={<button type="button">Rebuild study</button>}
      />,
    );
    const header = screen.getByTestId("report-header");
    expect(within(header).getByRole("button", { name: "Rebuild study" })).toBeTruthy();
    expect(header.textContent).toContain("From study revision 2");
  });

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

  it("shows an error notice when the study view could not be built", () => {
    render(<StudyView hiveId={HIVE_ID} revisionFormat="canonical-study-1" view={null} sources={null} />);
    expect(screen.getByTestId("study-view-unavailable")).toBeTruthy();
  });

  it("renders a revision that has no write output from the canonical study alone", () => {
    const fixture = bankruptcyC13StudyOnlyFixture();
    expect(fixture.view.sections).toHaveLength(0);
    render(
      <StudyView
        hiveId={HIVE_ID}
        revisionFormat="canonical-study-1"
        view={fixture.view}
        sources={fixture.sources}
        revisionNumber={3}
        coverageGaps={fixture.coverageGaps}
        documentPages={fixture.documentPages}
      />,
    );
    expect(screen.getByTestId("study-view").getAttribute("data-audience")).toBe("STUDY");
    expect(within(screen.getByTestId("report-header")).getByRole("heading", { level: 2 }).textContent).toBe(
      titleFromIntent(fixture.view.intent),
    );
    expect(screen.queryAllByTestId("study-view-section")).toHaveLength(0);
    expect(screen.getByTestId("establish-table")).toBeTruthy();
    expect(screen.getAllByTestId("comparison-card")).toHaveLength(2);
    expect(document.getElementById("missing-documents")).not.toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByTestId("state-bar")).toBeNull();
  });
});

describe("study summary", () => {
  it("gives the page header the same counts the report's state bar shows", () => {
    const fixture = bankruptcyC13Fixture("PRO");
    expect(studyStateCounts(fixture.view, fixture.coverageGaps)).toEqual({ needs: 4, changed: 6, missing: 2, checked: 3 });
    expect(studyStateCounts(bankruptcyC13StudyOnlyFixture().view, fixture.coverageGaps)).toEqual({
      needs: 4,
      changed: 6,
      missing: 2,
      checked: 3,
    });
  });

  it("labels documents the way the report does", () => {
    const fixture = bankruptcyC13Fixture("PRO");
    const meta = studyDocumentMeta(fixture.view);
    const documents = fixture.view.blocks.find((block) => block.name === "documents")!.rows;
    expect(Object.keys(meta)).toHaveLength(documents.length);
    for (const row of documents) expect(meta[row.id.toLowerCase()]?.label).toBeTruthy();
  });
});
