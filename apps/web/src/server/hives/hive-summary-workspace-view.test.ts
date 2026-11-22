import type { ApplicationView, GetHiveReportsResponse, StudyView, StudyViewSources } from "@hiveforyou/contracts";
import { APPLICATION_VIEW_SCHEMA } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { latestStudyView, workspaceStudyView, type HiveOverview } from "./hive-summary";

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