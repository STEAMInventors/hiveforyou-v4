import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeSha256Digest } from "../source-documents/document-read-contracts";
import { CANONICAL_STUDY_SCHEMA } from "./canonical-study-contracts";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import { domainSourcePattern, evidenceBenefit, evidenceFiling, evidencePlan } from "./eval/synthetic-domain-fixtures";
import {
  EXTRACTION_EVIDENCE_AUDIT_KEYS,
  extractionEvidenceAuditMetadata,
  extractionEvidenceCanonicalJson,
  findVerifiedEvidence,
  parseEvidenceVerificationRecord,
  parseExtractionEvidenceVerification,
  verifyDocumentRoleEvidence,
  verifyExtractionEvidence,
  type ExtractionEvidenceVerification,
  type FrozenCasePage,
} from "./study-engine-contracts";

const DOC_IEP = "33333333-3333-4333-8333-333333333333";
const DOC_BANKRUPTCY = "44444444-4444-4444-8444-444444444444";
const DOC_MEDICAID = "66666666-6666-4666-8666-666666666666";
const DOC_OTHER = "77777777-7777-4777-8777-777777777777";
const DOC_MISSING = "88888888-8888-4888-8888-888888888888";

type Sample = { name: string; documentUuid: string; pageText: string; quote: string };

const OTHER_QUOTE = "The other record names room South.";

function fact(id: string, quote: string | null, page = 1, extra: ExtractionFact["evidence"] = []): ExtractionFact {
  const evidence = quote === null ? extra : [{ page, printedPageLabel: null, quote }, ...extra];
  return {
    id,
    modelId: id,
    category: "record",
    subject: "record",
    attribute: "value",
    value: quote,
    valueAsWritten: quote ?? "",
    unit: null,
    per: null,
    timeframe: { from: null, to: null, asWritten: null },
    modality: "stated",
    attributedTo: null,
    aboutPersonRef: null,
    tableContext: null,
    evidence,
    confidence: "high",
  };
}

function extraction(documentId: string, facts: ExtractionFact[], extras: Partial<Pick<DocExtraction, "emptyFields" | "referencedDocuments">> = {}): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId,
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
    facts,
    emptyFields: extras.emptyFields ?? [],
    referencedDocuments: extras.referencedDocuments ?? [],
    glossary: [],
    instructionsIgnored: [],
    coverage: { pageCount: 4, pagesRead: [87], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
  };
}

function page(documentId: string, pageNumber: number, text: string, sourcePageDigest = computeSha256Digest(text)): FrozenCasePage {
  return { documentId, pageNumber, text, sourcePageDigest };
}

function blankQuote(pageText: string): string {
  return pageText.replace(/\.$/, "").split(" ").slice(-3).join(" ");
}

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return into;
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
    return into;
  }
  for (const [key, child] of Object.entries(value)) {
    into.add(key);
    keysOf(child, into);
  }
  return into;
}

function verify(sample: Sample, quote = sample.quote): ExtractionEvidenceVerification {
  const result = verifyExtractionEvidence({
    extractions: [extraction(sample.documentUuid, [
      fact("fact:value", quote),
      fact("fact:folded", quote.replace("March ", "March\u00A0")),
    ], {
      emptyFields: [{ id: "field:blank", modelId: null, label: "blank", page: 1, quote: blankQuote(sample.pageText), gapKind: "empty" }],
      referencedDocuments: [{ id: "ref:record", modelId: null, description: "record", date: null, page: 1, quote: sample.quote }],
    })],
    pages: [page(sample.documentUuid, 1, sample.pageText)],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

describe("extraction evidence trust", () => {
  it("does not name a domain, record page examination, or accept a Study", () => {
    const source = readFileSync(new URL("./extraction-evidence-trust.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(domainSourcePattern);
    expect(source).not.toMatch(/read_pages|examinedPages|pagesRead|semanticCompleteness|canonical-study/);
    expect(source).not.toMatch(/"ACCEPTED"/);
    expect(CANONICAL_STUDY_SCHEMA).toBe("hive.canonical-study/1");
  });

  it.each([evidencePlan, evidenceFiling, evidenceBenefit])("verifies $name quotations through the same check", (sample) => {
    const first = verify(sample);
    const second = verify(sample);
    expect(second.digest).toBe(first.digest);
    expect(second.index.digest).toBe(first.index.digest);
    expect(first.claimStatus).toBe("NOT_ACCEPTED");
    expect(first.studyStatus).toBe("NOT_ACCEPTED");
    expect(first.index.studyStatus).toBe("NOT_ACCEPTED");
    expect(Object.isFrozen(first)).toBe(true);

    const kinds = first.index.records.map((record) => record.kind).sort();
    expect(kinds).toEqual(["BLANK_FIELD", "DOCUMENT_REFERENCE", "FACT", "FACT"]);
    expect(first.index.records.every((record) => record.outcome === "QUOTE_MATCHED" && record.reason === null)).toBe(true);
    expect(first.index.records.every((record) => record.sourcePageDigest === computeSha256Digest(sample.pageText))).toBe(true);
    expect(first.index.records.every((record) => record.documentId === sample.documentUuid && record.page === 1)).toBe(true);
    expect(first.unavailable).toEqual([]);

    const body = JSON.stringify(first);
    expect(body).not.toContain(sample.quote);
    expect(body).not.toContain(sample.pageText);
    expect(body).not.toContain("high");
    const keys = keysOf(first);
    for (const key of ["quote", "text", "pagesRead", "examinedPages", "read_pages", "completeness", "confidence", "pageText"]) {
      expect(keys.has(key)).toBe(false);
    }

    const cited = findVerifiedEvidence(first.index, {
      documentId: sample.documentUuid,
      page: 1,
      extractionFactId: "fact:value",
      quote: sample.quote,
    });
    expect(cited.ok).toBe(true);
    if (!cited.ok) return;
    expect(cited.value?.extractionFactId).toBe("fact:value");
    expect(JSON.stringify(cited.value)).not.toContain(sample.quote);

    const folded = findVerifiedEvidence(first.index, {
      documentId: sample.documentUuid,
      page: 1,
      extractionFactId: "fact:folded",
      quote: sample.quote.replace("March ", "March\u00A0"),
    });
    expect(folded.ok).toBe(true);
    if (!folded.ok) return;
    expect(folded.value?.outcome).toBe("QUOTE_MATCHED");

    const missingQuote = findVerifiedEvidence(first.index, {
      documentId: sample.documentUuid,
      page: 1,
      extractionFactId: "fact:value",
      quote: "This sentence is not on the page.",
    });
    expect(missingQuote.ok).toBe(true);
    if (!missingQuote.ok) return;
    expect(missingQuote.value).toBeNull();

    const role = verifyDocumentRoleEvidence(first.index, {
      proposalId: "proposal:role",
      documentId: sample.documentUuid,
      extractionFactId: "fact:value",
      role: "role:source",
    });
    expect(role.ok).toBe(true);
    if (!role.ok) return;
    expect(role.value.evidenceStatus).toBe("VERIFIED");
    expect(role.value.roleStatus).toBe("NOT_ACCEPTED");
    expect(role.value.claimStatus).toBe("NOT_ACCEPTED");
    expect(role.value.studyStatus).toBe("NOT_ACCEPTED");
    expect(role.value.bindings).toEqual([{
      page: 1,
      sourcePageDigest: computeSha256Digest(sample.pageText),
      quoteDigest: first.index.records.find((record) => record.extractionFactId === "fact:value")?.quoteDigest,
    }]);
    expect(JSON.stringify(role.value)).not.toContain(sample.quote);
    const again = verifyDocumentRoleEvidence(first.index, {
      proposalId: "proposal:role",
      documentId: sample.documentUuid,
      extractionFactId: "fact:value",
      role: "role:source",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.digest).toBe(role.value.digest);

    const invented = verifyDocumentRoleEvidence(first.index, {
      proposalId: "proposal:role",
      documentId: sample.documentUuid,
      extractionFactId: "fact:value",
      role: "role:source",
      quote: sample.quote,
    });
    expect(invented.ok).toBe(false);
    if (invented.ok) return;
    expect(invented.issues.some((item) => item.code === "invented_quotation")).toBe(true);

    const proposalRecord = parseEvidenceVerificationRecord(first.index.records[0]);
    expect(proposalRecord.ok).toBe(false);

    const reordered = verifyExtractionEvidence({
      extractions: [...verifyInput(sample).extractions].reverse(),
      pages: [...verifyInput(sample).pages].reverse(),
    });
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) return;
    expect(reordered.value.digest).toBe(first.digest);

    const audit = extractionEvidenceAuditMetadata(first);
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    expect(Object.keys(audit.value).sort()).toEqual([...EXTRACTION_EVIDENCE_AUDIT_KEYS].sort());
    expect(JSON.stringify(audit.value)).not.toContain(sample.quote);
    expect(JSON.stringify(audit.value)).not.toContain(sample.pageText);
    const canonical = extractionEvidenceCanonicalJson(first);
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;
    expect(canonical.value).not.toContain(sample.quote);
    expect(canonical.value).not.toContain(sample.pageText);
  });

  it.each([evidencePlan, evidenceFiling])("withholds $name evidence that is not on the frozen page", (sample) => {
    const staleText = sample.pageText + " extra";
    const result = verifyExtractionEvidence({
      extractions: [
        extraction(sample.documentUuid, [
          fact("fact:valid", sample.quote),
          fact("fact:invalid", "This sentence is not on the page."),
          fact("fact:wrong-page", sample.quote, 2),
          fact("fact:other-document", OTHER_QUOTE),
          fact("fact:stale", sample.quote, 3),
          fact("fact:missing", null),
          fact("fact:mixed", sample.quote, 1, [{ page: 1, printedPageLabel: null, quote: "This sentence is not on the page." }]),
        ]),
        extraction(DOC_MISSING, [fact("fact:unauthorized", sample.quote)]),
      ],
      pages: [
        page(DOC_OTHER, 1, OTHER_QUOTE),
        page(sample.documentUuid, 2, "No citation is recorded here."),
        page(sample.documentUuid, 1, sample.pageText),
        page(sample.documentUuid, 3, staleText, computeSha256Digest(sample.pageText)),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repeated = verifyExtractionEvidence({
      extractions: [
        extraction(DOC_MISSING, [fact("fact:unauthorized", sample.quote)]),
        extraction(sample.documentUuid, [
          fact("fact:mixed", sample.quote, 1, [{ page: 1, printedPageLabel: null, quote: "This sentence is not on the page." }]),
          fact("fact:missing", null),
          fact("fact:stale", sample.quote, 3),
          fact("fact:other-document", OTHER_QUOTE),
          fact("fact:wrong-page", sample.quote, 2),
          fact("fact:invalid", "This sentence is not on the page."),
          fact("fact:valid", sample.quote),
        ]),
      ],
      pages: [
        page(sample.documentUuid, 3, staleText, computeSha256Digest(sample.pageText)),
        page(sample.documentUuid, 1, sample.pageText),
        page(sample.documentUuid, 2, "No citation is recorded here."),
        page(DOC_OTHER, 1, OTHER_QUOTE),
      ],
    });
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    expect(repeated.value.digest).toBe(result.value.digest);

    const outcome = (id: string) => [...result.value.index.records, ...result.value.unavailable].filter((record) => record.extractionFactId === id);
    expect(outcome("fact:valid").map((record) => record.outcome)).toEqual(["QUOTE_MATCHED"]);
    expect(result.value.index.records.some((record) => record.extractionFactId === "fact:valid")).toBe(true);
    expect(outcome("fact:invalid")).toMatchObject([{ outcome: "QUOTE_REJECTED", reason: "quote_not_found" }]);
    expect(outcome("fact:wrong-page")).toMatchObject([{ outcome: "QUOTE_REJECTED", reason: "quote_on_other_page" }]);
    expect(outcome("fact:other-document")).toMatchObject([{ outcome: "QUOTE_REJECTED", reason: "quote_on_other_document" }]);
    expect(outcome("fact:stale")).toMatchObject([{ outcome: "SOURCE_DIGEST_MISMATCH", reason: "source_digest_mismatch" }]);
    expect(outcome("fact:stale")[0]?.sourcePageDigest).toBe(computeSha256Digest(sample.pageText));
    expect(outcome("fact:missing")).toMatchObject([{ outcome: "CITATION_ABSENT", page: null, sourcePageDigest: null, quoteDigest: null }]);
    expect(outcome("fact:unauthorized")).toMatchObject([{ outcome: "UNAUTHORIZED_DOCUMENT", reason: "unauthorized_document", documentId: DOC_MISSING }]);
    const mixed = outcome("fact:mixed").map((record) => record.outcome).sort();
    expect(mixed).toEqual(["QUOTE_MATCHED", "QUOTE_REJECTED"]);
    for (const id of ["fact:invalid", "fact:wrong-page", "fact:other-document", "fact:stale", "fact:missing", "fact:unauthorized", "fact:mixed"]) {
      expect(result.value.index.records.some((record) => record.extractionFactId === id)).toBe(false);
    }
    expect(JSON.stringify(result.value)).not.toContain(sample.quote);
    expect(JSON.stringify(result.value)).not.toContain(OTHER_QUOTE);
    expect(keysOf(result.value).has("pagesRead")).toBe(false);
    expect(keysOf(result.value).has("examinedPages")).toBe(false);

    const accepted = verifyDocumentRoleEvidence(result.value.index, {
      proposalId: "proposal:valid",
      documentId: sample.documentUuid,
      extractionFactId: "fact:valid",
      role: "role:source",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value).toMatchObject({ evidenceStatus: "VERIFIED", roleStatus: "NOT_ACCEPTED", studyStatus: "NOT_ACCEPTED" });

    for (const extractionFactId of ["fact:invalid", "fact:mixed", "fact:missing", "fact:stale"]) {
      const refused = verifyDocumentRoleEvidence(result.value.index, {
        proposalId: "proposal:refused",
        documentId: sample.documentUuid,
        extractionFactId,
        role: "role:source",
      });
      expect(refused.ok).toBe(true);
      if (!refused.ok) return;
      expect(refused.value).toMatchObject({ evidenceStatus: "UNAVAILABLE", roleStatus: "NOT_ACCEPTED", bindings: [], studyStatus: "NOT_ACCEPTED" });
    }

    const cited = findVerifiedEvidence(result.value.index, {
      documentId: sample.documentUuid,
      page: 1,
      extractionFactId: "fact:mixed",
      quote: sample.quote,
    });
    expect(cited.ok).toBe(true);
    if (!cited.ok) return;
    expect(cited.value).toBeNull();
  });

  it("gives the same check different digests for different frozen pages", () => {
    const digests = [evidencePlan, evidenceFiling, evidenceBenefit].map((sample) => verify(sample).digest);
    expect(new Set(digests).size).toBe(3);
  });

  it("fails closed on a duplicate page or a digest that is not SHA-256", () => {
    const duplicate = verifyExtractionEvidence({
      extractions: [extraction(evidencePlan.documentUuid, [fact("fact:value", evidencePlan.quote)])],
      pages: [page(evidencePlan.documentUuid, 1, evidencePlan.pageText), page(evidencePlan.documentUuid, 1, evidencePlan.pageText)],
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.issues.some((item) => item.code === "duplicate_page")).toBe(true);

    const malformed = verifyExtractionEvidence({
      extractions: [extraction(evidencePlan.documentUuid, [fact("fact:value", evidencePlan.quote)])],
      pages: [page(evidencePlan.documentUuid, 1, evidencePlan.pageText, "sha256:not-a-digest")],
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.issues.some((item) => item.code === "digest_invalid")).toBe(true);
  });

  it("rejects a verification whose outcome was rewritten", () => {
    const verified = verify(evidencePlan);
    const tampered = structuredClone(verified) as ExtractionEvidenceVerification;
    const record = tampered.index.records[0];
    if (!record) throw new Error("expected a record");
    record.outcome = "QUOTE_REJECTED";
    const parsed = parseExtractionEvidenceVerification(tampered);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.some((item) => item.code === "digest_mismatch" || item.code === "outcome_mismatch" || item.code === "index_unavailable")).toBe(true);
  });
});

function verifyInput(sample: Sample): { extractions: DocExtraction[]; pages: FrozenCasePage[] } {
  return {
    extractions: [extraction(sample.documentUuid, [
      fact("fact:value", sample.quote),
      fact("fact:folded", sample.quote.replace("March ", "March\u00A0")),
    ], {
      emptyFields: [{ id: "field:blank", modelId: null, label: "blank", page: 1, quote: blankQuote(sample.pageText), gapKind: "empty" }],
      referencedDocuments: [{ id: "ref:record", modelId: null, description: "record", date: null, page: 1, quote: sample.quote }],
    })],
    pages: [page(sample.documentUuid, 1, sample.pageText)],
  };
}
