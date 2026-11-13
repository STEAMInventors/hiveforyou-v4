import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalGap, type CanonicalStudy } from "./canonical-study-contracts";
import {
  buildDocumentRequestListData,
  canonicalGapMentionsPipelineTerms,
  draftRequestPlainText,
  dropPipelineLanguageGaps,
  gapTextMentionsPipelineTerms,
  isLegacyCanonicalGap,
  parseWriteDocumentRequestListProposal,
  partitionDocumentRequests,
  requestableDocumentCount,
} from "./document-request-list-contracts";
import { buildMissingDocumentsSummary } from "./missing-documents";
import { buildStudyView, parseWriteOutput } from "./study-view-contracts";

const gap = (partial: Partial<CanonicalGap> & Pick<CanonicalGap, "id" | "statement">): CanonicalGap => ({
  relatedSpineIds: [],
  kind: null,
  title: "",
  why: "",
  holder: "",
  holderType: null,
  when: null,
  basisType: null,
  relatedFactIds: [],
  ...partial,
});

describe("parseWriteDocumentRequestListProposal", () => {
  it("rejects model-authored items and actions", () => {
    const tally = { counts: {} as Record<string, number>, count(reason: string) { this.counts[reason] = (this.counts[reason] ?? 0) + 1; } };
    expect(
      parseWriteDocumentRequestListProposal(
        { name: "DocumentRequestList", items: [{ id: "X1", title: "Invented" }] },
        tally,
      ),
    ).toBeNull();
    expect(tally.counts.component_items_forbidden).toBe(1);
    expect(parseWriteDocumentRequestListProposal({ name: "DocumentRequestList", actions: ["send"] }, tally)).toBeNull();
  });

  it("accepts an optional intro with fact ids", () => {
    const parsed = parseWriteDocumentRequestListProposal({
      name: "DocumentRequestList",
      intro: { text: "Worth asking about these next.", factIds: ["F1"] },
    });
    expect(parsed).toEqual({
      name: "DocumentRequestList",
      intro: { text: "Worth asking about these next.", factIds: ["F1"] },
    });
  });
});

const MAYA_REVISION_1_ANCHOR_GAP =
  "No single document organizes all others as an anchor. The spine source is TIMELINE.";
const MAYA_REVISION_1_PROGRESS_GAP = "January 2026 progress report is not among the uploaded documents.";

describe("pipeline language in gap text", () => {
  it("matches the pipeline terms and leaves ordinary document statements alone", () => {
    for (const term of ["anchor", "spine", "TIMELINE", "canonical", "extraction", "extractable", "page could not"]) {
      expect(gapTextMentionsPipelineTerms(`Note: ${term} here`)).toBe(true);
    }
    expect(gapTextMentionsPipelineTerms(MAYA_REVISION_1_PROGRESS_GAP)).toBe(false);
    expect(gapTextMentionsPipelineTerms("The anchorage lease is missing.")).toBe(false);
  });
});

describe("buildDocumentRequestListData", () => {
  it("keeps statement-only legacy gaps as a plain list and not as upload slots", () => {
    const statement = "Water bill for March 2026 is not among the uploaded documents.";
    expect(
      isLegacyCanonicalGap(
        gap({ id: "X1", statement, kind: null, title: "", why: "", holder: "" }),
      ),
    ).toBe(true);
    const data = buildDocumentRequestListData(
      {
        schema: CANONICAL_STUDY_SCHEMA,
        domainLabel: "",
        spineSource: null,
        documents: [],
        spine: [],
        outsideSpine: [],
        conflicts: [],
        timeline: [],
        gaps: [gap({ id: "X1", statement })],
      },
      [],
    );
    expect(data.legacyHint).toBe(true);
    expect(data.items).toHaveLength(0);
    expect(data.legacyLines).toEqual([{ id: "X1", text: statement }]);
    expect(requestableDocumentCount(data)).toBe(0);
  });

  it("drops Maya revision-1 pipeline gaps and keeps the other statement as a plain line", () => {
    const anchor = gap({ id: "X1", statement: MAYA_REVISION_1_ANCHOR_GAP });
    const progress = gap({ id: "X2", statement: MAYA_REVISION_1_PROGRESS_GAP });
    const unread = gap({ id: "X3", statement: "A page could not be read, so that page is not part of the study." });
    expect(canonicalGapMentionsPipelineTerms(anchor)).toBe(true);
    expect(canonicalGapMentionsPipelineTerms(progress)).toBe(false);
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "neutral",
      spineSource: "TIMELINE",
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [anchor, progress, unread],
    };
    const data = buildDocumentRequestListData(study, []);
    expect(data.items).toEqual([]);
    expect(data.legacyLines).toEqual([{ id: "X2", text: MAYA_REVISION_1_PROGRESS_GAP }]);
    expect(requestableDocumentCount(data)).toBe(0);
    const summary = buildMissingDocumentsSummary(study);
    expect(summary.uploadSlotCount).toBe(0);
    expect(summary.slots).toEqual([]);
    const dropped = dropPipelineLanguageGaps(study);
    expect(dropped.dropped).toBe(2);
    expect(dropped.study.gaps.map((item) => item.id)).toEqual(["X2"]);
  });

  it("treats a saved list that copied the statement into title and why as legacy lines", () => {
    const parts = partitionDocumentRequests({
      legacyHint: true,
      items: [
        {
          id: "X1",
          kind: "REQUESTABLE_DOCUMENT",
          title: MAYA_REVISION_1_ANCHOR_GAP,
          why: MAYA_REVISION_1_ANCHOR_GAP,
          holder: "",
          holderType: "ASKER_OR_CLIENT",
          basis: { type: "USUALLY_EXPECTED" },
        },
        {
          id: "X2",
          kind: "REQUESTABLE_DOCUMENT",
          title: MAYA_REVISION_1_PROGRESS_GAP,
          why: MAYA_REVISION_1_PROGRESS_GAP,
          holder: "",
          holderType: "ASKER_OR_CLIENT",
          basis: { type: "USUALLY_EXPECTED" },
        },
      ],
    });
    expect(parts.items).toEqual([]);
    expect(parts.legacyLines).toEqual([{ id: "X2", text: MAYA_REVISION_1_PROGRESS_GAP }]);
  });

  it("downgrades MENTIONED when no referring page matches the title", () => {
    const data = buildDocumentRequestListData(
      {
        schema: CANONICAL_STUDY_SCHEMA,
        domainLabel: "",
        spineSource: null,
        documents: [],
        spine: [],
        outsideSpine: [],
        conflicts: [],
        timeline: [],
        gaps: [
          gap({
            id: "X1",
            statement: "Ledger missing",
            kind: "REQUESTABLE_DOCUMENT",
            title: "Annual ledger",
            why: "Not supplied",
            basisType: "MENTIONED",
          }),
        ],
      },
      [],
    );
    expect(data.items[0]!.basis).toEqual({ type: "USUALLY_EXPECTED" });
  });
});

describe("buildStudyView fallback", () => {
  const study: import("./canonical-study-contracts").CanonicalStudy = {
    schema: CANONICAL_STUDY_SCHEMA,
    domainLabel: "",
    spineSource: null,
    documents: [],
    spine: [],
    outsideSpine: [],
    conflicts: [],
    timeline: [],
    gaps: [
      gap({
        id: "X1",
        statement: "Ledger missing",
        kind: "REQUESTABLE_DOCUMENT",
        title: "Annual ledger",
        why: "Not supplied",
      }),
    ],
  };
  const facts = [{ id: "F1", subject: "a", attribute: "b", valueAsWritten: "c", sourceDocumentId: "d", pageNumber: 1, quote: "q" }];

  it("renders code-built items and sets fallback when the model invent items", () => {
    const parsed = parseWriteOutput({
      sections: [],
      blocks: [],
      components: [{ name: "DocumentRequestList", items: [{ id: "bad" }] }],
    });
    if (!parsed.ok) throw new Error("parse");
    const { view } = buildStudyView(study, parsed.value, facts, parsed.malformed);
    expect(view.components[0]?.fallback).toBe(true);
    expect(view.components[0]?.items).toHaveLength(1);
  });
});

describe("draftRequestPlainText", () => {
  it("copies checked requestable titles and reasons", () => {
    const text = draftRequestPlainText(
      [
        {
          id: "X1",
          kind: "REQUESTABLE_DOCUMENT",
          title: "Tax return",
          why: "Required by the plan.",
          holder: "",
          holderType: "ASKER_OR_CLIENT",
          basis: { type: "USUALLY_EXPECTED" },
        },
      ],
      new Set(["X1"]),
    );
    expect(text).toBe("Tax return\nRequired by the plan.");
  });
});
