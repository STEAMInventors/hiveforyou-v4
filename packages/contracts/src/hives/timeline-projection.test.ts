import { describe, expect, it } from "vitest";

import { APPLICATION_VIEW_SCHEMA } from "../reports/application-view-contracts";
import type { ApplicationView } from "../reports/application-view-contracts";
import type { GetHiveReportsResponse } from "../reports/report-contracts";
import { STUDY_VIEW_SCHEMA, type StudyView, type StudyViewRow } from "../pipeline/study-view-contracts";
import {
  projectApplicationViewTimeline,
  resolveWorkspaceTimelineRows,
} from "./timeline-projection";

const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function appView(components: ApplicationView["components"]): ApplicationView {
  return {
    schema: APPLICATION_VIEW_SCHEMA,
    audience: "CUSTOMER",
    title: "Saved report",
    layout: "PROPOSED",
    components,
  };
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