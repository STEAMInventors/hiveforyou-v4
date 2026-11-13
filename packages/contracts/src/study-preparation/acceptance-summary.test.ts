import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "../pipeline/canonical-study-contracts";
import {
  buildV5AcceptanceCounts,
  countChecklistVerdicts,
  countVerifiedFactIds,
  formatStudyRevisionAcceptanceDetail,
  parseStudyRevisionAcceptanceCounts,
} from "./acceptance-summary";
import type { StudyRevisionSummary } from "./study-preparation-contracts";

const RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REV_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STUDY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const baseStudy: CanonicalStudy = {
  schema: CANONICAL_STUDY_SCHEMA,
  documents: [
    { sourceDocumentId: "doc-a", role: "ANCHOR", typeInPlainWords: "Widget spec sheet", date: null, version: null, chainPosition: 1 },
    { sourceDocumentId: "doc-b", role: "SUPPORTING", typeInPlainWords: "Acceptance log", date: null, version: null, chainPosition: null },
  ],
  spineSource: "ANCHOR",
  spine: [
    {
      id: "S1",
      label: "Eligibility",
      kind: "topic",
      status: "SUPPORTED",
      supportingFactIds: ["F1", "F2"],
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
    },
  ],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [],
  domainLabel: "neutral",
  checklist: [
    { checkId: "T1", verdict: "SHOWN" as const, factIds: ["F1"], note: "" },
    { checkId: "T2", verdict: "NOT_SHOWN" as const, factIds: [], note: "" },
  ],
  packRef: { id: "widget-review", version: 2 },
};

describe("acceptance-summary", () => {
  it("counts unique verified fact ids and checklist verdicts", () => {
    expect(countVerifiedFactIds(baseStudy)).toBe(2);
    expect(countChecklistVerdicts(baseStudy)).toEqual({ shown: 1, notShown: 1 });
  });

  it("builds acceptance counts with pack review title", () => {
    expect(buildV5AcceptanceCounts(baseStudy, "Widget batch review")).toMatchObject({
      verifiedFacts: 2,
      documents: 2,
      checklistShown: 1,
      checklistNotShown: 1,
      packReview: { id: "widget-review", version: 2, title: "Widget batch review" },
    });
  });

  it("formats V5 acceptance detail for owners", () => {
    const revision: StudyRevisionSummary = {
      id: REV_ID,
      canonicalStudyId: STUDY_ID,
      revisionNumber: 7,
      predecessorRevisionId: null,
      processingRunId: RUN_ID,
      format: "canonical-study-1",
      coverageComplete: true,
      coverageStatus: "COMPLETE",
      coverageGaps: [],
      coverageAcknowledgement: "NOT_REQUIRED",
      createdAt: "2026-11-12T04:35:00.000Z",
      acceptanceCounts: buildV5AcceptanceCounts(baseStudy, "Widget batch review"),
    };
    expect(formatStudyRevisionAcceptanceDetail(revision)).toBe(
      "2 verified facts · 2 documents · 1 checks shown · 1 not shown. Reviewed with: Widget batch review (v2)",
    );
  });

  it("round-trips counts via parseStudyRevisionAcceptanceCounts", () => {
    const counts = buildV5AcceptanceCounts(baseStudy, "Widget batch review");
    expect(parseStudyRevisionAcceptanceCounts(counts)).toEqual(counts);
  });
});
