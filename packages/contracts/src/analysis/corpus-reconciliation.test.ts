import { describe, expect, it } from "vitest";

import {
  corpusInventoryProblem,
  documentClassificationProblem,
  documentDispositionProblem,
  evidenceNeedsProblem,
  hasUnresolvedDocumentNote,
  isMeaningfulText,
  unresolvedDocumentNote,
} from "./corpus-reconciliation";

const DOC = "11111111-0000-4000-8000-000000000001";
const OTHER = "11111111-0000-4000-8000-000000000002";

const classification = (overrides: Partial<Parameters<typeof documentClassificationProblem>[0]> = {}) =>
  documentClassificationProblem({
    sourceDocumentId: DOC,
    role: "SUPPORTING",
    documentType: "Lease agreement",
    roleReasoning: "Sets the rent the invoices are measured against.",
    evidenceCount: 1,
    nonEmptyPageCount: 2,
    nonEmptyPagesRead: 1,
    ...overrides,
  });

const disposition = (overrides: Partial<Parameters<typeof documentDispositionProblem>[0]> = {}) =>
  documentDispositionProblem({
    sourceDocumentId: DOC,
    documentType: "Lease agreement",
    evidenceCount: 1,
    disposition: "MATERIAL_FINDINGS_RECORDED",
    findings: [{ id: "DF1", sourceDocumentId: DOC }],
    reason: null,
    documentFindingCount: 1,
    nonEmptyPagesRead: 1,
    ...overrides,
  });

const needs = (overrides: Partial<Parameters<typeof evidenceNeedsProblem>[0]> = {}) =>
  evidenceNeedsProblem({
    planQuestionId: "P1",
    answerStatus: "ANSWERED",
    uncertaintyCount: 0,
    limitationCount: 0,
    needs: [{ need: "Monthly rent amount", status: "FOUND", referenceCount: 1, explanation: null }],
    ...overrides,
  });

describe("isMeaningfulText", () => {
  it("accepts words and rejects blanks, symbols and placeholders", () => {
    expect(isMeaningfulText("Invoice")).toBe(true);
    expect(isMeaningfulText("IEP")).toBe(true);
    for (const value of [undefined, null, "", "  ", "--", "ab", "Unknown", "N/A", "none.", "TBD", "other", "Document"]) {
      expect(isMeaningfulText(value)).toBe(false);
    }
  });
});

describe("documentClassificationProblem", () => {
  it("accepts a meaningful type with evidence, and UNDETERMINED only with role UNCERTAIN", () => {
    expect(classification()).toBeNull();
    expect(classification({ role: "UNCERTAIN", documentType: "UNDETERMINED", evidenceCount: 0 })).toBeNull();
    expect(classification({ role: "REFERENCE", documentType: "UNDETERMINED" })?.code).toBe("document_description_unusable");
  });

  it("never lets a placeholder stand in for a type or reasoning", () => {
    expect(classification({ documentType: "unknown" })?.code).toBe("document_description_unusable");
    expect(classification({ roleReasoning: "n/a" })?.code).toBe("document_description_unusable");
  });

  it("requires evidence for a determined type, and a read page before an evidence-free UNDETERMINED", () => {
    expect(classification({ evidenceCount: 0 })?.code).toBe("document_evidence_missing");
    expect(
      classification({ role: "UNCERTAIN", documentType: "UNDETERMINED", evidenceCount: 0, nonEmptyPagesRead: 0 })?.code,
    ).toBe("document_not_reviewed");
  });

  it("accepts a blank document as UNDETERMINED without any read", () => {
    expect(
      classification({ role: "UNCERTAIN", documentType: "UNDETERMINED", evidenceCount: 0, nonEmptyPageCount: 0, nonEmptyPagesRead: 0 }),
    ).toBeNull();
  });
});

describe("documentDispositionProblem", () => {
  it("requires same-document findings for MATERIAL_FINDINGS_RECORDED", () => {
    expect(disposition()).toBeNull();
    expect(disposition({ findings: [] })?.code).toBe("disposition_inconsistent");
    expect(disposition({ findings: [{ id: "DF2", sourceDocumentId: OTHER }] })?.code).toBe("finding_other_document");
  });

  it("allows NO_MATERIAL_FINDINGS after any read, with a reason, when nothing was recorded", () => {
    const none = { disposition: "NO_MATERIAL_FINDINGS" as const, findings: [], documentFindingCount: 0 };
    expect(disposition({ ...none, reason: "Cover letter with no terms relevant to the questions." })).toBeNull();
    expect(disposition({ ...none, reason: null })?.code).toBe("document_reconciliation_invalid");
    expect(disposition({ ...none, reason: "Not relevant here.", documentFindingCount: 2 })?.code).toBe("disposition_inconsistent");
    expect(disposition({ ...none, reason: "Not relevant here.", nonEmptyPagesRead: 0 })?.code).toBe("document_not_reviewed");
  });

  it("keeps UNDETERMINED or evidence-free documents UNRESOLVED, with a reason", () => {
    const undetermined = { documentType: "UNDETERMINED", evidenceCount: 0, findings: [], documentFindingCount: 0 };
    expect(disposition({ ...undetermined, disposition: "UNRESOLVED", reason: "Scanned page is illegible." })).toBeNull();
    expect(disposition({ ...undetermined, disposition: "UNRESOLVED", reason: "  " })?.code).toBe("document_reconciliation_invalid");
    expect(disposition({ ...undetermined, disposition: "NO_MATERIAL_FINDINGS", reason: "Nothing here." })?.code).toBe(
      "disposition_inconsistent",
    );
    expect(disposition({ evidenceCount: 0 })?.code).toBe("disposition_inconsistent");
  });

  it("lets a classified document stay UNRESOLVED with partial same-document findings", () => {
    expect(disposition({ disposition: "UNRESOLVED", reason: "Pages 3-9 were not examined within the budget." })).toBeNull();
  });
});

describe("evidenceNeedsProblem", () => {
  it("requires at least one meaningful need", () => {
    expect(needs()).toBeNull();
    expect(needs({ needs: [] })?.code).toBe("evidence_needs_missing");
    expect(needs({ needs: [{ need: "x", status: "FOUND", referenceCount: 1, explanation: null }] })?.code).toBe("evidence_needs_missing");
  });

  it("requires FOUND to cite verified references", () => {
    expect(needs({ needs: [{ need: "Monthly rent amount", status: "FOUND", referenceCount: 0, explanation: null }] })?.code).toBe(
      "evidence_need_unsupported",
    );
  });

  it("requires NOT_FOUND to be explained and surfaced as a limitation", () => {
    const notFound = { need: "Late-fee clause", status: "NOT_FOUND" as const, referenceCount: 0 };
    const base = { answerStatus: "MISSING_EVIDENCE" as const };
    expect(needs({ ...base, needs: [{ ...notFound, explanation: null }], limitationCount: 1 })?.code).toBe("evidence_need_unexplained");
    expect(needs({ ...base, needs: [{ ...notFound, explanation: "Not in the examined lease pages." }] })?.code).toBe(
      "evidence_need_limitation_missing",
    );
    expect(needs({ ...base, needs: [{ ...notFound, explanation: "Not in the examined lease pages." }], limitationCount: 1 })).toBeNull();
  });

  it("accepts UNCERTAIN with an uncertainty, and NOT_REQUIRED with an explanation", () => {
    expect(
      needs({
        answerStatus: "PARTIALLY_ANSWERED",
        uncertaintyCount: 1,
        needs: [{ need: "Payment date", status: "UNCERTAIN", referenceCount: 0, explanation: "Two dates are handwritten." }],
      }),
    ).toBeNull();
    expect(
      needs({
        needs: [
          { need: "Monthly rent amount", status: "FOUND", referenceCount: 2, explanation: null },
          { need: "Currency conversion", status: "NOT_REQUIRED", referenceCount: 0, explanation: "All amounts use one currency." },
        ],
      }),
    ).toBeNull();
  });

  it("never forces a missing-evidence claim, but keeps the status consistent with the needs", () => {
    expect(
      needs({ needs: [{ need: "Monthly rent amount", status: "NOT_REQUIRED", referenceCount: 0, explanation: "Asked only about dates." }] })
        ?.code,
    ).toBe("evidence_need_status_inconsistent");
    expect(needs({ answerStatus: "MISSING_EVIDENCE" })?.code).toBe("evidence_need_status_inconsistent");
    expect(needs({ answerStatus: "PARTIALLY_ANSWERED" })).toBeNull();
  });
});

describe("corpusInventoryProblem", () => {
  const authorizedDocumentIds = [DOC, OTHER];
  it("names unrecorded documents first, then unreconciled ones", () => {
    expect(corpusInventoryProblem({ authorizedDocumentIds, recordedDocumentIds: new Set([DOC]) })).toMatchObject({
      code: "documents_unrecorded",
      message: expect.stringContaining(OTHER),
    });
    expect(corpusInventoryProblem({ authorizedDocumentIds, recordedDocumentIds: new Set([DOC, OTHER]) })).toBeNull();
    expect(
      corpusInventoryProblem({ authorizedDocumentIds, recordedDocumentIds: new Set([DOC, OTHER]), reconciledDocumentIds: new Set([OTHER]) }),
    ).toMatchObject({ code: "documents_unreconciled", message: expect.stringContaining(DOC) });
  });
});

describe("unresolved document notes", () => {
  it("are deterministic, bounded and recognizable", () => {
    const note = unresolvedDocumentNote(DOC, "UNDETERMINED", "Scanned page is illegible.");
    expect(note).toBe(`Unresolved document ${DOC} (type undetermined): Scanned page is illegible.`);
    expect(unresolvedDocumentNote(DOC, "Invoice", "x".repeat(900))).toHaveLength(600);
    expect(hasUnresolvedDocumentNote([note], DOC)).toBe(true);
    expect(hasUnresolvedDocumentNote([note], OTHER)).toBe(false);
  });
});
