import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, parseCanonicalStudy, verifyCanonicalStudy } from "./canonical-study-contracts";

const KNOWN = new Set(["F-aaaa0001-001", "F-aaaa0001-002", "F-bbbb0002-001", "F-bbbb0002-002"]);

const answer = {
  domainLabel: "Some field",
  spineSource: "anchor_chain",
  documents: [
    { sourceDocumentId: "doc-1", role: "anchor", typeInPlainWords: "Revised schedule", date: "2026-03-02", version: "2", chainPosition: 2 },
    { sourceDocumentId: "doc-2", role: "BOSS", typeInPlainWords: "x" },
    "not a document",
  ],
  spine: [
    { id: "E7", label: "Current figure", kind: "figure", status: "current", supportingFactIds: ["F-aaaa0001-001", "F-made-up-999"] },
    { id: "E8", label: "Old figure", kind: "figure", status: "SUPERSEDED", supportingFactIds: ["F-zzzz"], updatingFactIds: ["F-aaaa0001-002"] },
    { id: "E9", label: "Only invented support", status: "SUPPORTED", supportingFactIds: ["F-nope-001"], contradictingFactIds: ["F-bbbb0002-001"] },
    { id: "E10", label: "", status: "OPEN" },
    { id: "E11", label: "Odd status", status: "MAYBE", supportingFactIds: ["F-bbbb0002-002"] },
  ],
  outsideSpine: [{ id: "q", statement: "Side note", factIds: ["F-nope-002"] }],
  conflicts: [
    { id: "K1", statement: "Two documents disagree", factIds: ["F-aaaa0001-001", "F-bbbb0002-001"] },
    { id: "K2", statement: "One real id left", factIds: ["F-aaaa0001-001", "F-nope-003"] },
    { statement: "" },
  ],
  timeline: [{ date: "March 2", asWritten: "March 2, 2026", statement: "Filed", factIds: ["F-bbbb0002-002"] }],
  gaps: [{ id: "G1", statement: "A referenced record is not in the case", relatedSpineIds: ["E9", "E99"] }],
};

describe("parseCanonicalStudy", () => {
  it("fails only on a missing or non-object root", () => {
    for (const raw of [null, undefined, "text", [], 3]) {
      expect(parseCanonicalStudy(raw)).toMatchObject({ ok: false, reason: "canonical_root_invalid" });
    }
    const empty = parseCanonicalStudy({});
    expect(empty.ok && empty.value).toEqual({
      schema: CANONICAL_STUDY_SCHEMA,
      documents: [],
      spineSource: null,
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [],
      domainLabel: "",
    });
  });

  it("assigns ids in order, ignores the model's ids and remaps gap references", () => {
    const parsed = parseCanonicalStudy(answer);
    if (!parsed.ok) throw new Error("expected ok");
    const study = parsed.value;
    expect(study.spineSource).toBe("ANCHOR_CHAIN");
    expect(study.documents).toEqual([
      { sourceDocumentId: "doc-1", role: "ANCHOR", typeInPlainWords: "Revised schedule", date: "2026-03-02", version: "2", chainPosition: 2 },
    ]);
    expect(study.spine.map((s) => [s.id, s.label, s.status])).toEqual([
      ["S1", "Current figure", "CURRENT"],
      ["S2", "Old figure", "SUPERSEDED"],
      ["S3", "Only invented support", "SUPPORTED"],
      ["S4", "Odd status", null],
    ]);
    expect(study.outsideSpine[0]!.id).toBe("O1");
    expect(study.conflicts.map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(study.timeline[0]).toEqual({ date: null, asWritten: "March 2, 2026", statement: "Filed", factIds: ["F-bbbb0002-002"] });
    expect(study.gaps).toEqual([
      {
        id: "X1",
        statement: "A referenced record is not in the case",
        relatedSpineIds: ["S3"],
        kind: null,
        title: "",
        why: "",
        holder: "",
        holderType: null,
        when: null,
        basisType: null,
        relatedFactIds: [],
      },
    ]);
    expect(parsed.malformed).toEqual({
      document_role_invalid: 1,
      document_not_object: 1,
      spine_label_missing: 1,
      spine_status_invalid: 1,
      conflicts_malformed: 1,
      gap_spine_ref_unknown: 1,
    });
  });
});

describe("verifyCanonicalStudy", () => {
  it("drops unknown fact ids, marks unsupported elements and drops thin conflicts, keeping everything else", () => {
    const parsed = parseCanonicalStudy(answer);
    if (!parsed.ok) throw new Error("expected ok");
    const { study, drops } = verifyCanonicalStudy(parsed.value, KNOWN);

    const [current, old, invented, odd] = study.spine;
    expect(current).toMatchObject({ status: "CURRENT", supportingFactIds: ["F-aaaa0001-001"] });
    expect(old).toMatchObject({ status: "SUPERSEDED", supportingFactIds: [], updatingFactIds: ["F-aaaa0001-002"] });
    expect(invented).toMatchObject({ status: "UNSUPPORTED", supportingFactIds: [], contradictingFactIds: ["F-bbbb0002-001"] });
    expect(odd).toMatchObject({ status: null, supportingFactIds: ["F-bbbb0002-002"] });

    expect(study.conflicts.map((c) => c.id)).toEqual(["C1"]);
    expect(study.outsideSpine).toEqual([{ id: "O1", statement: "Side note", factIds: [] }]);
    expect(study.timeline).toHaveLength(1);
    expect(study.gaps).toHaveLength(1);
    expect(study.documents).toHaveLength(1);

    expect(drops).toEqual({
      unknownFactIds: 5,
      unknownFactIdList: ["F-made-up-999", "F-zzzz", "F-nope-001", "F-nope-003", "F-nope-002"],
      spineMarkedUnsupported: 1,
      conflictsDropped: 1,
    });
  });

  it("does not count an element the model already called unsupported", () => {
    const parsed = parseCanonicalStudy({ spine: [{ label: "No basis", status: "UNSUPPORTED", missing: ["the record it relies on"] }] });
    if (!parsed.ok) throw new Error("expected ok");
    const { study, drops } = verifyCanonicalStudy(parsed.value, KNOWN);
    expect(study.spine[0]).toMatchObject({ status: "UNSUPPORTED", missing: ["the record it relies on"] });
    expect(drops.spineMarkedUnsupported).toBe(0);
  });
});
