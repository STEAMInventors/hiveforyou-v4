import { describe, expect, it } from "vitest";
import { computeSha256Digest } from "../source-documents/document-read-contracts";
import { compileDomainPack } from "./domain-pack-compiler";
import { DOMAIN_PACK_SOURCE_SCHEMA } from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import { diagnosticCode, resolvePackGuidedOutput } from "./pack-guided-output";
import { PACK_GUIDED_OUTPUT_SCHEMA } from "./pack-guided-ids";
import {
  compileEffectiveDomainPack,
  specifyCaseInvestigation,
  verifyExtractionEvidence,
  type ApplicabilityExpr,
  type CaseAttribute,
} from "./study-engine-contracts";
import { SYNTHETIC_EXECUTION_FIXTURES } from "./synthetic-execution-fixtures";

const QUESTION_ID = "question:written-date";
const fixture = SYNTHETIC_EXECUTION_FIXTURES[0]!;

function textEq(key: string, value: string): ApplicabilityExpr {
  return { op: "EQ", key, value: { type: "TEXT", value } };
}

function textAttr(key: string, value: string): CaseAttribute {
  return { key, value: { type: "TEXT", value }, verification: "REVIEWED" };
}

function fact(quote: string): ExtractionFact {
  return {
    id: fixture.factId,
    modelId: fixture.factId,
    category: "record",
    subject: "record",
    attribute: "value",
    value: "date-token",
    valueAsWritten: "date-token",
    unit: null,
    per: null,
    timeframe: { from: null, to: null, asWritten: null },
    modality: "stated",
    attributedTo: null,
    aboutPersonRef: null,
    tableContext: null,
    evidence: [{ page: 1, printedPageLabel: null, quote }],
    confidence: "high",
  };
}

function extraction(quote: string): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId: fixture.documentId,
    fileName: "record.txt",
    pageRange: null,
    document: {
      titleAsPrinted: "Record",
      documentType: "record",
      domain: { label: "record", confidence: "high" },
      issuer: null,
      aboutPeople: [],
      keyDates: [],
      summary: "",
    },
    facts: [fact(quote)],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
  };
}

function prepared(quote = fixture.quote) {
  const compiled = compileDomainPack({
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "synthetic-record", version: "1.0.0", title: "Synthetic record pack" },
    ownership: { scope: "PLATFORM", ownerId: "platform", authoredBy: "synthetic" },
    applicability: { jurisdiction: "US-FEDERAL", verification: "REVIEWED" },
    definitions: [
      { id: "entity:subject", kind: "entity", label: "Subject", fields: [{ id: "name", valueType: "TEXT" }] },
      { id: QUESTION_ID, kind: "question", label: "Written date", audience: "all", text: "What date is written?", appliesWhen: { op: "REVIEW_REQUIRED" } },
      { id: "calculation:declared", kind: "calculation", label: "Declared interval", operator: "DAYS_BETWEEN", inputFields: [], state: "DECLARATION_ONLY", legacyInputs: "two dates" },
    ],
    changes: [],
    review: { status: "REVIEWED", reviewerId: "reviewer", reviewedAt: "2026-11-27" },
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  const pack = compileEffectiveDomainPack({
    base: compiled.value,
    when: textEq("framework", "record"),
    attributes: [textAttr("framework", "record")],
  });
  if (!pack.ok) throw new Error(JSON.stringify(pack.issues));
  const specification = specifyCaseInvestigation({
    pack: pack.value,
    hiveId: fixture.hiveId,
    attributes: [textAttr("framework", "record")],
  });
  if (!specification.ok) throw new Error(JSON.stringify(specification.issues));
  const written = extraction(quote);
  const page = {
    documentId: fixture.documentId,
    pageNumber: 1,
    text: fixture.pageText,
    sourcePageDigest: computeSha256Digest(fixture.pageText),
  };
  const evidence = verifyExtractionEvidence({ extractions: [written], pages: [page] });
  if (!evidence.ok) throw new Error(JSON.stringify(evidence.issues));
  return { specification: specification.value, written, page, evidence: evidence.value };
}

function proposal(digest: string, claim: Record<string, string>, clauseId = QUESTION_ID) {
  return {
    schema: PACK_GUIDED_OUTPUT_SCHEMA,
    proposals: [{
      proposalId: "proposal:question",
      clauseId,
      kind: "STATEMENT",
      evidenceRecordDigests: [digest],
      claim,
      uncertainty: null,
    }],
  };
}

function codeOf(result: ReturnType<typeof resolvePackGuidedOutput>) {
  return result.ok ? "ok" : diagnosticCode(result.issues);
}

describe("pack-guided output resolution", () => {
  const base = prepared();
  const digest = base.evidence.index.records[0]?.recordDigest ?? "";
  const obligations = [QUESTION_ID];

  it("recovers the quotation from the trusted extraction", () => {
    const resolved = resolvePackGuidedOutput({
      output: proposal(digest, { questionId: QUESTION_ID }),
      specification: base.specification,
      questionObligationIds: obligations,
      evidence: base.evidence.index,
      pages: [base.page],
      extractions: [base.written],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.proposals[0]?.references[0]?.quote).toBe(fixture.quote);
    expect(resolved.value.proposals[0]?.references[0]?.value).toBe("date-token");
    expect(resolved.value.studyStatus).toBe("NOT_ACCEPTED");
  });

  it("rejects a page whose text no longer matches the frozen digest", () => {
    const resolved = resolvePackGuidedOutput({
      output: proposal(digest, { questionId: QUESTION_ID }),
      specification: base.specification,
      questionObligationIds: obligations,
      evidence: base.evidence.index,
      pages: [{ ...base.page, text: "A replaced page that is not the frozen snapshot." }],
      extractions: [base.written],
    });
    expect(codeOf(resolved)).toBe("citation_stale");
  });

  it("does not invent a quotation from the page when the extraction quote does not match", () => {
    const replaced = prepared("room is North");
    const resolved = resolvePackGuidedOutput({
      output: proposal(digest, { questionId: QUESTION_ID }),
      specification: base.specification,
      questionObligationIds: obligations,
      evidence: base.evidence.index,
      pages: [base.page],
      extractions: [replaced.written],
    });
    expect(codeOf(resolved)).toBe("citation_mismatch");
    expect(JSON.stringify(resolved)).not.toContain(fixture.quote);
  });

  it("rejects a calculation result, a checklist verdict, a model quotation, and a canonical study", () => {
    const shared = {
      specification: base.specification,
      questionObligationIds: obligations,
      evidence: base.evidence.index,
      pages: [base.page],
      extractions: [base.written],
    };
    expect(codeOf(resolvePackGuidedOutput({
      ...shared,
      output: proposal(digest, { questionId: QUESTION_ID, result: "12" }, "calculation:declared"),
    }))).toBe("calculation_forbidden");
    expect(codeOf(resolvePackGuidedOutput({
      ...shared,
      output: proposal(digest, { questionId: QUESTION_ID, status: "SHOWN" }),
    }))).toBe("checklist_verdict");
    expect(codeOf(resolvePackGuidedOutput({
      ...shared,
      output: proposal(digest, { questionId: QUESTION_ID, note: fixture.quote }),
    }))).toBe("model_quotation");
    expect(codeOf(resolvePackGuidedOutput({
      ...shared,
      output: { schema: "hive.canonical-study/1", spine: {}, checklist: {} },
    }))).toBe("canonical_study_forbidden");
  });
});
