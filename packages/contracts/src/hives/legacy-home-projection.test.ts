import { describe, expect, it } from "vitest";
import {
  APPLICATION_VIEW_SCHEMA,
  SCENARIO_ANALYSIS_SCHEMA,
  type ApplicationView,
  type ApplicationViewReport,
  type StudyView,
  EMPTY_LEGACY_HOME_PROJECTION,
  projectApplicationViewHome,
  resolveLegacyHomeProjection,
} from "../index";

const REV_6 = "11111111-1111-4111-8111-111111111116";
const REV_5 = "11111111-1111-4111-8111-111111111115";
const DOC_A = "22222222-2222-4222-8222-222222222221";
const DOC_B = "22222222-2222-4222-8222-222222222222";
const FOREIGN_DOC = "99999999-9999-4999-8999-999999999999";

function makeReport(overrides: Partial<ApplicationViewReport> & { view: ApplicationView }): ApplicationViewReport {
  return {
    id: "33333333-3333-4333-8333-333333333331",
    reportRunId: "55555555-5555-4555-8555-555555555551",
    studyRevisionId: REV_6,
    revisionNumber: 6,
    audience: "CUSTOMER",
    title: "Saved legacy review",
    createdAt: "2026-10-14T12:00:00Z",
    scenarioAnalysis: { schema: SCENARIO_ANALYSIS_SCHEMA, scenarios: [] },
    modelAlias: null,
    ...overrides,
  };
}

function makeMayaLegacyView(): ApplicationView {
  return {
    schema: APPLICATION_VIEW_SCHEMA,
    title: "Maya's Hive — Client Summary",
    audience: "CUSTOMER",
    layout: "PROPOSED",
    components: [
      {
        component: "KeyFindings",
        id: "kf-1",
        title: "Key findings",
        items: [
          {
            id: "cl-1",
            kind: "FACT",
            numericStatus: null,
            text: "2024 W-2 reports gross wages of $142,500.",
            refs: [
              { sourceDocumentId: DOC_A, fileName: "maya_2024_w2.pdf", pageNumber: 1 },
              { sourceDocumentId: DOC_A, fileName: "maya_2024_w2.pdf", pageNumber: 1 },
            ],
            quotes: ["Box 1 Wages, tips, other comp.: 142,500.00"],
          },
          {
            id: "cl-2",
            kind: "FACT",
            numericStatus: null,
            text: "Unsourced claim that must be dropped.",
            refs: [],
            quotes: [],
          },
        ],
      },
      {
        component: "Narrative",
        id: "narr-1",
        heading: "Income review",
        blocks: [
          {
            type: "DOCUMENTED",
            text: "2024 W-2 reports gross wages of $142,500.",
            claimIds: ["cl-1"],
            refs: [{ sourceDocumentId: DOC_A, fileName: "maya_2024_w2.pdf", pageNumber: 1 }],
          },
          {
            type: "UNCERTAINTY",
            text: "Schedule K-1 partner capital basis schedule is not attached.",
            claimIds: ["cl-3"],
            refs: [{ sourceDocumentId: DOC_B, fileName: "maya_2024_1040.pdf", pageNumber: 3 }],
          },
          {
            type: "NEXT_STEP",
            text: "Request the signed 2024 Schedule K-1 before filing.",
            claimIds: ["cl-4"],
            refs: [{ sourceDocumentId: DOC_B, fileName: "maya_2024_1040.pdf", pageNumber: 3 }],
          },
        ],
      },
      {
        component: "IssueList",
        id: "iss-1",
        title: "Open items",
        issues: [
          {
            severity: "HIGH",
            text: "Confirm federal tax withholding discrepancy between W-2 and return.",
            refs: [{ sourceDocumentId: DOC_B, fileName: "maya_2024_1040.pdf", pageNumber: 2 }],
          },
          {
            severity: "LOW",
            text: "Foreign document issue must be filtered out.",
            refs: [{ sourceDocumentId: FOREIGN_DOC, fileName: "other_hive.pdf", pageNumber: 1 }],
          },
        ],
      },
      {
        component: "Comparison",
        id: "cmp-1",
        title: "W-2 vs Form 1040",
        leftLabel: "Form W-2",
        rightLabel: "Form 1040",
        items: [
          {
            label: "Wages",
            left: "$142,500",
            right: "$142,500",
            refs: [
              { sourceDocumentId: DOC_A, fileName: "maya_2024_w2.pdf", pageNumber: 1 },
              { sourceDocumentId: DOC_B, fileName: "maya_2024_1040.pdf", pageNumber: 1 },
            ],
          },
          {
            label: "Out-of-bounds page comparison",
            left: "$1",
            right: "$2",
            refs: [{ sourceDocumentId: DOC_A, fileName: "maya_2024_w2.pdf", pageNumber: 9 }],
          },
        ],
      },
    ],
  };
}

const CANONICAL_STUB: StudyView = {
  schema: "hive.study-view/1",
  sections: [],
  blocks: [],
  components: [],
};

describe("legacy-home-projection", () => {
  it("projects source-backed topics, open items, and comparisons while deduplicating and enforcing bounds", () => {
    const projected = projectApplicationViewHome(makeMayaLegacyView(), {
      authorizedSourceDocumentIds: [DOC_A, DOC_B],
      authorizedDocumentPages: { [DOC_A]: 2, [DOC_B]: 4 },
    });

    expect(projected.statementCount).toBe(2);
    expect(projected.topics).toHaveLength(2);
    expect(projected.topics[0]).toMatchObject({
      title: "Key findings",
      uncertain: false,
    });
    expect(projected.topics[0].statements).toHaveLength(1);
    expect(projected.topics[0].statements[0].refs).toHaveLength(1);
    expect(projected.topics[0].statements[0].refs[0].quote).toBe(
      "Box 1 Wages, tips, other comp.: 142,500.00",
    );

    expect(projected.topics[1]).toMatchObject({
      title: "Income review",
      uncertain: true,
    });
    expect(projected.topics[1].statements[0].text).toContain("Schedule K-1");

    expect(projected.openItems).toHaveLength(2);
    expect(projected.openItems.map((item) => item.title)).toEqual([
      "Request the signed 2024 Schedule K-1 before filing.",
      "Confirm federal tax withholding discrepancy between W-2 and return.",
    ]);

    expect(projected.comparisons).toHaveLength(1);
    expect(projected.comparisons[0].items).toHaveLength(1);
    expect(projected.comparisons[0].items[0].label).toBe("Wages");
    expect(projected.comparisons[0].items[0].refs).toHaveLength(2);
  });

  it("returns empty when canonical StudyView exists (canonical precedence)", () => {
    const result = resolveLegacyHomeProjection({
      studyView: CANONICAL_STUB,
      reports: [makeReport({ view: makeMayaLegacyView() })],
      acceptedStudyRevisionId: REV_6,
      authorizedSourceDocumentIds: [DOC_A, DOC_B],
    });
    expect(result).toEqual(EMPTY_LEGACY_HOME_PROJECTION);
  });

  it("ignores reports from other study revisions (same-revision strictness)", () => {
    const olderReport = makeReport({
      studyRevisionId: REV_5,
      revisionNumber: 5,
      view: makeMayaLegacyView(),
    });
    const result = resolveLegacyHomeProjection({
      studyView: null,
      reports: [olderReport],
      acceptedStudyRevisionId: REV_6,
      authorizedSourceDocumentIds: [DOC_A, DOC_B],
    });
    expect(result).toEqual(EMPTY_LEGACY_HOME_PROJECTION);
  });

  it("prefers latest same-revision CUSTOMER report and falls back to PRO when CUSTOMER has no authorized items", () => {
    const emptyCustomer = makeReport({
      id: "33333333-3333-4333-8333-333333333332",
      audience: "CUSTOMER",
      title: "Customer foreign-only",
      view: {
        schema: APPLICATION_VIEW_SCHEMA,
        title: "Customer",
        audience: "CUSTOMER",
        layout: "PROPOSED",
        components: [
          {
            component: "KeyFindings",
            id: "kf-foreign",
            title: "Foreign",
            items: [
              {
                id: "cl-foreign",
                kind: "FACT",
                numericStatus: null,
                text: "Foreign claim",
                refs: [{ sourceDocumentId: FOREIGN_DOC, fileName: "foreign.pdf", pageNumber: 1 }],
                quotes: [],
              },
            ],
          },
        ],
      },
    });
    const validPro = makeReport({
      id: "33333333-3333-4333-8333-333333333333",
      audience: "PRO",
      title: "Professional legacy report",
      view: makeMayaLegacyView(),
    });

    const result = resolveLegacyHomeProjection({
      studyView: null,
      reports: [emptyCustomer, validPro],
      acceptedStudyRevisionId: REV_6,
      authorizedSourceDocumentIds: [DOC_A, DOC_B],
      authorizedDocumentPages: { [DOC_A]: 2, [DOC_B]: 4 },
    });

    expect(result.report).toMatchObject({
      reportId: "33333333-3333-4333-8333-333333333333",
      audience: "PRO",
      revisionNumber: 6,
      title: "Professional legacy report",
    });
    expect(result.statementCount).toBe(2);
  });

  it("returns empty when authorizedSourceDocumentIds is an empty array", () => {
    const result = resolveLegacyHomeProjection({
      studyView: null,
      reports: [makeReport({ view: makeMayaLegacyView() })],
      acceptedStudyRevisionId: REV_6,
      authorizedSourceDocumentIds: [],
    });
    expect(result).toEqual(EMPTY_LEGACY_HOME_PROJECTION);
  });
});
