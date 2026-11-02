// @vitest-environment jsdom
import {
  buildReport,
  type GetHiveReportsResponse,
  type HiveReport,
  type ReportAudience,
  type ReportRun,
  studyClaimCatalog,
  verifyStudyInvestigation,
} from "@hiveforyou/contracts";
import {
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
    fireEvent.click(screen.getByRole("tab", { name: "Pro" }));
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
});
