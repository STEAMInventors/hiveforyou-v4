import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "./canonical-study-contracts";
import { buildStudyView, matchReferencedDocuments, parseWriteOutput, STUDY_VIEW_SCHEMA } from "./study-view-contracts";

const FACTS = [
  {
    id: "F-aaaa0001-001",
    subject: "Fee",
    attribute: "amount",
    valueAsWritten: "$100.00",
    sourceDocumentId: "doc-a",
    pageNumber: 2,
    quote: "The fee is $100.00.",
  },
  {
    id: "F-bbbb0002-001",
    subject: "Fee",
    attribute: "amount",
    valueAsWritten: "$120.00",
    sourceDocumentId: "doc-b",
    pageNumber: 1,
    quote: "Total due $120.00.",
  },
] as const;

const study: CanonicalStudy = {
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "Example field",
  spineSource: "ANCHOR",
  documents: [
    { sourceDocumentId: "doc-a", role: "ANCHOR", typeInPlainWords: "Notice", date: "2026-01-01", version: null, chainPosition: null },
    { sourceDocumentId: "doc-a", role: "SUPPORTING", typeInPlainWords: "Duplicate id row", date: null, version: null, chainPosition: null },
  ],
  spine: [
    {
      id: "S1",
      label: "Fee of $100.00",
      kind: "figure",
      status: "CONFLICTED",
      supportingFactIds: ["F-aaaa0001-001"],
      contradictingFactIds: ["F-bbbb0002-001"],
      updatingFactIds: [],
      missing: [],
    },
    { id: "S1", label: "Duplicate spine id", kind: "claim", status: "OPEN", supportingFactIds: ["F-aaaa0001-001"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
  ],
  outsideSpine: [{ id: "O1", statement: "Background note", factIds: ["F-aaaa0001-001"] }],
  conflicts: [{ id: "C1", statement: "Two amounts", factIds: ["F-aaaa0001-001", "F-bbbb0002-001"] }],
  timeline: [{ date: "2026-01-01", asWritten: "Jan 1, 2026", statement: "Notice dated", factIds: ["F-aaaa0001-001"] }],
  gaps: [
    {
      id: "X1",
      statement: "Missing ledger",
      relatedSpineIds: ["S1"],
      kind: null,
      title: "",
      why: "",
      holder: "",
      when: null,
      basisType: null,
      relatedFactIds: [],
    },
  ],
};

describe("parseWriteOutput", () => {
  it("ignores unknown block names and dedupes block order", () => {
    const parsed = parseWriteOutput({
      sections: [{ heading: "Overview", paragraphs: [{ sentences: [{ text: "One case.", factIds: ["F-aaaa0001-001"] }] }] }],
      blocks: ["spine_table", "not_a_block", "documents", "spine_table"],
    });
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.value.blocks).toEqual(["spine_table", "documents"]);
    expect(parsed.malformed).toMatchObject({ block_name_unknown: 1, block_name_duplicate: 1 });
  });
});

describe("buildStudyView", () => {
  it("drops uncited sentences and sentences whose fact ids are all unknown", () => {
    const write = {
      sections: [
        {
          heading: "Summary",
          paragraphs: [
            {
              sentences: [
                { text: "Kept with one good id.", factIds: ["F-aaaa0001-001", "F-made-up"] },
                { text: "Dropped with no ids.", factIds: [] },
                { text: "Dropped with only unknown ids.", factIds: ["F-nope"] },
              ],
            },
          ],
        },
      ],
      blocks: ["documents", "spine_table"] as const,
    };
    const { view, drops } = buildStudyView(study, write, FACTS);
    expect(view.schema).toBe(STUDY_VIEW_SCHEMA);
    expect(view.sections[0]!.paragraphs[0]!.sentences).toEqual([
      { text: "Kept with one good id.", factIds: ["F-aaaa0001-001"] },
    ]);
    expect(drops.sentencesDropped).toBe(2);
    expect(drops.unknownFactIdsStripped).toBe(2);
  });

  it("uses the default block order when the model returns no blocks", () => {
    const { view } = buildStudyView(study, { sections: [], blocks: [], components: [] }, FACTS);
    expect(view.blocks.map((b) => b.name)).toEqual(["documents", "spine_table", "conflicts", "timeline", "outside_spine"]);
  });

  it("keeps the model's block order and appends every block it left out", () => {
    const { view } = buildStudyView(study, { sections: [], blocks: ["documents"], components: [] }, FACTS);
    expect(view.blocks.map((b) => b.name)).toEqual(["documents", "spine_table", "conflicts", "timeline", "outside_spine"]);
    expect(view.spineSource).toBe("ANCHOR");
    expect(view.intent).toBeUndefined();
  });

  it("records the intent when given and how each spine value relates to its element", () => {
    const { view } = buildStudyView(study, { sections: [], blocks: [], components: [] }, FACTS, {}, { intent: "  What is owed?  " });
    expect(view.intent).toBe("What is owed?");
    const spine = view.blocks.find((b) => b.name === "spine_table")!;
    expect(spine.rows[0]!.values.map((v) => v.relation)).toEqual(["supporting", "contradicting"]);
  });

  it("links a request item to the supplied pages that refer to the missing document", () => {
    const { view } = buildStudyView(
      {
        ...study,
        gaps: [
          {
            id: "X1",
            statement: "The 2025 annual ledger (Exhibit C) is referred to but not supplied.",
            relatedSpineIds: [],
            kind: "REQUESTABLE_DOCUMENT",
            title: "2025 annual ledger (Exhibit C)",
            why: "Referred to but not supplied.",
            holder: "",
            when: null,
            basisType: "MENTIONED",
            relatedFactIds: [],
          },
        ],
      },
      { sections: [], blocks: [], components: [] },
      FACTS,
      {},
      {
        referencedDocuments: [
          { sourceDocumentId: "doc-a", description: "2025 annual ledger (Exhibit C)", page: 3, quote: "Exhibit C" },
          { sourceDocumentId: "doc-a", description: "Annual ledger, 2025", page: 3, quote: "the ledger" },
          { sourceDocumentId: "doc-b", description: "Signed lease", page: 1, quote: "the lease" },
        ],
      },
    );
    const item = view.components[0]!.items[0]!;
    expect(item.basis.type).toBe("MENTIONED");
    if (item.basis.type === "MENTIONED") {
      expect(item.basis.sourceRefs).toEqual([{ sourceDocumentId: "doc-a", pageNumber: 3, quote: "Exhibit C" }]);
    }
  });

  it("builds block rows from canonical ids with valueAsWritten and source refs", () => {
    const { view } = buildStudyView(
      study,
      { sections: [], blocks: ["documents", "spine_table", "conflicts"] as const, components: [] },
      FACTS,
    );
    const spine = view.blocks.find((b) => b.name === "spine_table")!;
    expect(spine.rows).toHaveLength(1);
    expect(spine.rows[0]!.id).toBe("S1");
    expect(spine.rows[0]!.values.map((v) => v.valueAsWritten)).toEqual(["$100.00", "$120.00"]);
    expect(spine.rows[0]!.values[0]!.sourceRef).toEqual({
      sourceDocumentId: "doc-a",
      pageNumber: 2,
      quote: "The fee is $100.00.",
    });
    const documents = view.blocks.find((b) => b.name === "documents")!;
    expect(documents.rows.map((r) => r.id)).toEqual(["doc-a"]);
  });

  it("matches a referenced document only on shared words, never on one common word", () => {
    const refs = [{ sourceDocumentId: "d", description: "Inspection checklist", page: 1, quote: "q" }];
    expect(matchReferencedDocuments("The move-in inspection checklist was not supplied.", refs)).toHaveLength(1);
    expect(matchReferencedDocuments("No inspection was recorded.", refs)).toHaveLength(0);
  });

  it("never throws on malformed write content", () => {
    expect(() => buildStudyView(study, { sections: [], blocks: ["spine_table"], components: [] }, [])).not.toThrow();
    const parsed = parseWriteOutput(null);
    expect(parsed.ok).toBe(false);
  });
});
