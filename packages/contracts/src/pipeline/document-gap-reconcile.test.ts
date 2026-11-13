import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "./canonical-study-contracts";
import { askNowDocumentRequestCount, buildDocumentRequestListData } from "./document-request-list-contracts";
import {
  documentExpectationCoverage,
  documentPartSatisfied,
  findPackRowForModelGap,
  formatRecordReasonsForChecks,
  inferGapSettlesCheckIds,
  parseDocumentRequestWhy,
  reconcilePackDocumentGaps,
  recordReasonForCheck,
} from "./document-gap-reconcile";
import { parsePackMarkdown } from "./pack-contracts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const FIXTURE = join(ROOT, "packages/contracts/src/testing/fixtures/widget-review-pack.md");
const fixturePack = parsePackMarkdown(readFileSync(FIXTURE, "utf8"));
if (!fixturePack.ok) throw new Error("widget-review pack load failed");
const pack = fixturePack.value;

describe("document-gap-reconcile", () => {
  it("uses check text for pack-driven reasons", () => {
    const text = recordReasonForCheck(pack, "T1");
    expect(text).toContain("These documents don't show");
    expect(text).not.toMatch(/may help show whether/i);
  });

  it("drops expectations already in the corpus and keeps missing semicolon parts", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [
        {
          sourceDocumentId: "d1",
          role: "SUPPORTING",
          typeInPlainWords: "Signed notice before testing",
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
    };
    const full = "Signed notice before testing; Weekly progress log";
    expect(documentExpectationCoverage(full, study).remainingTitle?.toLowerCase()).toContain("weekly progress");
    expect(documentExpectationCoverage("Calibration card for line 2", study).satisfied).toBe(false);
  });

  it("matches uploaded titles via generic token overlap on each semicolon part", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [
        {
          sourceDocumentId: "d1",
          role: "SUPPORTING",
          typeInPlainWords: "Line 2 calibration card",
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
    };
    expect(documentPartSatisfied("Calibration card for line 2", study)).toBe(true);
    const partial = "Signed notice before testing; Weekly progress log";
    expect(documentExpectationCoverage(partial, study).satisfied).toBe(false);
    expect(documentPartSatisfied("Signed notice before testing", study)).toBe(false);
    expect(documentPartSatisfied("Weekly progress log", study)).toBe(false);
  });

  it("formats multi-check reasons with one lead and bullets", () => {
    const text = formatRecordReasonsForChecks(pack, ["T1", "T2"]);
    const parsed = parseDocumentRequestWhy(text);
    expect("bullets" in parsed && parsed.bullets.length).toBeGreaterThan(1);
    expect(parsed).toMatchObject({ lead: "These documents don't show:" });
  });

  it("keeps separate pack rows for different unsettled checks", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      checklist: [
        { checkId: "T1", verdict: "NOT_SHOWN", factIds: [], note: "" },
        { checkId: "S1", verdict: "NOT_SHOWN", factIds: [], note: "" },
      ],
      gaps: [],
    };
    const { study: reconciled } = reconcilePackDocumentGaps(study, pack);
    const calibration = reconciled.gaps.find((gap) => /calibration/i.test(gap.title));
    const notice = reconciled.gaps.find((gap) => /notice before testing/i.test(gap.title));
    expect(calibration).toBeDefined();
    expect(notice).toBeDefined();
    expect(calibration?.id).not.toBe(notice?.id);
  });

  it("matches model gap titles to pack rows when tokens are contained in the pack name", () => {
    expect(
      findPackRowForModelGap(
        {
          id: "X1",
          statement: "",
          relatedSpineIds: [],
          kind: "REQUESTABLE_DOCUMENT",
          title: "Signed notice",
          why: "",
          holder: "",
          holderType: null,
          when: null,
          basisType: "MENTIONED",
          relatedFactIds: [],
        },
        pack,
      )?.document.toLowerCase(),
    ).toContain("notice");
    expect(
      findPackRowForModelGap(
        {
          id: "X2",
          statement: "",
          relatedSpineIds: [],
          kind: "REQUESTABLE_DOCUMENT",
          title: "Weekly progress log",
          why: "",
          holder: "",
          holderType: null,
          when: null,
          basisType: "MENTIONED",
          relatedFactIds: [],
        },
        pack,
      )?.document.toLowerCase(),
    ).toContain("progress");
  });

  it("dedupes model and pack gaps for the same document", () => {
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
          title: "Testing notice",
          why: "Model noted missing notice.",
          holder: "THIRD_PARTY (vendor)",
          holderType: "THIRD_PARTY",
          when: null,
          basisType: "MENTIONED",
          relatedFactIds: [],
          settlesCheckIds: ["T1"],
        },
      ],
    };
    const { study: reconciled } = reconcilePackDocumentGaps(study, pack);
    const noticeGaps = reconciled.gaps.filter((gap) => inferGapSettlesCheckIds(gap, pack).includes("T1"));
    expect(noticeGaps.length).toBe(1);
    expect(noticeGaps[0]?.title.toLowerCase()).toContain("notice");
  });

  it("reports ask-now count from unsettled widget checklist rows", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "neutral",
      spineSource: "ANCHOR",
      documents: [
        {
          sourceDocumentId: "01",
          role: "SUPPORTING",
          typeInPlainWords: "Widget spec sheet",
          date: "2026-09-01",
          version: null,
          chainPosition: null,
        },
        {
          sourceDocumentId: "02",
          role: "SUPPORTING",
          typeInPlainWords: "Acceptance log",
          date: "2026-09-15",
          version: null,
          chainPosition: null,
        },
      ],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      checklist: [
        { checkId: "T1", verdict: "NOT_SHOWN", factIds: [], note: "" },
        { checkId: "T2", verdict: "NOT_SHOWN", factIds: [], note: "" },
        { checkId: "S1", verdict: "NOT_SHOWN", factIds: [], note: "" },
      ],
      gaps: [],
      packRef: { id: pack.meta.pack, version: pack.meta.version },
    };
    const { study: reconciled, intakePrompts } = reconcilePackDocumentGaps(study, pack);
    const listData = buildDocumentRequestListData(reconciled);
    const askNow = askNowDocumentRequestCount({ ...listData, intakePrompts });
    expect(askNow).toBeGreaterThan(0);
  });
});
