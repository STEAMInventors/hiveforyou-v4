import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "@hiveforyou/contracts";
import {
  askNowDocumentRequestCount,
  buildDocumentRequestListData,
  buildStudyView,
  documentExpectationCoverage,
  documentPartSatisfied,
  findPackRowForModelGap,
  inferGapSettlesCheckIds,
  parsePackMarkdown,
  reconcilePackDocumentGaps,
} from "@hiveforyou/contracts";

const ROOT = resolve(import.meta.dirname, "..");

describe("document-gap-reconcile (iep-initial pack)", () => {
  const iepPack = parsePackMarkdown(readFileSync(join(ROOT, "packs/HiveForYou-Pack-iep-initial.md"), "utf8"));
  if (!iepPack.ok) {
    it("loads IEP pack", () => expect(iepPack.ok).toBe(true));
    return;
  }
  const pack = iepPack.value;

  it("drops satisfied consent parts from uploadSatisfaction judgments", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [
        {
          sourceDocumentId: "d1",
          role: "SUPPORTING",
          typeInPlainWords: "Parent consent to evaluate",
          date: null,
          version: null,
          chainPosition: null,
        },
      ],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [],
      uploadSatisfaction: [
        {
          document: "Signed consent to evaluate; consent for services",
          parts: [
            { part: "Signed consent to evaluate", satisfiedBy: "d1", factId: "F1" },
            { part: "consent for services", satisfiedBy: null, factId: null },
          ],
        },
      ],
    };
    const withEvaluate = "Signed consent to evaluate; consent for services";
    expect(documentExpectationCoverage(withEvaluate, study).remainingTitle?.toLowerCase()).toContain("consent for services");
  });

  it("keeps separate documents that settle the same check", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      checklist: [{ checkId: "E3", verdict: "NOT_SHOWN", factIds: [], note: "" }],
      gaps: [
        {
          id: "X1",
          statement: "",
          relatedSpineIds: [],
          kind: "REQUESTABLE_DOCUMENT",
          title: "Report cards",
          why: "Model gap",
          holder: "ASKER_OR_CLIENT",
          holderType: "ASKER_OR_CLIENT",
          when: null,
          basisType: "MENTIONED",
          relatedFactIds: [],
          settlesCheckIds: ["E3"],
        },
      ],
    };
    const { study: reconciled } = reconcilePackDocumentGaps(study, pack);
    const exclusionary = reconciled.gaps.find((gap) => /exclusionary/i.test(gap.title));
    const reportCards = reconciled.gaps.find((gap) => /report card/i.test(gap.title));
    expect(exclusionary).toBeDefined();
    expect(reportCards).toBeDefined();
    expect(exclusionary?.id).not.toBe(reportCards?.id);
  });

  it("matches model gap titles to pack rows when tokens are contained in the pack name", () => {
    expect(
      findPackRowForModelGap(
        {
          id: "X1",
          statement: "",
          relatedSpineIds: [],
          kind: "REQUESTABLE_DOCUMENT",
          title: "Meeting notice",
          why: "",
          holder: "",
          holderType: null,
          when: null,
          basisType: "MENTIONED",
          relatedFactIds: [],
        },
        pack,
      )?.document.toLowerCase(),
    ).toContain("meeting notice");
    expect(
      findPackRowForModelGap(
        {
          id: "X2",
          statement: "",
          relatedSpineIds: [],
          kind: "REQUESTABLE_DOCUMENT",
          title: "Classroom observation report",
          why: "",
          holder: "",
          holderType: null,
          when: null,
          basisType: "MENTIONED",
          relatedFactIds: [],
        },
        pack,
      )?.document.toLowerCase(),
    ).toContain("classroom observation");
  });

  it("reports ask-now count for special-ed-l001-shaped unsettled checklist", () => {
    const unsettled = ["T1", "T2", "T4", "T5", "T6", "E1", "E3", "E5", "G4", "S1"];
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "Special education",
      spineSource: "ANCHOR",
      documents: [
        {
          sourceDocumentId: "01",
          role: "SUPPORTING",
          typeInPlainWords: "Initial referral",
          date: "2024-09-01",
          version: null,
          chainPosition: null,
        },
        {
          sourceDocumentId: "02",
          role: "SUPPORTING",
          typeInPlainWords: "Evaluation plan",
          date: "2024-09-15",
          version: null,
          chainPosition: null,
        },
        {
          sourceDocumentId: "03",
          role: "SUPPORTING",
          typeInPlainWords: "Parent consent to evaluate",
          date: "2024-09-20",
          version: null,
          chainPosition: null,
        },
        {
          sourceDocumentId: "08",
          role: "ANCHOR",
          typeInPlainWords: "Initial individualized education program",
          date: "2024-11-12",
          version: null,
          chainPosition: 1,
        },
      ],
      spine: [
        {
          id: "S1",
          label: "Annual reading goal",
          kind: "GOAL_READING_FLUENCY",
          status: "SUPPORTED",
          supportingFactIds: [],
          contradictingFactIds: [],
          updatingFactIds: [],
          missing: [],
        },
      ],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      checklist: unsettled.map((checkId) => ({ checkId, verdict: "NOT_SHOWN" as const, factIds: [], note: "" })),
      gaps: [],
      uploadSatisfaction: [
        {
          document: "Signed consent to evaluate; consent for services",
          parts: [
            { part: "Signed consent to evaluate", satisfiedBy: "d1", factId: "F-consent" },
            { part: "consent for services", satisfiedBy: null, factId: null },
          ],
        },
      ],
    };
    const { study: reconciled, intakePrompts } = reconcilePackDocumentGaps(study, pack);
    const listData = buildDocumentRequestListData(reconciled);
    const askNow = askNowDocumentRequestCount({ ...listData, intakePrompts });
    const { view } = buildStudyView(
      reconciled,
      { sections: [], blocks: [], components: [{ name: "DocumentRequestList" }] },
      [],
      {},
      { pack, reportAudience: "customer" },
    );
    const component = view.components?.[0];
    expect(askNowDocumentRequestCount({ items: component?.items ?? [], observations: [], courtRecordCount: 0, legacyLines: [] })).toBe(
      askNow,
    );
    expect(askNow).toBeGreaterThan(0);
    expect(intakePrompts.some((row) => row.text.toLowerCase().includes("private evaluation"))).toBe(true);
    expect(askNow).toBe(9);
    const consent = listData.items.find((item) => item.title.toLowerCase().includes("consent"));
    expect(consent?.title.toLowerCase()).toContain("consent for services");
    expect(consent?.title.toLowerCase()).not.toContain("signed consent to evaluate");
  });
});
