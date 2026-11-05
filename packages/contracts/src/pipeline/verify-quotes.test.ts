import { describe, expect, it } from "vitest";

import { normalizeQuoteText as legacyNormalizeQuoteText } from "../analysis/study-verification";
import { validateDocExtraction } from "./extraction-contracts";
import { normalizeQuoteText, verifyExtraction } from "./verify-quotes";

const DOC_ID = "3f2a9c1e-0000-4000-8000-000000000001";

const PAGES = [
  {
    pageNumber: 1,
    text: [
      "NOTICE OF ACTION",
      "Your countable resources are $8,420.00. The limit for a household",
      "of one is $2,000.00.",
      "Service        Amount          Location",
      "Speech-Language Therapy   60 min/week   Therapy room",
      "Case worker: \u201CR. Okafor\u201D",
    ].join("\n"),
  },
  { pageNumber: 2, text: "You may appeal within 60 days of the date of this notice.\r\nSigned: ________" },
];

function extraction(facts: unknown[], extra: Record<string, unknown> = {}) {
  const result = validateDocExtraction(
    { facts, emptyFields: [], referencedDocuments: [], ...extra },
    { documentId: DOC_ID, fileName: "02_denial_notice.pdf", pageRange: null },
  );
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

const fact = (id: string, page: number, quote: string) => ({
  id,
  category: "x",
  subject: "s",
  attribute: "a",
  valueAsWritten: "v",
  modality: "stated",
  evidence: [{ page, quote }],
});

describe("normalizeQuoteText", () => {
  it("is the same function study verification uses", () => {
    expect(legacyNormalizeQuoteText).toBe(normalizeQuoteText);
    expect(normalizeQuoteText("  a\r\n b\u00A0\u201Cc\u201D  ")).toBe('a b "c"');
  });
});

describe("verifyExtraction", () => {
  it("keeps an exact quote and one that spans a line break", () => {
    const { extraction: out, stats } = verifyExtraction(
      extraction([
        fact("F001", 1, "Your countable resources are $8,420.00."),
        fact("F002", 1, "The limit for a household of one is $2,000.00."),
      ]),
      PAGES,
    );
    expect(out.facts.map((f) => f.modelId)).toEqual(["F001", "F002"]);
    expect(stats).toMatchObject({ factsIn: 2, factsKept: 2, evidenceDropped: 0, byReason: {} });
  });

  it("accepts a table row joined with | only when every cell is on the stated page", () => {
    const { extraction: out, stats } = verifyExtraction(
      extraction([
        fact("F001", 1, "Speech-Language Therapy | 60 min/week | Therapy room"),
        fact("F002", 1, "Speech-Language Therapy | 90 min/week | Therapy room"),
        fact("F003", 2, "Speech-Language Therapy | 60 min/week | Therapy room"),
      ]),
      PAGES,
    );
    expect(out.facts.map((f) => f.modelId)).toEqual(["F001"]);
    expect(stats.byReason).toEqual({ table_cell_not_found: 1, quote_on_other_page: 1 });
  });

  it("folds typographic quotes but rejects case changes, paraphrase, ellipses and unknown pages", () => {
    const { extraction: out, stats } = verifyExtraction(
      extraction([
        fact("F001", 1, 'Case worker: "R. Okafor"'),
        fact("F002", 1, "your countable resources are $8,420.00."),
        fact("F003", 1, "Your resources total $8,420.00."),
        fact("F004", 1, "Your countable resources ... $2,000.00."),
        fact("F005", 3, "Your countable resources are $8,420.00."),
        fact("F006", 2, "   "),
      ]),
      PAGES,
    );
    expect(out.facts.map((f) => f.modelId)).toEqual(["F001"]);
    expect(stats.byReason).toEqual({
      quote_case_mismatch: 1,
      quote_not_found: 1,
      quote_has_ellipsis: 1,
      page_not_provided: 1,
    });
    expect(stats.dropped.every((d) => d.itemDropped)).toBe(true);
  });

  it("keeps a fact with one surviving evidence item and drops only the bad item", () => {
    const input = extraction([
      {
        ...fact("F001", 1, "Your countable resources are $8,420.00."),
        evidence: [
          { page: 1, quote: "Your countable resources are $8,420.00." },
          { page: 2, quote: "Your countable resources are $8,420.00." },
        ],
      },
    ]);
    const { extraction: out, stats } = verifyExtraction(input, PAGES);
    expect(out.facts[0]!.evidence).toHaveLength(1);
    expect(stats).toMatchObject({ factsKept: 1, evidenceIn: 2, evidenceDropped: 1, byReason: { quote_on_other_page: 1 } });
    expect(stats.dropped[0]).toMatchObject({ itemId: "F001", page: 2, itemDropped: false });
  });

  it("applies the same rule to empty fields, referenced documents and header evidence", () => {
    const input = extraction([], {
      emptyFields: [
        { id: "E001", label: "Signed", page: 2, quote: "Signed: ________" },
        { id: "E002", label: "Date", page: 2, quote: "Date: ____" },
      ],
      referencedDocuments: [
        { id: "R001", description: "notice", page: 2, quote: "the date of this notice" },
        { id: "R002", description: "letter", page: 1, quote: "your letter of May 1" },
      ],
      document: {
        issuer: { name: "Agency", evidence: [{ page: 1, quote: "NOTICE OF ACTION" }] },
        keyDates: [{ kind: "deadline", asWritten: "60 days", evidence: [{ page: 1, quote: "within 60 days" }] }],
      },
    });
    const { extraction: out, stats } = verifyExtraction(input, PAGES);
    expect(out.emptyFields.map((e) => e.modelId)).toEqual(["E001"]);
    expect(out.referencedDocuments.map((r) => r.modelId)).toEqual(["R001"]);
    expect(out.document.issuer?.evidence).toHaveLength(1);
    expect(out.document.keyDates).toEqual([]);
    expect(stats.emptyFields).toEqual({ in: 2, kept: 1 });
    expect(stats.referencedDocuments).toEqual({ in: 2, kept: 1 });
    expect(stats.documentEvidence).toEqual({ in: 2, kept: 1 });
    expect(stats.evidenceDropped).toBe(0);
  });
});
