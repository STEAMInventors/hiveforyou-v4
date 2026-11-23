import { describe, expect, it, vi } from "vitest";

import { APPLICATION_VIEW_SCHEMA } from "../reports/application-view-contracts";
import type { ApplicationView, BoundRef } from "../reports/application-view-contracts";
import type { ApplicationViewReport, GetHiveReportsResponse, HiveReport, ReportSummary } from "../reports/report-contracts";
import { STUDY_VIEW_SCHEMA, type StudyView, type StudyViewRow } from "../pipeline/study-view-contracts";
import {
  projectApplicationViewTimeline,
  resolveWorkspaceTimeline,
  resolveWorkspaceTimelineRows,
  resolveWorkspaceTimelineWithHistory,
  selectSameRevisionHistoricalReportCandidates,
} from "./timeline-projection";

const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOC_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DOC_UNAUTH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const REV_5 = "55555555-5555-4555-8555-555555555555";
const REV_6 = "66666666-6666-4666-8666-666666666666";
const REV_7 = "77777777-7777-4777-8777-777777777777";

function appView(
  components: ApplicationView["components"],
  audience: ApplicationView["audience"] = "CUSTOMER",
  title = "Saved report",
): ApplicationView {
  return {
    schema: APPLICATION_VIEW_SCHEMA,
    audience,
    title,
    layout: "PROPOSED",
    components,
  };
}

function makeAppReport(overrides: {
  id: string;
  studyRevisionId: string;
  revisionNumber: number;
  audience: "CUSTOMER" | "PRO";
  title: string;
  createdAt: string;
  components: ApplicationView["components"];
}): ApplicationViewReport {
  return {
    id: overrides.id,
    reportRunId: "99999999-9999-4999-8999-999999999999",
    studyRevisionId: overrides.studyRevisionId,
    revisionNumber: overrides.revisionNumber,
    audience: overrides.audience,
    title: overrides.title,
    createdAt: overrides.createdAt,
    view: appView(overrides.components, overrides.audience, overrides.title),
    scenarioAnalysis: { schema: "hive.scenario-analysis/1", scenarios: [] },
    modelAlias: null,
  };
}

function toSummary(report: HiveReport): ReportSummary {
  return {
    id: report.id,
    reportRunId: report.reportRunId,
    studyRevisionId: report.studyRevisionId,
    revisionNumber: report.revisionNumber,
    audience: report.audience,
    title: report.title,
    createdAt: report.createdAt,
  };
}

function mayaV6EightTimelineEvents(): { date: string; text: string; refs: BoundRef[] }[] {
  return [
    { date: "2024-09-12", text: "Initial parent referral for reading review", refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "Referral_Letter.pdf" }] },
    { date: "2024-10-18", text: "Signed review consent received", refs: [{ sourceDocumentId: DOC_A, pageNumber: 2, fileName: "Referral_Letter.pdf" }] },
    { date: "2024-12-03", text: "Baseline testing completed", refs: [{ sourceDocumentId: DOC_B, pageNumber: 3, fileName: "Testing_Report.pdf" }] },
    { date: "2025-01-15", text: "Eligibility determination meeting held", refs: [{ sourceDocumentId: DOC_B, pageNumber: 5, fileName: "Testing_Report.pdf" }] },
    { date: "March 4, 2025", text: "Annual reading fluency goal set at 90 words per minute", refs: [{ sourceDocumentId: DOC_C, pageNumber: 4, fileName: "Annual_Plan_2025.pdf" }] },
    { date: "2025-06-10", text: "End-of-year progress report recorded 68 words per minute", refs: [{ sourceDocumentId: DOC_C, pageNumber: 7, fileName: "Annual_Plan_2025.pdf" }] },
    { date: "2025-11-15", text: "Fall progress check recorded 74 words per minute", refs: [{ sourceDocumentId: DOC_C, pageNumber: 9, fileName: "Annual_Plan_2025.pdf" }] },
    { date: "2026-03-04", text: "Annual plan review due date", refs: [{ sourceDocumentId: DOC_C, pageNumber: 1, fileName: "Annual_Plan_2025.pdf" }] },
  ];
}

function studyViewTimeline(rows: StudyViewRow[]): StudyView {
  return {
    schema: STUDY_VIEW_SCHEMA,
    sections: [],
    blocks: [{ name: "timeline", rows }],
    components: [],
  };
}

describe("projectApplicationViewTimeline (P0.4-A)", () => {
  it("projects bound Timeline events with resolvable refs and valid dates", () => {
    const view = appView([
      {
        id: "tl-1",
        component: "Timeline",
        title: "Key dates",
        events: [
          {
            date: "March 4, 2025",
            text: "Goal set",
            refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "Anchor plan.pdf" }],
          },
          {
            date: "2025-11-15",
            text: "Progress measured",
            refs: [{ sourceDocumentId: DOC_B, pageNumber: 2, fileName: "Progress.pdf" }],
          },
        ],
      },
    ]);
    const rows = projectApplicationViewTimeline(view);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2025-03-04", statement: "Goal set" });
    expect(rows[1]).toMatchObject({ date: "2025-11-15", statement: "Progress measured" });
    expect(rows[0]!.values[0]?.sourceRef).toMatchObject({ sourceDocumentId: DOC_A, pageNumber: 1 });
  });

  it("returns empty when the saved report has no Timeline components", () => {
    const view = appView([
      {
        id: "n1",
        component: "Narrative",
        heading: "Summary",
        blocks: [
          {
            type: "DOCUMENTED",
            text: "Meeting on March 3, 2026.",
            claimIds: [],
            refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "Anchor plan.pdf" }],
          },
        ],
      },
    ]);
    expect(projectApplicationViewTimeline(view)).toEqual([]);
  });

  it("drops events with missing refs, invalid dates, or empty text", () => {
    const view = appView([
      {
        id: "tl-bad",
        component: "Timeline",
        title: "Mixed",
        events: [
          { date: "November 2025", text: "Month only", refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "a.pdf" }] },
          { date: "March 4, 2025", text: "Good", refs: [] },
          { date: "March 5, 2025", text: "   ", refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "a.pdf" }] },
          {
            date: "March 6, 2025",
            text: "Bad page",
            refs: [{ sourceDocumentId: DOC_A, pageNumber: 0, fileName: "a.pdf" }],
          },
          {
            date: "March 7, 2025",
            text: "Kept",
            refs: [{ sourceDocumentId: DOC_A, pageNumber: 3, fileName: "a.pdf" }],
          },
        ],
      },
    ]);
    const rows = projectApplicationViewTimeline(view);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2025-03-07", statement: "Kept" });
  });
});

describe("resolveWorkspaceTimelineRows (P0.4-A)", () => {
  it("prefers canonical study-view timeline rows over saved application-view Timelines", () => {
    const canonical = studyViewTimeline([
      {
        id: "T1",
        date: "2026-01-01",
        asWritten: "Jan 1, 2026",
        statement: "From canonical study",
        values: [],
      },
    ]);
    const reportView = appView([
      {
        id: "tl-report",
        component: "Timeline",
        title: "Report",
        events: [
          {
            date: "March 4, 2025",
            text: "From report only",
            refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "Anchor plan.pdf" }],
          },
        ],
      },
    ]);
    const reports = {
      latest: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          reportRunId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          studyRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          revisionNumber: 8,
          audience: "CUSTOMER",
          title: "Customer",
          createdAt: "2026-11-02T00:00:00.000Z",
          view: reportView,
          scenarioAnalysis: { schema: "hive.scenario-analysis/1", scenarios: [] },
          modelAlias: null,
        },
      ],
    } as unknown as GetHiveReportsResponse;
    const rows = resolveWorkspaceTimelineRows({ studyView: canonical, reports: reports.latest });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statement).toBe("From canonical study");
  });

  it("keeps an empty canonical timeline instead of backfilling from legacy reports", () => {
    const canonical = studyViewTimeline([]);
    const reportView = appView([
      {
        id: "tl-report",
        component: "Timeline",
        title: "Report",
        events: [
          {
            date: "March 4, 2025",
            text: "Would backfill",
            refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "Anchor plan.pdf" }],
          },
        ],
      },
    ]);
    const reports = {
      latest: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          reportRunId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          studyRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          revisionNumber: 8,
          audience: "CUSTOMER",
          title: "Customer",
          createdAt: "2026-11-02T00:00:00.000Z",
          view: reportView,
          scenarioAnalysis: { schema: "hive.scenario-analysis/1", scenarios: [] },
          modelAlias: null,
        },
      ],
    } as unknown as GetHiveReportsResponse;
    expect(resolveWorkspaceTimelineRows({ studyView: canonical, reports: reports.latest })).toEqual([]);
  });

  it("projects from Customer application-view when no study view is available (legacy investigation)", () => {
    const reportView = appView([
      {
        id: "tl-legacy",
        component: "Timeline",
        title: "Dates",
        events: [
          {
            date: "March 4, 2025",
            text: "Goal set",
            refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "Anchor plan.pdf" }],
          },
        ],
      },
    ]);
    const reports = {
      latest: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          reportRunId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          studyRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          revisionNumber: 6,
          audience: "CUSTOMER",
          title: "Customer",
          createdAt: "2026-11-02T00:00:00.000Z",
          view: reportView,
          scenarioAnalysis: { schema: "hive.scenario-analysis/1", scenarios: [] },
          modelAlias: null,
        },
      ],
    } as unknown as GetHiveReportsResponse;
    const rows = resolveWorkspaceTimelineRows({ studyView: null, reports: reports.latest });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2025-03-04", statement: "Goal set" });
  });

  it("drops timeline refs that are not authorized hive source documents", () => {
    const reportView = appView([
      {
        id: "tl-mixed",
        component: "Timeline",
        title: "Dates",
        events: [
          {
            date: "March 4, 2025",
            text: "Authorized",
            refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "Anchor plan.pdf" }],
          },
          {
            date: "March 5, 2025",
            text: "Forged uuid",
            refs: [{ sourceDocumentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", pageNumber: 1, fileName: "x.pdf" }],
          },
        ],
      },
    ]);
    const rows = projectApplicationViewTimeline(reportView, { authorizedSourceDocumentIds: [DOC_A] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ statement: "Authorized" });
  });

  it("Maya Study v6 Customer report has no Timeline component → empty projection", () => {
    const reportView = appView([
      { id: "n1", component: "Narrative", heading: "Summary", blocks: [] },
    ]);
    const reports = {
      latest: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          reportRunId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          revisionNumber: 6,
          audience: "CUSTOMER",
          title: "Maya",
          createdAt: "2026-11-02T00:00:00.000Z",
          view: reportView,
          scenarioAnalysis: { schema: "hive.scenario-analysis/1", scenarios: [] },
          modelAlias: null,
        },
      ],
    } as unknown as GetHiveReportsResponse;
    expect(resolveWorkspaceTimelineRows({ studyView: null, reports: reports.latest })).toEqual([]);
  });
});

describe("P0.5-A historical Timeline restoration", () => {
  it("falls back to latest Pro when latest Customer has no Timeline component", () => {
    const latestCustomer = makeAppReport({
      id: "10000000-0000-4000-8000-000000000001",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "CUSTOMER",
      title: "Maya Family Summary",
      createdAt: "2026-11-03T12:00:00.000Z",
      components: [{ id: "n1", component: "Narrative", heading: "Summary", blocks: [] }],
    });
    const latestPro = makeAppReport({
      id: "10000000-0000-4000-8000-000000000002",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Pro Review",
      createdAt: "2026-11-03T11:00:00.000Z",
      components: [
        {
          id: "tl-pro",
          component: "Timeline",
          title: "Case chronology",
          events: [
            {
              date: "March 4, 2025",
              text: "Annual reading goal established",
              refs: [{ sourceDocumentId: DOC_A, pageNumber: 2, fileName: "Annual_Plan_2025.pdf" }],
            },
          ],
        },
      ],
    });

    const resolved = resolveWorkspaceTimeline({
      studyView: null,
      reports: [latestCustomer, latestPro],
      acceptedStudyRevisionId: REV_6,
      authorizedSourceDocumentIds: [DOC_A],
    });
    expect(resolved.source).toBe("latest_report");
    expect(resolved.rows).toHaveLength(1);
    expect(resolved.rows[0]).toMatchObject({ date: "2025-03-04", statement: "Annual reading goal established" });
    expect(resolved.report).toEqual({
      reportId: latestPro.id,
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Pro Review",
      createdAt: "2026-11-03T11:00:00.000Z",
      fromHistory: false,
    });
  });

  it("restores Maya v6's 8 events from the newest earlier Pro report for the SAME accepted Study v6", async () => {
    const latestCustomer = makeAppReport({
      id: "20000000-0000-4000-8000-000000000001",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "CUSTOMER",
      title: "Maya Family Report (Latest)",
      createdAt: "2026-11-03T14:00:00.000Z",
      components: [{ id: "n1", component: "Narrative", heading: "Summary", blocks: [] }],
    });
    const latestPro = makeAppReport({
      id: "20000000-0000-4000-8000-000000000002",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Pro Report (Latest)",
      createdAt: "2026-11-03T13:00:00.000Z",
      components: [{ id: "n2", component: "Narrative", heading: "Overview", blocks: [] }],
    });
    const historicalProWithEight = makeAppReport({
      id: "20000000-0000-4000-8000-000000000003",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Advocate Brief",
      createdAt: "2026-11-02T10:00:00.000Z",
      components: [
        {
          id: "tl-maya-v6",
          component: "Timeline",
          title: "Maya Case Timeline",
          events: mayaV6EightTimelineEvents(),
        },
      ],
    });
    const olderV6Report = makeAppReport({
      id: "20000000-0000-4000-8000-000000000004",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "CUSTOMER",
      title: "Earlier v6 draft",
      createdAt: "2026-11-01T08:00:00.000Z",
      components: [
        {
          id: "tl-old",
          component: "Timeline",
          title: "Old",
          events: [
            {
              date: "2024-01-01",
              text: "Should not be chosen over newer v6 Pro report",
              refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "Referral_Letter.pdf" }],
            },
          ],
        },
      ],
    });
    const v5Report = makeAppReport({
      id: "20000000-0000-4000-8000-000000000005",
      studyRevisionId: REV_5,
      revisionNumber: 5,
      audience: "PRO",
      title: "Study v5 Pro Report",
      createdAt: "2026-11-03T15:00:00.000Z",
      components: [
        {
          id: "tl-v5",
          component: "Timeline",
          title: "v5",
          events: [
            {
              date: "2025-05-05",
              text: "Cross-revision event",
              refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "Referral_Letter.pdf" }],
            },
          ],
        },
      ],
    });

    const reportsById = new Map<string, HiveReport>([
      [historicalProWithEight.id, historicalProWithEight],
      [olderV6Report.id, olderV6Report],
      [v5Report.id, v5Report],
    ]);
    const loadHistoricalReport = vi.fn(async (id: string) => reportsById.get(id) ?? null);
    const history = [
      toSummary(v5Report),
      toSummary(latestCustomer),
      toSummary(latestPro),
      toSummary(olderV6Report),
      toSummary(historicalProWithEight),
    ];
    const historySnapshot = structuredClone(history);

    const resolved = await resolveWorkspaceTimelineWithHistory({
      studyView: null,
      acceptedStudyRevisionId: REV_6,
      latest: [latestCustomer, latestPro],
      history,
      authorizedSourceDocumentIds: [DOC_A, DOC_B, DOC_C],
      authorizedDocumentPages: { [DOC_A]: 2, [DOC_B]: 5, [DOC_C]: 10 },
      loadHistoricalReport,
    });

    expect(resolved.source).toBe("historical_report");
    expect(resolved.rows).toHaveLength(8);
    expect(resolved.rows.map((r) => r.date)).toEqual([
      "2024-09-12",
      "2024-10-18",
      "2024-12-03",
      "2025-01-15",
      "2025-03-04",
      "2025-06-10",
      "2025-11-15",
      "2026-03-04",
    ]);
    expect(resolved.rows[4]).toMatchObject({
      date: "2025-03-04",
      asWritten: "March 4, 2025",
      statement: "Annual reading fluency goal set at 90 words per minute",
    });
    expect(resolved.rows[4]!.values[0]?.sourceRef).toEqual({
      sourceDocumentId: DOC_C,
      pageNumber: 4,
      quote: "",
    });
    expect(resolved.report).toEqual({
      reportId: historicalProWithEight.id,
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Advocate Brief",
      createdAt: "2026-11-02T10:00:00.000Z",
      fromHistory: true,
    });
    // Checked only the newest eligible same-revision report; never fetched v5 or older v6 report.
    expect(loadHistoricalReport).toHaveBeenCalledTimes(1);
    expect(loadHistoricalReport).toHaveBeenCalledWith(historicalProWithEight.id);
    // History array was not mutated.
    expect(history).toEqual(historySnapshot);
  });

  it("canonical study-view takes strict precedence and never loads historical reports (even if empty)", async () => {
    const loadHistoricalReport = vi.fn(async () => null);
    const canonicalEmpty = studyViewTimeline([]);
    const history: ReportSummary[] = [
      {
        id: "30000000-0000-4000-8000-000000000001",
        reportRunId: "99999999-9999-4999-8999-999999999999",
        studyRevisionId: REV_6,
        revisionNumber: 6,
        audience: "PRO",
        title: "Historical Pro",
        createdAt: "2026-11-02T10:00:00.000Z",
      },
    ];

    const emptyCanonicalResult = await resolveWorkspaceTimelineWithHistory({
      studyView: canonicalEmpty,
      acceptedStudyRevisionId: REV_6,
      latest: [],
      history,
      loadHistoricalReport,
    });
    expect(emptyCanonicalResult).toEqual({ rows: [], source: "canonical", report: null });
    expect(loadHistoricalReport).not.toHaveBeenCalled();

    const canonicalPopulated = studyViewTimeline([
      { id: "T1", date: "2026-02-01", asWritten: "Feb 1, 2026", statement: "Canonical event", values: [] },
    ]);
    const populatedResult = await resolveWorkspaceTimelineWithHistory({
      studyView: canonicalPopulated,
      acceptedStudyRevisionId: REV_6,
      latest: [],
      history,
      loadHistoricalReport,
    });
    expect(populatedResult.source).toBe("canonical");
    expect(populatedResult.rows).toHaveLength(1);
    expect(populatedResult.rows[0]!.statement).toBe("Canonical event");
    expect(populatedResult.report).toBeNull();
    expect(loadHistoricalReport).not.toHaveBeenCalled();
  });

  it("rejects cross-revision reports in latest, history selection, and defense-in-depth loader results", async () => {
    const v5Report = makeAppReport({
      id: "40000000-0000-4000-8000-000000000001",
      studyRevisionId: REV_5,
      revisionNumber: 5,
      audience: "PRO",
      title: "Study v5 Pro",
      createdAt: "2026-11-01T10:00:00.000Z",
      components: [
        {
          id: "tl-v5",
          component: "Timeline",
          title: "v5 dates",
          events: [{ date: "2025-03-04", text: "From v5", refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "a.pdf" }] }],
        },
      ],
    });
    const v7Report = makeAppReport({
      id: "40000000-0000-4000-8000-000000000002",
      studyRevisionId: REV_7,
      revisionNumber: 7,
      audience: "CUSTOMER",
      title: "Study v7 Customer",
      createdAt: "2026-11-04T10:00:00.000Z",
      components: [
        {
          id: "tl-v7",
          component: "Timeline",
          title: "v7 dates",
          events: [{ date: "2025-04-04", text: "From v7", refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "a.pdf" }] }],
        },
      ],
    });

    // Candidate selection excludes v5 and v7 when accepted revision is v6.
    expect(
      selectSameRevisionHistoricalReportCandidates({
        acceptedStudyRevisionId: REV_6,
        latest: [],
        history: [toSummary(v5Report), toSummary(v7Report)],
      }),
    ).toEqual([]);

    // Even if `latest` contained a mismatched revision report, acceptedStudyRevisionId rejects it.
    const loadHistoricalReport = vi.fn(async () => v5Report);
    const resolved = await resolveWorkspaceTimelineWithHistory({
      studyView: null,
      acceptedStudyRevisionId: REV_6,
      latest: [v5Report],
      history: [toSummary(v5Report), toSummary(v7Report)],
      authorizedSourceDocumentIds: [DOC_A],
      loadHistoricalReport,
    });
    expect(resolved).toEqual({ rows: [], source: "none", report: null });
    expect(loadHistoricalReport).not.toHaveBeenCalled();

    // Defense-in-depth: if a loader returns a report whose studyRevisionId != acceptedStudyRevisionId, reject it.
    const spoofedSummary: ReportSummary = {
      id: "40000000-0000-4000-8000-000000000003",
      reportRunId: "99999999-9999-4999-8999-999999999999",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Spoofed summary",
      createdAt: "2026-11-02T10:00:00.000Z",
    };
    const tamperedLoader = vi.fn(async () => ({ ...v5Report, id: spoofedSummary.id }));
    const tamperedResult = await resolveWorkspaceTimelineWithHistory({
      studyView: null,
      acceptedStudyRevisionId: REV_6,
      latest: [],
      history: [spoofedSummary],
      authorizedSourceDocumentIds: [DOC_A],
      loadHistoricalReport: tamperedLoader,
    });
    expect(tamperedLoader).toHaveBeenCalledTimes(1);
    expect(tamperedResult).toEqual({ rows: [], source: "none", report: null });
  });

  it("drops invalid/unauthorized/out-of-range refs and skips historical reports with no valid events", async () => {
    const newerInvalidRefs = makeAppReport({
      id: "50000000-0000-4000-8000-000000000001",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Newer broken refs",
      createdAt: "2026-11-02T15:00:00.000Z",
      components: [
        {
          id: "tl-bad",
          component: "Timeline",
          title: "Broken",
          events: [
            { date: "2025-03-04", text: "Unauthorized doc", refs: [{ sourceDocumentId: DOC_UNAUTH, pageNumber: 1, fileName: "other.pdf" }] },
            { date: "2025-03-05", text: "Page past EOF", refs: [{ sourceDocumentId: DOC_A, pageNumber: 9, fileName: "a.pdf" }] },
            { date: "2025-03-06", text: "Zero page", refs: [{ sourceDocumentId: DOC_A, pageNumber: 0, fileName: "a.pdf" }] },
            { date: "March 2025", text: "Month-only date", refs: [{ sourceDocumentId: DOC_A, pageNumber: 1, fileName: "a.pdf" }] },
          ],
        },
      ],
    });
    const olderValid = makeAppReport({
      id: "50000000-0000-4000-8000-000000000002",
      studyRevisionId: REV_6,
      revisionNumber: 6,
      audience: "PRO",
      title: "Earlier valid Pro",
      createdAt: "2026-11-02T09:00:00.000Z",
      components: [
        {
          id: "tl-good",
          component: "Timeline",
          title: "Valid",
          events: [
            {
              date: "2025-03-04",
              text: "Mixed refs keep only authorized in-range page",
              refs: [
                { sourceDocumentId: DOC_UNAUTH, pageNumber: 1, fileName: "other.pdf" },
                { sourceDocumentId: DOC_A, pageNumber: 99, fileName: "a.pdf" },
                { sourceDocumentId: DOC_A, pageNumber: 2, fileName: "a.pdf" },
              ],
            },
          ],
        },
      ],
    });

    // Explicit empty authorizedSourceDocumentIds fails closed.
    expect(
      projectApplicationViewTimeline(olderValid.view, { authorizedSourceDocumentIds: [] }),
    ).toEqual([]);

    const byId = new Map<string, HiveReport>([
      [newerInvalidRefs.id, newerInvalidRefs],
      [olderValid.id, olderValid],
    ]);
    const loadHistoricalReport = vi.fn(async (id: string) => byId.get(id) ?? null);

    const resolved = await resolveWorkspaceTimelineWithHistory({
      studyView: null,
      acceptedStudyRevisionId: REV_6,
      latest: [],
      history: [toSummary(newerInvalidRefs), toSummary(olderValid)],
      authorizedSourceDocumentIds: [DOC_A],
      authorizedDocumentPages: { [DOC_A]: 3 },
      loadHistoricalReport,
    });

    expect(loadHistoricalReport.mock.calls.map((c) => c[0])).toEqual([newerInvalidRefs.id, olderValid.id]);
    expect(resolved.source).toBe("historical_report");
    expect(resolved.report?.reportId).toBe(olderValid.id);
    expect(resolved.rows).toHaveLength(1);
    expect(resolved.rows[0]!.values).toHaveLength(1);
    expect(resolved.rows[0]!.values[0]!.sourceRef).toEqual({
      sourceDocumentId: DOC_A,
      pageNumber: 2,
      quote: "",
    });
  });
});