/**
 * P0.4 — Maya Study v6: why Timeline is empty despite dated investigation findings and a saved report.
 * Synthetic fixture only; documents investigation-1 persistence vs hive.study-view/1 timeline blocks.
 */

import { describe, expect, it } from "vitest";

import { resolveCanonicalFindings } from "../analysis/canonical-finding-resolver";
import { studyClaimCatalog, verifyStudyInvestigation } from "../analysis/study-verification";
import { buildStudyView } from "../pipeline/study-view-contracts";
import { compileEditorialPlan } from "../reports/editorial-plan-compiler";
import { revision6CustomerEditorialPlan } from "../reports/editorial-plan-fixtures";
import { resolveWorkspaceTimelineRows } from "../hives/timeline-projection";
import { APPLICATION_VIEW_SCHEMA, buildReport } from "../reports/application-view-contracts";
import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "../pipeline/canonical-study-contracts";
import {
  MAYA_REVISION_6_PAGES,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaRevision6StudyOutput,
} from "./maya-fixture";

const REPORT_RUN_ID = "5a5a5a5a-0000-4000-8000-000000000099";

function verifiedRevision6() {
  const verified = verifyStudyInvestigation(mayaRevision6StudyOutput(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
  });
  if (!verified.ok) throw new Error(verified.message);
  const claims = studyClaimCatalog(verified.value);
  const canonicalFindings = resolveCanonicalFindings(verified.value, claims, { asOf: "2026-11-04" });
  return { claims, canonicalFindings };
}

describe("Maya revision 6 timeline data (P0.4)", () => {
  it("stores dated findings in the investigation, not in a canonical timeline array", () => {
    const { claims } = verifiedRevision6();
    const datedStatements = claims.filter(
      (claim) =>
        claim.kind === "FACT" &&
        (/\b(20\d{2}|January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(
          claim.text,
        ) ||
          claim.quotes.some((q) =>
            /\b(20\d{2}|January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(
              q,
            ),
          )),
    );
    expect(datedStatements.length).toBeGreaterThanOrEqual(4);
    expect(datedStatements.some((c) => c.id === "P1.F4")).toBe(true);
    expect(datedStatements.some((c) => c.id === "P1.F2")).toBe(true);
  });

  it("revision-6 Customer editorial plan omits a Timeline A2UI component", () => {
    expect(revision6CustomerEditorialPlan().components.some((c) => c.component === "Timeline")).toBe(false);
  });

  it("saved revision-6 Customer report is hive.application-view/1 with no Timeline components", () => {
    const { claims, canonicalFindings } = verifiedRevision6();
    const fileNames = new Map<string, string>();
    const compiled = compileEditorialPlan(revision6CustomerEditorialPlan(), {
      reportRunId: REPORT_RUN_ID,
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.writerReport.view.some((v) => v.component === "Timeline")).toBe(false);
    const built = buildReport(compiled.writerReport, {
      audience: "CUSTOMER",
      claims,
      fileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.view.schema).toBe(APPLICATION_VIEW_SCHEMA);
    expect(built.value.view.components.filter((c) => c.component === "Timeline")).toHaveLength(0);
    expect(
      resolveWorkspaceTimelineRows({
        studyView: null,
        reports: [
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            reportRunId: REPORT_RUN_ID,
            studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            revisionNumber: 6,
            audience: "CUSTOMER",
            title: "Maya review",
            createdAt: "2026-11-02T00:00:00.000Z",
            view: built.value.view,
            scenarioAnalysis: { schema: "hive.scenario-analysis/1", scenarios: [] },
            modelAlias: null,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("hive.study-view/1 timeline block rows come only from canonical.timeline (dated docs/spine do not backfill)", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "Records review",
      spineSource: "ANCHOR",
      documents: [
        {
          sourceDocumentId: "5a5a5a5a-0000-4000-8000-0000000000d1",
          role: "ANCHOR",
          typeInPlainWords: "Anchor plan",
          date: "2025-03-04",
          version: null,
          chainPosition: 1,
        },
      ],
      spine: [
        {
          id: "S1",
          label: "Reading fluency goal",
          kind: "commitment",
          status: "SUPPORTED",
          supportingFactIds: ["F1"],
          contradictingFactIds: [],
          updatingFactIds: [],
          missing: [],
        },
      ],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [],
    };
    const facts = [
      {
        id: "F1",
        subject: "Goal 1",
        attribute: "target",
        valueAsWritten: "90 words correct per minute by March 2026",
        sourceDocumentId: "5a5a5a5a-0000-4000-8000-0000000000d1",
        pageNumber: 1,
        quote: "Maya will read 90 words correct per minute by March 2026.",
      },
    ];
    expect(study.timeline).toHaveLength(0);
    const { view } = buildStudyView(study, { sections: [], blocks: [] }, facts, {});
    const spine = view.blocks.find((b) => b.name === "spine_table");
    const timeline = view.blocks.find((b) => b.name === "timeline");
    const docs = view.blocks.find((b) => b.name === "documents");
    expect(spine?.rows.length).toBeGreaterThan(0);
    expect(spine?.rows[0]?.values.length).toBeGreaterThan(0);
    expect(docs?.rows.some((row) => row.date != null)).toBe(true);
    expect(timeline?.rows ?? []).toHaveLength(0);
  });
});