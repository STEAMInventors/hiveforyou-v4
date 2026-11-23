import type {
  ApplicationView,
  ApplicationViewReport,
  GetHiveReportsResponse,
  StudyView,
  StudyViewSources,
} from "@hiveforyou/contracts";
import { APPLICATION_VIEW_SCHEMA } from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHiveReportMock } = vi.hoisted(() => ({
  getHiveReportMock: vi.fn(),
}));

vi.mock("@/server/reports/reports", () => ({
  getHiveReports: vi.fn(),
  getHiveReport: (...args: unknown[]) => getHiveReportMock(...args),
}));

import {
  authorizedSourceDocumentIds,
  latestStudyView,
  loadWorkspaceTimeline,
  workspaceStudyView,
  type HiveOverview,
} from "./hive-summary";

const minimalView = { schema: "hive.study-view/1", sections: [], blocks: [], components: [] } as StudyView;
const minimalSources = { documents: {}, facts: {} } as StudyViewSources;

describe("workspaceStudyView", () => {
  it("prefers the canonical study tab over a pinned report view", () => {
    const overview = {
      studyTab: { view: minimalView, sources: minimalSources },
      studyView: {
        view: { ...minimalView, sections: [{ title: "from-report" }] },
        studyViewSources: minimalSources,
      },
    } as unknown as HiveOverview;
    const result = workspaceStudyView(overview);
    expect(result.view).toBe(minimalView);
  });

  it("falls back to the latest report study view for investigation-1 revisions", () => {
    const reportView = { ...minimalView, sections: [{ title: "timeline" }] } as StudyView;
    const overview = {
      studyTab: null,
      studyView: { view: reportView, studyViewSources: minimalSources },
    } as unknown as HiveOverview;
    expect(workspaceStudyView(overview).view).toBe(reportView);
  });

  it("does not substitute an older report when canonical tab view is present", () => {
    const canonicalView = { ...minimalView, sections: [{ title: "revision-8" }] } as StudyView;
    const staleReportView = { ...minimalView, sections: [{ title: "revision-6-report" }] } as StudyView;
    const overview = {
      studyTab: { view: canonicalView, sources: minimalSources },
      studyView: { view: staleReportView, studyViewSources: minimalSources },
    } as unknown as HiveOverview;
    expect(workspaceStudyView(overview).view).toBe(canonicalView);
  });
});

describe("latestStudyView", () => {
  it("ignores investigation-1 application-view reports (Maya v6 Timeline has no study-view fallback)", () => {
    const appView: ApplicationView = {
      schema: APPLICATION_VIEW_SCHEMA,
      audience: "CUSTOMER",
      layout: "PROPOSED",
      components: [
        {
          component: "Timeline",
          title: "Key dates",
          events: [{ date: "March 4, 2025", text: "Goal set", refs: [] }],
        },
      ],
    };
    const reports = {
      studyRevision: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revisionNumber: 6, format: "investigation-1" },
      reportRuns: [],
      latest: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          reportRunId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          revisionNumber: 6,
          audience: "CUSTOMER",
          title: "Maya review",
          createdAt: "2026-11-02T00:00:00.000Z",
          view: appView,
          scenarioAnalysis: { schema: "hive.scenario-analysis/1", scenarios: [] },
          modelAlias: null,
        },
      ],
      history: [],
    } as unknown as GetHiveReportsResponse;
    expect(latestStudyView(reports)).toBeNull();
    const overview = { studyTab: null, studyView: null } as unknown as HiveOverview;
    expect(workspaceStudyView(overview).view).toBeNull();
  });

  it("uses latest per-audience reports from get_hive_reports (current revision only on server)", () => {
    const reports = {
      studyRevision: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revisionNumber: 6, format: "canonical-study-1" },
      reportRuns: [],
      latest: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          reportRunId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          revisionNumber: 6,
          audience: "PRO",
          title: "Pro",
          createdAt: "2026-11-02T00:00:00.000Z",
          view: { ...minimalView, intent: "pro-report" },
          studyViewSources: minimalSources,
          modelAlias: null,
        },
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          reportRunId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          revisionNumber: 6,
          audience: "CUSTOMER",
          title: "Customer",
          createdAt: "2026-11-02T00:00:00.000Z",
          view: { ...minimalView, intent: "customer-report" },
          studyViewSources: minimalSources,
          modelAlias: null,
        },
      ],
      history: [],
    } as unknown as GetHiveReportsResponse;
    expect(latestStudyView(reports)?.view.intent).toBe("customer-report");
  });
});

describe("loadWorkspaceTimeline (P0.5-A)", () => {
  const HIVE_ID = "11111111-1111-4111-8111-111111111111";
  const CORRELATION_ID = "22222222-2222-4222-8222-222222222222";
  const REV_5 = "55555555-5555-4555-8555-555555555555";
  const REV_6 = "66666666-6666-4666-8666-666666666666";
  const RUN_6 = "66666666-0000-4000-8000-000000000006";
  const RUN_7_FAILED = "77777777-0000-4000-8000-000000000007";
  const DOC_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const DOC_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const DOC_UNAUTH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const FAKE_CLIENT = { rpc: vi.fn() } as unknown as SupabaseClient;

  function makeLegacyReport(input: {
    id: string;
    studyRevisionId: string;
    revisionNumber: number;
    audience: "CUSTOMER" | "PRO";
    title: string;
    createdAt: string;
    components: ApplicationView["components"];
  }): ApplicationViewReport {
    return {
      id: input.id,
      reportRunId: "99999999-9999-4999-8999-999999999999",
      studyRevisionId: input.studyRevisionId,
      revisionNumber: input.revisionNumber,
      audience: input.audience,
      title: input.title,
      createdAt: input.createdAt,
      view: {
        schema: APPLICATION_VIEW_SCHEMA,
        audience: input.audience,
        title: input.title,
        layout: "PROPOSED",
        components: input.components,
      },
      scenarioAnalysis: { schema: "hive.scenario-analysis/1", scenarios: [] },
      modelAlias: null,
    };
  }

  beforeEach(() => {
    getHiveReportMock.mockReset();
  });

  it("restores Maya v6's 8 historical Pro timeline events via authenticated getHiveReport for the same revision only", async () => {
    const latestCustomer = makeLegacyReport({
      id: "c0000000-0000-4000-8000-000000000001",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "CUSTOMER",
      title: "Maya Customer Latest",
      createdAt: "2026-11-03T12:00:00.000Z",
      components: [{ id: "n1", component: "Narrative", heading: "Summary", blocks: [] }],
    });
    const latestPro = makeLegacyReport({
      id: "c0000000-0000-4000-8000-000000000002",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Pro Latest",
      createdAt: "2026-11-03T11:00:00.000Z",
      components: [{ id: "n2", component: "Narrative", heading: "Summary", blocks: [] }],
    });
    const earlierV6Pro = makeLegacyReport({
      id: "c0000000-0000-4000-8000-000000000003",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Advocate Brief",
      createdAt: "2026-11-02T09:00:00.000Z",
      components: [
        {
          id: "tl-maya",
          component: "Timeline",
          title: "Chronology",
          events: Array.from({ length: 8 }, (_, idx) => ({
            date: `2025-0${idx + 1}-10`,
            text: `Maya event ${idx + 1}`,
            refs: [{ sourceDocumentId: idx % 2 === 0 ? DOC_1 : DOC_2, pageNumber: idx < 4 ? 1 : 2, fileName: "Maya.pdf" }],
          })),
        },
      ],
    });
    const v5ReportSummary = {
      id: "c0000000-0000-4000-8000-000000000004",
      reportRunId: "99999999-9999-4999-8999-999999999999",
      studyRevisionId: REV_5,
      revisionNumber: 5,
      audience: "PRO" as const,
      title: "Study v5 Pro",
      createdAt: "2026-11-03T13:00:00.000Z",
    };

    getHiveReportMock.mockResolvedValue({ report: earlierV6Pro });

    const overview = {
      preparation: {
        studyRevision: { id: REV_6, revisionNumber: 6, processingRunId: RUN_6, format: "investigation-1" },
        processingRun: { id: RUN_6, authorizedSourceDocumentIds: [DOC_1, DOC_2] },
        eligibility: {
          documents: [
            { sourceDocumentId: DOC_1, fileName: "Anchor_Plan.pdf", totalPhysicalPages: 5 },
            { sourceDocumentId: DOC_2, fileName: "Eval.pdf", totalPhysicalPages: 4 },
          ],
          excluded: [],
        },
      },
      reports: {
        studyRevision: { id: REV_6, revisionNumber: 6, format: "investigation-1" },
        reportRuns: [],
        latest: [latestCustomer, latestPro],
        history: [
          v5ReportSummary,
          { ...latestCustomer },
          { ...latestPro },
          {
            id: earlierV6Pro.id,
            reportRunId: earlierV6Pro.reportRunId,
            studyRevisionId: earlierV6Pro.studyRevisionId,
            revisionNumber: earlierV6Pro.revisionNumber,
            audience: earlierV6Pro.audience,
            title: earlierV6Pro.title,
            createdAt: earlierV6Pro.createdAt,
          },
        ],
      },
      studyTab: null,
      studyView: null,
    } as unknown as HiveOverview;

    const resolved = await loadWorkspaceTimeline(FAKE_CLIENT, {
      hiveId: HIVE_ID,
      overview,
      correlationId: CORRELATION_ID,
    });

    expect(resolved.source).toBe("historical_report");
    expect(resolved.rows).toHaveLength(8);
    expect(resolved.report).toEqual({
      reportId: earlierV6Pro.id,
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Advocate Brief",
      createdAt: "2026-11-02T09:00:00.000Z",
      fromHistory: true,
    });
    expect(getHiveReportMock).toHaveBeenCalledTimes(1);
    expect(getHiveReportMock).toHaveBeenCalledWith(FAKE_CLIENT, {
      hiveId: HIVE_ID,
      reportId: earlierV6Pro.id,
      correlationId: CORRELATION_ID,
    });
  });

  it("does not call getHiveReport when canonical study-view exists or latest Pro has Timeline", async () => {
    const canonicalOverview = {
      preparation: {
        studyRevision: { id: REV_6, revisionNumber: 6, processingRunId: RUN_6, format: "canonical-study-1" },
        processingRun: null,
        eligibility: { documents: [{ sourceDocumentId: DOC_1, fileName: "Anchor_Plan.pdf", totalPhysicalPages: 5 }], excluded: [] },
      },
      reports: {
        studyRevision: { id: REV_6, revisionNumber: 6, format: "canonical-study-1" },
        reportRuns: [],
        latest: [],
        history: [
          {
            id: "c0000000-0000-4000-8000-000000000010",
            reportRunId: "99999999-9999-4999-8999-999999999999",
            studyRevisionId: REV_6,
            revisionNumber: 6,
            audience: "PRO",
            title: "Earlier Pro",
            createdAt: "2026-11-02T09:00:00.000Z",
          },
        ],
      },
      studyTab: { view: minimalView, sources: minimalSources },
      studyView: null,
    } as unknown as HiveOverview;

    const canonicalResult = await loadWorkspaceTimeline(FAKE_CLIENT, {
      hiveId: HIVE_ID,
      overview: canonicalOverview,
      correlationId: CORRELATION_ID,
    });
    expect(canonicalResult.source).toBe("canonical");
    expect(getHiveReportMock).not.toHaveBeenCalled();

    const latestCustomerNoTimeline = makeLegacyReport({
      id: "c0000000-0000-4000-8000-000000000011",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "CUSTOMER",
      title: "Customer",
      createdAt: "2026-11-03T12:00:00.000Z",
      components: [{ id: "n1", component: "Narrative", heading: "Summary", blocks: [] }],
    });
    const latestProWithTimeline = makeLegacyReport({
      id: "c0000000-0000-4000-8000-000000000012",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Pro Latest",
      createdAt: "2026-11-03T11:00:00.000Z",
      components: [
        {
          id: "tl-pro",
          component: "Timeline",
          title: "Dates",
          events: [{ date: "2025-03-04", text: "Goal set", refs: [{ sourceDocumentId: DOC_1, pageNumber: 2, fileName: "Anchor_Plan.pdf" }] }],
        },
      ],
    });
    const latestProResult = await loadWorkspaceTimeline(FAKE_CLIENT, {
      hiveId: HIVE_ID,
      overview: {
        ...canonicalOverview,
        studyTab: null,
        reports: {
          ...canonicalOverview.reports!,
          latest: [latestCustomerNoTimeline, latestProWithTimeline],
        },
      },
      correlationId: CORRELATION_ID,
    });
    expect(latestProResult.source).toBe("latest_report");
    expect(latestProResult.report?.fromHistory).toBe(false);
    expect(latestProResult.rows).toHaveLength(1);
    expect(getHiveReportMock).not.toHaveBeenCalled();
  });

  it("stops probing history immediately on authorization failure and ignores mismatched processingRun document filters", async () => {
    const prepWithFailedNewerRun = {
      studyRevision: { id: REV_6, revisionNumber: 6, processingRunId: RUN_6, format: "investigation-1" },
      processingRun: { id: RUN_7_FAILED, authorizedSourceDocumentIds: [DOC_UNAUTH] },
      eligibility: {
        documents: [{ sourceDocumentId: DOC_1, fileName: "Anchor_Plan.pdf", totalPhysicalPages: 3 }],
        excluded: [],
      },
    };
    expect(authorizedSourceDocumentIds(prepWithFailedNewerRun as never)).toEqual([DOC_1]);

    getHiveReportMock.mockRejectedValue({ errorCode: "UNAUTHENTICATED", diagnosticReason: "no_session" });
    const overview = {
      preparation: prepWithFailedNewerRun,
      reports: {
        studyRevision: { id: REV_6, revisionNumber: 6, format: "investigation-1" },
        reportRuns: [],
        latest: [],
        history: [
          {
            id: "c0000000-0000-4000-8000-000000000021",
            reportRunId: "99999999-9999-4999-8999-999999999999",
            studyRevisionId: REV_6,
            revisionNumber: 6,
            audience: "PRO",
            title: "First",
            createdAt: "2026-11-02T12:00:00.000Z",
          },
          {
            id: "c0000000-0000-4000-8000-000000000022",
            reportRunId: "99999999-9999-4999-8999-999999999999",
            studyRevisionId: REV_6,
            revisionNumber: 6,
            audience: "PRO",
            title: "Second",
            createdAt: "2026-11-02T10:00:00.000Z",
          },
        ],
      },
      studyTab: null,
      studyView: null,
    } as unknown as HiveOverview;

    const resolved = await loadWorkspaceTimeline(FAKE_CLIENT, {
      hiveId: HIVE_ID,
      overview,
      correlationId: CORRELATION_ID,
    });
    expect(resolved).toEqual({ rows: [], source: "none", report: null });
    expect(getHiveReportMock).toHaveBeenCalledTimes(1);
  });
});