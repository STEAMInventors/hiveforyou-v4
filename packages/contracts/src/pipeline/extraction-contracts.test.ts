import { describe, expect, it } from "vitest";

import { assignFactIds, DOC_EXTRACTION_SCHEMA, documentKeyFor, validateDocExtraction } from "./extraction-contracts";

const DOC_ID = "3F2A9C1E-0000-4000-8000-000000000001";
const expected = { documentId: DOC_ID, fileName: "a.pdf", pageRange: null };
const good = (id: string) => ({
  id,
  category: "income",
  subject: "Monthly income",
  attribute: "amount",
  value: 1200,
  valueAsWritten: "$1,200.00",
  modality: "Stated",
  evidence: [{ page: 1, quote: "Monthly income $1,200.00", printedPageLabel: "3" }],
  confidence: "high",
  surprise: "ignored",
});

describe("validateDocExtraction", () => {
  it("fails only on a missing or non-object root", () => {
    for (const raw of [null, undefined, "text", [], 3]) {
      expect(validateDocExtraction(raw, expected)).toMatchObject({ ok: false, reason: "extraction_root_invalid" });
    }
    const empty = validateDocExtraction({}, expected);
    expect(empty.ok && empty.value).toMatchObject({
      schema: DOC_EXTRACTION_SCHEMA,
      documentId: DOC_ID,
      facts: [],
      coverage: { pageCount: 0, pagesRead: [], truncated: false },
    });
  });

  it("drops and counts malformed facts, keeps good ones and ignores unknown keys", () => {
    const result = validateDocExtraction(
      {
        documentId: "model-made-this-up",
        facts: [
          good("F001"),
          "not a fact",
          { ...good("F003"), evidence: [] },
          { ...good("F004"), evidence: [{ page: 0, quote: "x" }] },
          { ...good("F005"), valueAsWritten: "" },
          { ...good("F006"), modality: "certain" },
          { ...good("F007"), tableContext: { columns: ["Service", 3, "Amount"] }, value: { nested: true } },
        ],
        emptyFields: [{ id: "E001", label: "Date", page: 2, quote: "Date:" }, { id: "E002", label: "x" }],
        glossary: [{ term: "WPM", expansion: "Widgets per minute", source: "general_knowledge" }, {}],
      },
      expected,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.factsProposed).toBe(7);
    expect(result.value.documentId).toBe(DOC_ID);
    expect(result.value.facts.map((f) => f.modelId)).toEqual(["F001", "F007"]);
    expect(result.value.facts[0]).toMatchObject({ modality: "stated", evidence: [{ printedPageLabel: "3" }] });
    expect(result.value.facts[0]).not.toHaveProperty("surprise");
    expect(result.value.facts[1]).toMatchObject({ tableContext: { columns: ["Service", "Amount"] }, value: null });
    expect(result.malformed).toEqual({
      fact_not_object: 1,
      fact_evidence_missing: 2,
      fact_value_as_written_missing: 1,
      fact_modality_invalid: 1,
      empty_field_malformed: 1,
      glossary_malformed: 1,
    });
  });
});

describe("assignFactIds", () => {
  it("derives a short key from the document id and numbers items in order", () => {
    expect(documentKeyFor(DOC_ID)).toBe("3f2a9c1e");
    expect(() => documentKeyFor("not-a-uuid")).toThrow("document_id_invalid");
    const result = validateDocExtraction(
      {
        facts: [good("F001"), good("p21-40:F001")],
        emptyFields: [{ id: "E001", label: "Date", page: 2, quote: "Date:" }],
        referencedDocuments: [{ id: "R001", description: "plan", page: 1, quote: "prior plan" }],
      },
      expected,
    );
    if (!result.ok) throw new Error("expected ok");
    const out = assignFactIds(result.value, documentKeyFor(DOC_ID));
    expect(out.facts.map((f) => [f.id, f.modelId])).toEqual([
      ["F-3f2a9c1e-001", "F001"],
      ["F-3f2a9c1e-002", "p21-40:F001"],
    ]);
    expect(out.emptyFields[0]!.id).toBe("E-3f2a9c1e-001");
    expect(out.referencedDocuments[0]!.id).toBe("R-3f2a9c1e-001");
  });

  it("assigns person ids, merges people by normalized name and rewrites aboutPersonRef", () => {
    const person = (ref: string | null, nameAsWritten: string, role: string, page: number) => ({
      ref,
      nameAsWritten,
      role,
      evidence: [{ page, quote: `${nameAsWritten} q${page}` }],
    });
    const result = validateDocExtraction(
      {
        document: {
          aboutPeople: [
            person("P1", "Dana  Ruiz", "", 1),
            person("P2", "Lee Park", "parent", 1),
            person("P3", "dana ruiz", "operator", 2),
            person(null, "", "unnamed", 3),
            person("P5", "", "unnamed", 3),
          ],
        },
        facts: [
          { ...good("F001"), aboutPersonRef: "P3" },
          { ...good("F002"), aboutPersonRef: "P2" },
          { ...good("F003"), aboutPersonRef: "P9" },
          good("F004"),
        ],
      },
      expected,
    );
    if (!result.ok) throw new Error("expected ok");
    const out = assignFactIds(result.value, documentKeyFor(DOC_ID));
    expect(out.document.aboutPeople.map((p) => [p.ref, p.modelRefs, p.role, p.evidence.length])).toEqual([
      ["P-3f2a9c1e-001", ["P1", "P3"], "operator", 2],
      ["P-3f2a9c1e-002", ["P2"], "parent", 1],
      ["P-3f2a9c1e-003", [], "unnamed", 1],
      ["P-3f2a9c1e-004", ["P5"], "unnamed", 1],
    ]);
    expect(out.facts.map((f) => f.aboutPersonRef)).toEqual(["P-3f2a9c1e-001", "P-3f2a9c1e-002", null, null]);
  });
});
