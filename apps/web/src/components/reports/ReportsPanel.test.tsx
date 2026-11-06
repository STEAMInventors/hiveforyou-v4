// @vitest-environment jsdom
import {
  buildReport,
  compileEditorialPlan,
  type GetHiveReportsResponse,
  type HiveReport,
  type ReportAudience,
  type ReportRun,
  resolveCanonicalFindings,
  StudyAgentLedger,
  studyClaimCatalog,
  verifyStudyInvestigation,
} from "@hiveforyou/contracts";
import {
  L001_INITIAL_IEP_FILE_NAMES,
  L001_INITIAL_IEP_PAGES,
  L001_INITIAL_IEP_PLAN_QUESTION_IDS,
  l001InitialIepStudyAgentTurns,
  l001ProEditorialPlan,
  MAYA_FILE_NAMES,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaStudyOutput,
  mayaWriterOutput,
} from "@hiveforyou/contracts/testing";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { A2uiView } from "@/components/a2ui/A2uiView";
import { bankruptcyC13Fixture } from "@/components/study/fixtures/bankruptcy-c13";

import { ReportsPanel } from "./ReportsPanel";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "dddddddd-0000-4000-8000-000000000001";
const REPORTS_URL = `/api/v1/hives/${HIVE_ID}/reports`;

function claims() {
  const verified = verifyStudyInvestigation(mayaStudyOutput(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: MAYA_PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(MAYA_PAGES)),
  });
  if (!verified.ok) throw new Error(verified.message);
  return studyClaimCatalog(verified.value);
}

function report(audience: ReportAudience, id: string, createdAt = "2026-11-02T10:00:00.000Z"): HiveReport {
  const built = buildReport(mayaWriterOutput(audience), {
    audience,
    claims: claims(),
    fileNames: new Map(Object.entries(MAYA_FILE_NAMES)),
  });
  if (!built.ok) throw new Error(built.message);
  return {
    id,
    reportRunId: `cccccccc-0000-4000-8000-${id.slice(-12)}`,
    studyRevisionId: REVISION_ID,
    revisionNumber: 1,
    audience,
    title: built.value.view.title,
    createdAt,
    view: built.value.view,
    scenarioAnalysis: built.value.scenarioAnalysis,
    modelAlias: "harvester",
  };
}

function reportRun(audience: ReportAudience, status: ReportRun["status"], overrides: Partial<ReportRun> = {}): ReportRun {
  return {
    id: audience === "CUSTOMER" ? "cccccccc-0000-4000-8000-000000000001" : "cccccccc-0000-4000-8000-000000000002",
    hiveId: HIVE_ID,
    studyRevisionId: REVISION_ID,
    audience,
    trigger: "STUDY_ACCEPTED",
    status,
    attemptCount: 1,
    maxAttempts: 3,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: "66666666-6666-4666-8666-666666666666",
    reportId: null,
    createdAt: "2026-11-02T10:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

function state(overrides: Partial<GetHiveReportsResponse> = {}): GetHiveReportsResponse {
  const customer = report("CUSTOMER", "eeeeeeee-0000-4000-8000-000000000001");
  return {
    studyRevision: {
      id: REVISION_ID,
      canonicalStudyId: "ffffffff-0000-4000-8000-000000000001",
      revisionNumber: 1,
      predecessorRevisionId: null,
      processingRunId: MAYA_RUN_ID,
      coverageComplete: false,
      coverageStatus: "NONMATERIAL_GAPS",
      coverageGaps: [
        {
          key: `PAGES_WITHOUT_TEXT:${MAYA_RUN_ID}:${"a".repeat(64)}`,
          sourceDocumentId: MAYA_RUN_ID,
          fileName: "Speech service log.xlsx",
          reason: "PAGES_WITHOUT_TEXT",
          pageNumbers: [2],
          material: false,
        },
      ],
      coverageAcknowledgement: "NOT_REQUIRED",
      createdAt: "2026-11-02T09:00:00.000Z",
    },
    reportRuns: [
      reportRun("CUSTOMER", "SUCCEEDED", { reportId: customer.id }),
      reportRun("PRO", "FAILED", { errorMessageSafe: "The report draft didn't pass our checks." }),
    ],
    latest: [customer],
    history: [customer],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === REPORTS_URL && init?.method === "POST") {
        return new Response(JSON.stringify({ reportRun: reportRun("PRO", "QUEUED", { attemptCount: 0, trigger: "OWNER_GENERATE" }), created: true }), {
          status: 202,
        });
      }
      return new Response(JSON.stringify(state({ reportRuns: [reportRun("CUSTOMER", "SUCCEEDED"), reportRun("PRO", "QUEUED", { attemptCount: 0 })] })), {
        status: 200,
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReportsPanel", () => {
  it("explains that Analyze comes first when there is no accepted Study", () => {
    render(<ReportsPanel hiveId={HIVE_ID} initial={state({ studyRevision: null, reportRuns: [], latest: [], history: [] })} />);
    expect(screen.getByTestId("reports-empty").textContent).toContain("Analyze your documents");
  });

  it("renders the Customer report with sources and value statuses", () => {
    render(<ReportsPanel hiveId={HIVE_ID} initial={state()} />);
    const view = screen.getByTestId("report-view");
    expect(within(view).getByRole("heading", { level: 2 }).textContent).toBe("Maya's reading and services");
    expect(view.querySelector('[data-component="Metric"]')?.textContent).toContain("Verified");
    expect(within(view).getAllByLabelText("Sources").length).toBeGreaterThan(0);
    expect(view.textContent).toContain("Speech service log.xlsx p.1");
    expect(screen.getByTestId("reports-limitations").textContent).toContain("Pages with no text: 2.");
  });

  it("keeps a failed Pro Writer separate and regenerates only that report", async () => {
    render(<ReportsPanel hiveId={HIVE_ID} initial={state()} />);
    fireEvent.click(screen.getByRole("link", { name: "Pro" }));
    expect(window.location.search).toBe("?audience=pro");
    expect(screen.getByRole("link", { name: "Pro" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("report-run-status").textContent).toContain("Your study is safe");
    expect(screen.queryByTestId("report-view")).toBeNull();

    fireEvent.click(screen.getByTestId("generate-again"));
    await vi.waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url) === REPORTS_URL && init?.method === "POST")).toBe(true),
    );
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ studyRevisionId: REVISION_ID, audience: "PRO" });
    await screen.findByText("Writing this report from your study…");
  });

  it("renders a study-view report in the branded layout with the audience switch and Generate again in its header", () => {
    const fixture = bankruptcyC13Fixture("PRO");
    const pro: HiveReport = {
      id: "eeeeeeee-0000-4000-8000-000000000002",
      reportRunId: "cccccccc-0000-4000-8000-000000000002",
      studyRevisionId: REVISION_ID,
      revisionNumber: 1,
      audience: "PRO",
      title: fixture.title,
      createdAt: fixture.writtenAt,
      view: fixture.view,
      studyViewSources: fixture.sources,
      modelAlias: null,
    };
    render(
      <ReportsPanel
        hiveId={HIVE_ID}
        initialAudience="PRO"
        documentPages={fixture.documentPages}
        initial={state({ reportRuns: [reportRun("PRO", "SUCCEEDED", { reportId: pro.id })], latest: [pro], history: [pro] })}
      />,
    );
    const header = screen.getByTestId("report-header");
    expect(within(header).getByRole("link", { name: "Pro" }).getAttribute("aria-current")).toBe("page");
    expect(within(header).getByTestId("generate-again")).toBeTruthy();
    expect(header.textContent).toContain("Pro report · From study revision 1");
    expect(screen.getAllByTestId("comparison-card")).toHaveLength(2);
    expect(screen.queryByTestId("see-details")).toBeNull();
  });
});

describe("A2uiView", () => {
  it("recomputes a scenario from changed assumptions only, in trusted code", () => {
    render(<A2uiView view={report("CUSTOMER", "eeeeeeee-0000-4000-8000-000000000001").view} />);
    const scenario = document.querySelector('[data-component="ScenarioExplorer"]') as HTMLElement;
    const results = within(scenario).getByRole("list", { name: "Results" });
    expect(results.textContent).toContain("120 minutes");
    expect(results.textContent).toContain("15 minutes");

    expect((within(scenario).getByLabelText(/Required minutes/) as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(within(scenario).getByLabelText(/Weeks left/), { target: { value: "4" } });
    expect(results.textContent).toContain("30 minutes");
    expect(results.textContent).toContain("uses assumptions");
  });

  it("shows a neutral fallback for a component outside the catalog", () => {
    const view = report("CUSTOMER", "eeeeeeee-0000-4000-8000-000000000001").view;
    render(<A2uiView view={{ ...view, components: [{ id: "x1", component: "Iframe" } as never, ...view.components.slice(0, 1)] }} />);
    expect(document.querySelector('[data-component="Fallback"]')?.textContent).toContain("can't be shown");
    expect(document.querySelectorAll('[data-component="Narrative"]').length).toBe(1);
  });

  it("distinguishes source-backed facts from general-knowledge assessments and never quotes model-written fact statements", () => {
    const draft = mayaWriterOutput("PRO");
    draft.view.push({
      component: "EvidencePanel",
      props: { title: "Evidence and assessments", claimIds: ["P1.A0", "P1.F0"] },
    } as never);
    const built = buildReport(draft, {
      audience: "PRO",
      claims: claims(),
      fileNames: new Map(Object.entries(MAYA_FILE_NAMES)),
    });
    if (!built.ok) throw new Error(built.message);

    render(<A2uiView view={built.value.view} />);
    expect(screen.getAllByText("Interpretation · General-knowledge criterion").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Criterion: Compare the latest measurement with the baseline and the goal.").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Source-backed fact").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("General information")).toBeTruthy();

    const quotes = Array.from(document.querySelectorAll("q")).map((node) => node.textContent);
    expect(quotes).toContain("Baseline: 62 words correct per minute.");
    expect(quotes).not.toContain("The baseline was 62 words correct per minute.");
  });

  it("compiles and renders L001 37-DF PRO RecordTable, Comparison, Timeline, Metric, and EvidencePanel through existing binders (V4-004K.4)", () => {
    const l001Corpus = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const studyLedger = new StudyAgentLedger({
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS,
      pages: l001Corpus,
    });
    for (const turn of l001InitialIepStudyAgentTurns()) {
      for (const call of turn) {
        const res = studyLedger.execute(call);
        if (!res.ok) throw new Error(res.content);
      }
    }
    const verified = verifyStudyInvestigation(studyLedger.assemble(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: [...L001_INITIAL_IEP_PLAN_QUESTION_IDS],
      pages: new Map(Object.entries(L001_INITIAL_IEP_PAGES)),
    });
    if (!verified.ok) throw new Error(verified.message);
    const l001Claims = studyClaimCatalog(verified.value);
    const canonicalFindings = resolveCanonicalFindings(verified.value, l001Claims, { asOf: "2026-11-04" });
    const fileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));

    const compiled = compileEditorialPlan(l001ProEditorialPlan(), {
      reportRunId: "cccccccc-0000-4000-8000-000000000099",
      claims: l001Claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const built = buildReport(compiled.writerReport, {
      audience: "PRO",
      claims: l001Claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    render(<A2uiView view={built.value.view} />);
    expect(document.querySelector('[data-component="Metric"]')?.textContent).toContain("33 WCPM");
    expect(document.querySelector('[data-component="Comparison"]')?.textContent).toContain("42 WCPM");
    expect(document.querySelector('[data-component="Comparison"]')?.textContent).toContain("75 WCPM");
    expect(document.querySelector('[data-component="Comparison"]')?.textContent).toContain("86%");
    expect(document.querySelector('[data-component="Comparison"]')?.textContent).toContain("at least 95% accuracy");
    expect(document.querySelector('[data-component="RecordTable"]')?.textContent).toContain("Specific Learning Disability (SLD) - Reading");
    expect(document.querySelector('[data-component="RecordTable"]')?.textContent).toContain("150 minutes");
    expect(document.querySelector('[data-component="RecordTable"]')?.textContent).toContain("Parent/Guardian");
    expect(document.querySelector('[data-component="Timeline"]')?.textContent).toContain("2024-10-18");
    expect(document.querySelector('[data-component="Timeline"]')?.textContent).toContain("2024-11-01");
    expect(document.querySelector('[data-component="Timeline"]')?.textContent).toContain("2024-11-12");
    expect(document.querySelector('[data-component="Timeline"]')?.textContent).toContain("2025-11-11");
    expect(document.querySelector('[data-component="EvidencePanel"]')?.textContent).toContain("Interpretation · Document criterion");
    expect(document.querySelector('[data-component="EvidencePanel"]')?.textContent).toContain("Reserved determination");
    expect(document.querySelector('[data-component="SourceReferences"]')?.textContent).toContain("08_initial_iep.pdf");
  });
});
