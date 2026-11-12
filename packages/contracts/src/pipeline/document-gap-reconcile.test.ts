import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "./canonical-study-contracts";
import { askNowDocumentRequestCount, buildDocumentRequestListData } from "./document-request-list-contracts";
import {
  documentExpectationCoverage,
  inferGapSettlesCheckIds,
  reconcilePackDocumentGaps,
  recordReasonForCheck,
} from "./document-gap-reconcile";
import { parsePackMarkdown } from "./pack-contracts";
import { buildStudyView } from "./study-view-contracts";

const ROOT = resolve(import.meta.dirname, "../../../..");

describe("document-gap-reconcile", () => {
  const iepPack = parsePackMarkdown(readFileSync(join(ROOT, "packs/HiveForYou-Pack-iep-initial.md"), "utf8"));
  if (!iepPack.ok) {
    it("loads IEP pack", () => expect(iepPack.ok).toBe(true));
    return;
  }
  const pack = iepPack.value;

  it("uses check text for pack-driven reasons", () => {
    const text = recordReasonForCheck(pack, "T1");
    expect(text).toContain("These documents don't show");
    expect(text).not.toMatch(/may help show whether/i);
  });

  it("drops expectations already in the corpus and keeps partial consent", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [{ sourceDocumentId: "d1", role: "SUPPORTING", typeInPlainWords: "Parent consent to evaluate", date: null, version: null, chainPosition: null }],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [],
    };
    const full = "Signed consent to evaluate; consent for services";
    expect(documentExpectationCoverage(full, study).remainingTitle).toContain("consent for services");
    expect(documentExpectationCoverage("Procedural safeguards notice", study).satisfied).toBe(false);
  });

  it("dedupes model and pack gaps that settle the same check", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      checklist: [{ checkId: "T1", verdict: "NOT_SHOWN", factIds: [], note: "" }],
      gaps: [
        {
          id: "X1",
          statement: "",
          relatedSpineIds: [],
          kind: "REQUESTABLE_DOCUMENT",
          title: "Consent form",
          why: "Model noted missing consent.",
          holder: "ASKER_OR_CLIENT",
          holderType: "ASKER_OR_CLIENT",
          when: null,
          basisType: "MENTIONED",
          relatedFactIds: [],
          settlesCheckIds: ["T1"],
        },
      ],
    };
    const { study: reconciled } = reconcilePackDocumentGaps(study, pack);
    const consentGaps = reconciled.gaps.filter((gap) => inferGapSettlesCheckIds(gap, pack).includes("T1"));
    expect(consentGaps.length).toBe(1);
    expect(consentGaps[0]?.title.toLowerCase()).toContain("consent");
    expect(consentGaps[0]?.why).toMatch(/consent/i);
  });

  it("reports ask-now count for special-ed-l001-shaped unsettled checklist", () => {
    const unsettled = ["T1", "T2", "T4", "T5", "T6", "E1", "E3", "E5", "G4", "S1"];
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "Special education",
      spineSource: "ANCHOR",
      documents: [
        { sourceDocumentId: "01", role: "SUPPORTING", typeInPlainWords: "Initial referral", date: "2024-09-01", version: null, chainPosition: null },
        { sourceDocumentId: "02", role: "SUPPORTING", typeInPlainWords: "Evaluation plan", date: "2024-09-15", version: null, chainPosition: null },
        { sourceDocumentId: "03", role: "SUPPORTING", typeInPlainWords: "Parent consent to evaluate", date: "2024-09-20", version: null, chainPosition: null },
        { sourceDocumentId: "08", role: "ANCHOR", typeInPlainWords: "Initial individualized education program", date: "2024-11-12", version: null, chainPosition: 1 },
      ],
      spine: [{ id: "S1", label: "Annual reading goal", kind: "GOAL_READING_FLUENCY", status: "SUPPORTED", supportingFactIds: [], contradictingFactIds: [], updatingFactIds: [], missing: [] }],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      checklist: unsettled.map((checkId) => ({ checkId, verdict: "NOT_SHOWN" as const, factIds: [], note: "" })),
      gaps: [],
    };
    const { study: reconciled, intakePrompts } = reconcilePackDocumentGaps(study, pack);
    const listData = buildDocumentRequestListData(reconciled);
    const askNow = askNowDocumentRequestCount({ ...listData, intakePrompts });
    const { view } = buildStudyView(reconciled, { sections: [], blocks: [], components: [{ name: "DocumentRequestList" }] }, [], {}, { pack, reportAudience: "customer" });
    const component = view.components?.[0];
    expect(component?.items.filter((item) => item.kind === "REQUESTABLE_DOCUMENT").length).toBe(askNow);
    expect(askNow).toBeGreaterThan(0);
    expect(intakePrompts.some((row) => row.text.toLowerCase().includes("private evaluation"))).toBe(true);
    // Snapshot for special-ed-l001-shaped corpora after reconcile (revision-4-style gap set).
    expect(askNow).toBe(7);
  });
});
