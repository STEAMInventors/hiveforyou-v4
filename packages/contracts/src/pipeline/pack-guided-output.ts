/**
 * Parses `hive.pack-guided-output/1` and resolves evidence-record digests.
 * The model cites digests. Hive recovers quotations and values from the frozen
 * index, the source snapshot, and the trusted extraction. A model quotation is rejected.
 * This module does not call a model, schedule windows, or accept a Study.
 */
import { computeSha256Digest, normalizeContentDigest } from "../source-documents/document-read-contracts";
import { packDigest } from "./domain-pack-compiler";
import type { StudyContractIssue, StudyContractResult } from "./effective-domain-pack";
import type { DocExtraction } from "./extraction-contracts";
import {
  EXTRACTION_EVIDENCE_VERIFICATION_SCHEMA,
  parseExtractionEvidenceVerification,
  parseVerifiedEvidenceIndex,
  type FrozenCasePage,
  type VerifiedEvidenceIndex,
} from "./extraction-evidence-trust";
import { CANONICAL_STUDY_SCHEMA } from "./canonical-study-contracts";
import {
  PACK_GUIDED_CANONICALIZE_PROMPT_ID,
  PACK_GUIDED_OUTPUT_SCHEMA,
  PACK_GUIDED_PROPOSAL_KINDS,
  PACK_GUIDED_RESOLUTION_SCHEMA,
  type PackGuidedProposalKind,
} from "./pack-guided-ids";
import type { CaseInvestigationSpecification } from "./study-engine-contracts";
import { checkQuote, normalizeQuoteText } from "./verify-quotes";

const ID = /^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const CLAIM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CONFIDENCE_KEYS = new Set(["confidence", "score", "probability"]);
const QUOTE_KEYS = new Set(["quote", "quotes", "quotation", "quotations", "citation", "citations", "pageText", "excerpt"]);
const VERDICT_KEYS = new Set(["verdict", "checklist", "checklistVerdict"]);
const VERDICT_VALUES = new Set(["SHOWN", "PARTLY_SHOWN", "NOT_SHOWN", "NOT_APPLICABLE"]);
const CALCULATION_KEYS = new Set(["result", "calculation", "calculationResult"]);

const MAX_PROPOSALS = 80;
const MAX_DIGESTS = 20;
const MAX_UNCERTAINTY = 400;
const MAX_CLAIM_KEYS = 30;
const MAX_CLAIM_STRING = 500;

export type ResolvedEvidenceReference = {
  recordDigest: string;
  extractionFactId: string;
  documentId: string;
  page: number;
  sourcePageDigest: string;
  quoteDigest: string;
  quote: string;
  value: string | null;
};

export type ResolvedPackGuidedProposal = {
  proposalId: string;
  clauseId: string;
  kind: PackGuidedProposalKind;
  claim: Record<string, string | number | boolean | null>;
  uncertainty: string | null;
  references: ResolvedEvidenceReference[];
  claimStatus: "NOT_ACCEPTED";
  studyStatus: "NOT_ACCEPTED";
};

/** Resolved proposals. Not a Canonical Study and not an accepted fact. */
export type PackGuidedResolution = {
  schema: typeof PACK_GUIDED_RESOLUTION_SCHEMA;
  promptId: typeof PACK_GUIDED_CANONICALIZE_PROMPT_ID;
  outputSchema: typeof PACK_GUIDED_OUTPUT_SCHEMA;
  digest: string;
  evidenceDigest: string;
  snapshotDigest: string;
  claimStatus: "NOT_ACCEPTED";
  studyStatus: "NOT_ACCEPTED";
  proposals: ResolvedPackGuidedProposal[];
};

type ParsedProposal = {
  proposalId: string;
  clauseId: string;
  kind: PackGuidedProposalKind;
  evidenceRecordDigests: string[];
  claim: Record<string, string | number | boolean | null>;
  uncertainty: string | null;
};

type ObjectMap = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);

function issue(into: StudyContractIssue[], code: string, path: string, message: string): void {
  into.push({ code, path, message });
}

function finish<T>(issues: StudyContractIssue[], value: T): StudyContractResult<T> {
  if (issues.length > 0) {
    const sorted = [...issues].sort((left, right) => (left.path + "\0" + left.code).localeCompare(right.path + "\0" + right.code));
    return { ok: false, issues: sorted };
  }
  return { ok: true, value };
}

function exactKeys(value: ObjectMap, allowed: readonly string[], path: string, issues: StudyContractIssue[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) issue(issues, "output_malformed", path + "." + key, "Field is not part of this output contract.");
  }
}

function claimScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= MAX_CLAIM_STRING);
}

function knownQuotes(extractions: readonly DocExtraction[]): Set<string> {
  const quotes = new Set<string>();
  const add = (quote: string | undefined) => {
    if (typeof quote === "string" && quote.trim() !== "") quotes.add(normalizeQuoteText(quote));
  };
  for (const extraction of extractions) {
    for (const fact of extraction.facts) for (const evidence of fact.evidence) add(evidence.quote);
    for (const field of extraction.emptyFields) add(field.quote);
    for (const reference of extraction.referencedDocuments) add(reference.quote);
  }
  return quotes;
}

function readClaim(
  raw: unknown,
  path: string,
  quotes: ReadonlySet<string>,
  issues: StudyContractIssue[],
): Record<string, string | number | boolean | null> | null {
  if (!isObject(raw)) {
    issue(issues, "output_malformed", path, "Claim must be an object of plain values.");
    return null;
  }
  const keys = Object.keys(raw);
  if (keys.length > MAX_CLAIM_KEYS) {
    issue(issues, "output_malformed", path, "Claim has too many fields.");
    return null;
  }
  const claim: Record<string, string | number | boolean | null> = {};
  for (const key of keys) {
    if (QUOTE_KEYS.has(key)) {
      issue(issues, "model_quotation", path + "." + key, "The model cannot supply a quotation.");
      continue;
    }
    if (VERDICT_KEYS.has(key)) {
      issue(issues, "checklist_verdict", path + "." + key, "A checklist verdict is not model output.");
      continue;
    }
    if (CONFIDENCE_KEYS.has(key)) {
      issue(issues, "output_malformed", path + "." + key, "Model confidence is not evidence.");
      continue;
    }
    if (!CLAIM_KEY.test(key)) {
      issue(issues, "output_malformed", path + "." + key, "Claim field name is not allowed.");
      continue;
    }
    const value = raw[key];
    if (!claimScalar(value)) {
      issue(issues, "output_malformed", path + "." + key, "Claim values must be plain JSON scalars.");
      continue;
    }
    if (typeof value === "string" && VERDICT_VALUES.has(value)) {
      issue(issues, "checklist_verdict", path + "." + key, "A checklist verdict is not model output.");
      continue;
    }
    if (typeof value === "string" && quotes.has(normalizeQuoteText(value))) {
      issue(issues, "model_quotation", path + "." + key, "The model cannot repeat a source quotation.");
      continue;
    }
    claim[key] = value;
  }
  return claim;
}

function parseOutput(raw: unknown, quotes: ReadonlySet<string>): StudyContractResult<ParsedProposal[]> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(raw)) return finish([{ code: "output_malformed", path: "$", message: "Expected an object." }], undefined as never);
  if (raw.schema === CANONICAL_STUDY_SCHEMA || ("spine" in raw && "checklist" in raw)) {
    return finish([{ code: "canonical_study_forbidden", path: "$.schema", message: "A Canonical Study is not this output." }], undefined as never);
  }
  exactKeys(raw, ["schema", "proposals"], "$", issues);
  if (raw.schema !== PACK_GUIDED_OUTPUT_SCHEMA) issue(issues, "output_malformed", "$.schema", "Unsupported output schema.");
  if (!Array.isArray(raw.proposals) || raw.proposals.length > MAX_PROPOSALS) {
    issue(issues, "output_malformed", "$.proposals", "Proposals must be a bounded array.");
    return finish(issues, undefined as never);
  }
  const proposals: ParsedProposal[] = [];
  const seen = new Set<string>();
  raw.proposals.forEach((item, index) => {
    const path = "$.proposals[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "output_malformed", path, "A proposal must be an object.");
      return;
    }
    exactKeys(item, ["proposalId", "clauseId", "kind", "evidenceRecordDigests", "claim", "uncertainty"], path, issues);
    if (typeof item.proposalId !== "string" || !ID.test(item.proposalId) || typeof item.clauseId !== "string" || !ID.test(item.clauseId)) {
      issue(issues, "output_malformed", path, "Proposal and clause ids are required.");
      return;
    }
    if (seen.has(item.proposalId)) issue(issues, "output_malformed", path + ".proposalId", "Each proposal id is used once.");
    seen.add(item.proposalId);
    if (!(PACK_GUIDED_PROPOSAL_KINDS as readonly string[]).includes(String(item.kind))) {
      issue(issues, "output_malformed", path + ".kind", "Proposal kind is not part of this contract.");
      return;
    }
    if (!Array.isArray(item.evidenceRecordDigests) || item.evidenceRecordDigests.length > MAX_DIGESTS) {
      issue(issues, "output_malformed", path + ".evidenceRecordDigests", "Evidence references must be a bounded list of digests.");
      return;
    }
    const digests: string[] = [];
    const digestSeen = new Set<string>();
    item.evidenceRecordDigests.forEach((digest, digestIndex) => {
      if (typeof digest !== "string" || !DIGEST.test(digest) || digestSeen.has(digest)) {
        issue(issues, "citation_unresolved", path + ".evidenceRecordDigests[" + digestIndex + "]", "Evidence reference must be a digest from the verified index.");
        return;
      }
      digestSeen.add(digest);
      digests.push(digest);
    });
    const uncertainty = item.uncertainty === null ? null : item.uncertainty;
    if (uncertainty !== null && (typeof uncertainty !== "string" || uncertainty.trim() === "" || uncertainty.length > MAX_UNCERTAINTY || /[\u0000-\u001F\u007F]/.test(uncertainty))) {
      issue(issues, "output_malformed", path + ".uncertainty", "Uncertainty must be short plain text or null.");
    } else if (typeof uncertainty === "string" && quotes.has(normalizeQuoteText(uncertainty))) {
      issue(issues, "model_quotation", path + ".uncertainty", "Uncertainty cannot be a source quotation.");
    }
    const beforeClaim = issues.length;
    const claim = readClaim(item.claim, path + ".claim", quotes, issues);
    if (!claim || issues.length > beforeClaim) return;
    proposals.push({
      proposalId: item.proposalId,
      clauseId: item.clauseId,
      kind: item.kind as PackGuidedProposalKind,
      evidenceRecordDigests: digests,
      claim,
      uncertainty: typeof uncertainty === "string" ? uncertainty.trim() : null,
    });
  });
  if (issues.length > 0 || proposals.length !== raw.proposals.length) return finish(issues, undefined as never);
  return finish(issues, proposals);
}

function valueFor(extractions: readonly DocExtraction[], factId: string): string | null {
  for (const extraction of extractions) {
    const fact = extraction.facts.find((item) => item.id === factId);
    if (fact && fact.valueAsWritten.trim() !== "") return fact.valueAsWritten;
  }
  return null;
}

function quoteFor(extractions: readonly DocExtraction[], factId: string, quoteDigest: string): string | null {
  const candidates: string[] = [];
  for (const extraction of extractions) {
    for (const fact of extraction.facts) {
      if (fact.id !== factId) continue;
      for (const evidence of fact.evidence) candidates.push(evidence.quote);
    }
    for (const field of extraction.emptyFields) {
      if (field.id === factId) candidates.push(field.quote);
    }
    for (const reference of extraction.referencedDocuments) {
      if (reference.id === factId) candidates.push(reference.quote);
    }
  }
  return candidates.find((quote) => packDigest(normalizeQuoteText(quote)) === quoteDigest) ?? null;
}

function resolveDigest(
  digest: string,
  index: VerifiedEvidenceIndex,
  pages: ReadonlyMap<string, FrozenCasePage>,
  extractions: readonly DocExtraction[],
  path: string,
  issues: StudyContractIssue[],
): ResolvedEvidenceReference | null {
  const record = index.records.find((item) => item.recordDigest === digest) ?? null;
  if (!record || record.outcome !== "QUOTE_MATCHED" || record.page === null || record.sourcePageDigest === null || record.quoteDigest === null) {
    issue(issues, "citation_unresolved", path, "Evidence digest is not in the frozen index.");
    return null;
  }
  const page = pages.get(record.documentId + "\0" + record.page) ?? null;
  const declared = page ? normalizeContentDigest(page.sourcePageDigest) : null;
  if (!page || declared !== record.sourcePageDigest || computeSha256Digest(page.text) !== record.sourcePageDigest) {
    issue(issues, "citation_stale", path, "Evidence digest does not match the frozen source snapshot.");
    return null;
  }
  const quote = quoteFor(extractions, record.extractionFactId, record.quoteDigest);
  const pageMap = new Map([[page.pageNumber, normalizeQuoteText(page.text)]]);
  if (!quote || checkQuote({ page: page.pageNumber, quote }, pageMap) !== null) {
    issue(issues, "citation_mismatch", path, "The trusted record does not recover this quotation.");
    return null;
  }
  return {
    recordDigest: record.recordDigest,
    extractionFactId: record.extractionFactId,
    documentId: record.documentId,
    page: record.page,
    sourcePageDigest: record.sourcePageDigest,
    quoteDigest: record.quoteDigest,
    quote,
    value: valueFor(extractions, record.extractionFactId),
  };
}

function supportShape(proposal: ParsedProposal): "cited" | "uncertain" | "invalid" {
  const cited = proposal.evidenceRecordDigests.length > 0;
  const uncertain = proposal.uncertainty !== null;
  if (cited === uncertain) return "invalid";
  return cited ? "cited" : "uncertain";
}

export function packGuidedResolutionDigest(resolution: Omit<PackGuidedResolution, "digest">): string {
  return packDigest(resolutionBody(resolution));
}

function resolutionBody(resolution: Omit<PackGuidedResolution, "digest">): unknown {
  return {
    schema: resolution.schema,
    promptId: resolution.promptId,
    outputSchema: resolution.outputSchema,
    evidenceDigest: resolution.evidenceDigest,
    snapshotDigest: resolution.snapshotDigest,
    claimStatus: resolution.claimStatus,
    studyStatus: resolution.studyStatus,
    proposals: resolution.proposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      clauseId: proposal.clauseId,
      kind: proposal.kind,
      claimDigest: packDigest(proposal.claim),
      uncertaintyDigest: proposal.uncertainty === null ? null : packDigest(proposal.uncertainty),
      references: proposal.references.map((reference) => ({
        recordDigest: reference.recordDigest,
        extractionFactId: reference.extractionFactId,
        documentId: reference.documentId,
        page: reference.page,
        sourcePageDigest: reference.sourcePageDigest,
        quoteDigest: reference.quoteDigest,
      })),
      claimStatus: proposal.claimStatus,
      studyStatus: proposal.studyStatus,
    })),
  };
}

export function resolvePackGuidedOutput(input: {
  output: unknown;
  specification: CaseInvestigationSpecification;
  questionObligationIds: readonly string[];
  evidence: VerifiedEvidenceIndex;
  pages: readonly FrozenCasePage[];
  extractions: readonly DocExtraction[];
}): StudyContractResult<PackGuidedResolution> {
  const quotes = knownQuotes(input.extractions);
  const parsed = parseOutput(input.output, quotes);
  if (!parsed.ok) return parsed;
  const issues: StudyContractIssue[] = [];
  const clauseKind = new Map(input.specification.clauses.map((clause) => [clause.definitionId, clause.kind]));
  const obligations = [...input.questionObligationIds];
  const answered = new Map<string, number>();
  const pages = new Map(input.pages.map((page) => [page.documentId.toLowerCase() + "\0" + page.pageNumber, { ...page, documentId: page.documentId.toLowerCase() }]));
  const proposals: ResolvedPackGuidedProposal[] = [];
  parsed.value.forEach((proposal, index) => {
    const path = "$.proposals[" + index + "]";
    const kind = clauseKind.get(proposal.clauseId);
    if (!kind) {
      issue(issues, "output_malformed", path + ".clauseId", "Clause is not in the specification.");
      return;
    }
    if (kind === "calculation" || Object.keys(proposal.claim).some((key) => CALCULATION_KEYS.has(key))) {
      issue(issues, "calculation_forbidden", path, "A calculation result is not model output.");
      return;
    }
    const shape = supportShape(proposal);
    if (shape === "invalid") {
      issue(issues, "output_malformed", path, "A proposal cites evidence or states uncertainty, not both and not neither.");
      return;
    }
    const questionId = proposal.claim.questionId;
    if (proposal.kind === "STATEMENT" && typeof questionId === "string") {
      if (!obligations.includes(questionId) || questionId !== proposal.clauseId) {
        issue(issues, "output_malformed", path + ".claim.questionId", "Question id is not a mandatory obligation on this clause.");
        return;
      }
      answered.set(questionId, (answered.get(questionId) ?? 0) + 1);
    }
    if (proposal.kind !== "GAP" && proposal.kind !== "STATEMENT" && shape !== "cited") {
      issue(issues, "citation_unresolved", path + ".evidenceRecordDigests", "This proposal needs an evidence-record digest.");
      return;
    }
    const references: ResolvedEvidenceReference[] = [];
    if (shape === "cited") {
      for (const digest of proposal.evidenceRecordDigests) {
        const resolved = resolveDigest(digest, input.evidence, pages, input.extractions, path + ".evidenceRecordDigests", issues);
        if (resolved) references.push(resolved);
      }
    }
    if (issues.some((entry) => entry.path.startsWith(path))) return;
    proposals.push({
      proposalId: proposal.proposalId,
      clauseId: proposal.clauseId,
      kind: proposal.kind,
      claim: proposal.claim,
      uncertainty: proposal.uncertainty,
      references,
      claimStatus: "NOT_ACCEPTED",
      studyStatus: "NOT_ACCEPTED",
    });
  });
  for (const questionId of obligations) {
    const count = answered.get(questionId) ?? 0;
    if (count !== 1) issue(issues, "mandatory_answer_missing", "$.proposals", "Each mandatory question needs one answer.");
  }
  if (issues.length > 0) return finish(issues, undefined as never);
  const built: Omit<PackGuidedResolution, "digest"> = {
    schema: PACK_GUIDED_RESOLUTION_SCHEMA,
    promptId: PACK_GUIDED_CANONICALIZE_PROMPT_ID,
    outputSchema: PACK_GUIDED_OUTPUT_SCHEMA,
    evidenceDigest: input.evidence.digest,
    snapshotDigest: input.evidence.snapshotDigest,
    claimStatus: "NOT_ACCEPTED",
    studyStatus: "NOT_ACCEPTED",
    proposals,
  };
  return finish(issues, { ...built, digest: packGuidedResolutionDigest(built) });
}

export function evidenceIndexOf(raw: unknown): StudyContractResult<VerifiedEvidenceIndex> {
  if (isObject(raw) && raw.schema === EXTRACTION_EVIDENCE_VERIFICATION_SCHEMA) {
    const parsed = parseExtractionEvidenceVerification(raw);
    if (!parsed.ok) return parsed;
    return { ok: true, value: parsed.value.index };
  }
  return parseVerifiedEvidenceIndex(raw);
}

export function diagnosticCode(issues: readonly StudyContractIssue[]): string {
  const order = [
    "canonical_study_forbidden",
    "checklist_verdict",
    "calculation_forbidden",
    "model_quotation",
    "citation_stale",
    "citation_mismatch",
    "citation_unresolved",
    "mandatory_answer_missing",
    "output_malformed",
  ];
  for (const code of order) {
    if (issues.some((item) => item.code === code)) return code;
  }
  return "output_malformed";
}
