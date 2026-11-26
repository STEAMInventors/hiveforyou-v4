import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "../pipeline/canonical-study-contracts";
import {
  buildV5AcceptanceCounts,
  countChecklistVerdicts,
  countVerifiedFactIds,
  formatStudyRevisionAcceptanceDetail,
  formatStudyRevisionProvenance,
  parseStudyRevisionAcceptanceCounts,
  readStudyRevisionIdentity,
} from "./acceptance-summary";
import { normalizeStudyRevisionSummary, type StudyRevisionSummary } from "./study-preparation-contracts";

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

  function summary(overrides: Partial<StudyRevisionSummary> & Pick<StudyRevisionSummary, "revisionNumber">): StudyRevisionSummary {
    return {
      id: REV_ID,
      canonicalStudyId: STUDY_ID,
      predecessorRevisionId: null,
      processingRunId: RUN_ID,
      coverageComplete: true,
      coverageStatus: "COMPLETE",
      coverageGaps: [],
      coverageAcknowledgement: "NOT_REQUIRED",
      createdAt: "2026-11-12T04:35:00.000Z",
      ...overrides,
    };
  }

  it("maps stored verified facts instead of a sentinel zero claim count", () => {
    const raw = {
      id: REV_ID,
      canonicalStudyId: STUDY_ID,
      revisionNumber: 10,
      predecessorRevisionId: null,
      processingRunId: RUN_ID,
      format: "canonical-study-1",
      coverageComplete: true,
      coverageStatus: "COMPLETE",
      coverageGaps: [],
      coverageAcknowledgement: "NOT_REQUIRED",
      createdAt: "2026-11-26T12:00:00.000Z",
      sourceCount: 8,
      documentFindingCount: 0,
      counts: {
        documentFindings: 0,
        claims: 0,
        verifiedFacts: 11,
        documents: 8,
        investigationEngine: "hive-canonicalize/1",
        domainPackId: "iep-initial",
        domainPackVersion: "7",
        revisionStatus: "accepted",
        packReview: { id: "iep-initial", version: 7, title: "IEP review" },
      },
    };
    const revision = normalizeStudyRevisionSummary(raw);
    expect(revision?.documentFindingCount).toBeUndefined();
    expect(formatStudyRevisionAcceptanceDetail(revision!)).toBe(
      "11 verified facts · 8 documents. Reviewed with: IEP review (v7)",
    );
    expect(formatStudyRevisionAcceptanceDetail(revision!)).not.toContain("0 verified");
    expect(formatStudyRevisionProvenance(readStudyRevisionIdentity({ revision: revision! }), 10)).toBe(
      "Investigation engine hive-canonicalize/1. Domain pack iep-initial 7. Revision 10 accepted.",
    );
  });

  it("does not display an unavailable count as zero", () => {
    const unavailable = summary({
      revisionNumber: 10,
      format: "canonical-study-1",
      sourceCount: 8,
      documentFindingCount: 0,
    });
    expect(formatStudyRevisionAcceptanceDetail(unavailable)).toBe(
      "8 documents. Verified claim count was not recorded",
    );
    const missing = summary({ revisionNumber: 4, format: "investigation-1" });
    expect(formatStudyRevisionAcceptanceDetail(missing)).toBe("Counts were not recorded with this revision.");
    expect(formatStudyRevisionAcceptanceDetail(missing)).not.toContain("0 ");
  });

  it("keeps a measured zero on an earlier investigation revision", () => {
    const earlier = summary({
      revisionNumber: 6,
      format: "investigation-1",
      sourceCount: 8,
      documentFindingCount: 0,
    });
    const later = summary({
      revisionNumber: 10,
      format: "canonical-study-1",
      acceptanceCounts: { verifiedFacts: 11, documents: 8 },
    });
    expect(formatStudyRevisionAcceptanceDetail(earlier)).toBe("8 sources · 0 verified claims");
    expect(formatStudyRevisionAcceptanceDetail(later)).toBe("11 verified facts · 8 documents");
    expect(earlier.documentFindingCount).toBe(0);
    expect(earlier.revisionNumber).toBe(6);
  });

  it("distinguishes legacy IEP v7 from a matching 0.5.0 digest and refuses a mismatched digest", () => {
    const digest = "ab".repeat(32);
    const legacy = readStudyRevisionIdentity({
      revision: summary({ revisionNumber: 10, format: "canonical-study-1" }),
      study: { packRef: { id: "iep-initial", version: 7 } },
    });
    const matched = readStudyRevisionIdentity({
      revision: summary({ revisionNumber: 11, format: "canonical-study-1" }),
      study: { questionOrder: [`pack-digest:${digest}`] },
      knownInvestigationPack: { packId: "iep-us-federal", version: "0.5.0", compiledDigest: digest },
    });
    const mismatched = readStudyRevisionIdentity({
      revision: summary({ revisionNumber: 11, format: "canonical-study-1" }),
      study: { questionOrder: [`pack-digest:${"cd".repeat(32)}`] },
      knownInvestigationPack: { packId: "iep-us-federal", version: "0.5.0", compiledDigest: digest },
    });
    expect(formatStudyRevisionProvenance(legacy, 10)).toBe(
      "Investigation engine hive-canonicalize/1. Domain pack iep-initial 7. Revision 10 accepted.",
    );
    expect(formatStudyRevisionProvenance(matched, 11)).toBe(
      "Investigation engine hive.domain-investigation/1. Domain pack iep-us-federal 0.5.0. Revision 11 accepted.",
    );
    expect(mismatched.investigationEngine).toBe("hive.domain-investigation/1");
    expect(mismatched.domainPackVersion).toBeNull();
    expect(formatStudyRevisionProvenance(mismatched, 11)).toContain("Domain pack version was not recorded");
    expect(formatStudyRevisionProvenance(mismatched, 11)).not.toContain("0.5.0");
  });
});
