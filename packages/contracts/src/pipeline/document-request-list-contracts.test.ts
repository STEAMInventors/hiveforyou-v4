import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalGap } from "./canonical-study-contracts";
import {
  buildDocumentRequestListData,
  draftRequestPlainText,
  isLegacyCanonicalGap,
  parseWriteDocumentRequestListProposal,
} from "./document-request-list-contracts";
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

describe("buildDocumentRequestListData", () => {
  it("maps statement-only legacy gaps to requestable items with a rebuild hint", () => {
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
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      kind: "REQUESTABLE_DOCUMENT",
      title: statement,
      why: statement,
      holder: "",
      basis: { type: "USUALLY_EXPECTED" },
    });
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
