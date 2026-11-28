/**
 * Shared contracts for one pack-guided Study path.
 * Domain differences stay in pack data and applicability expressions.
 * This module does not branch on a domain, call a model, schedule investigation
 * windows, evaluate Domain Pack rules, or accept a Study.
 * Prompt compilation is domain-prompt-compiler.ts. It does not call a model.
 * Pack-guided output resolution is pack-guided-output.ts. It does not accept a Study.
 * Study construction from that resolution is pack-guided-study.ts. The rebuild workflow calls that constructor.
 * Compiled pack snapshots and `checkQuote` are reused. A quote match is not a claim.
 * Citation coverage does not publish a Study.
 * Extraction evidence against frozen page digests is checked in extraction-evidence-trust.ts.
 * A matching quotation still does not accept a claim, a document role, or a Study.
 */
import { isValidUuid } from "../hives/hive-contracts";
import { canonicalizeApplicabilityExpr, evaluateApplicability, type ApplicabilityResult } from "./applicability-expression";
import { packDigest } from "./domain-pack-compiler";
import {
  compileEffectiveDomainPack,
  composeEffectiveDomainPack,
  EFFECTIVE_DOMAIN_PACK_SCHEMA,
  parseEffectiveDomainPack,
  readCaseAttributes,
  readClauseProvenance,
  type CaseAttribute,
  type ClauseProvenance,
  type EffectiveDomainPack,
  type PackLayerRef,
  type PackLayerRole,
  type StudyContractIssue,
  type StudyContractResult,
} from "./effective-domain-pack";
import { checkQuote, normalizeQuoteText, type QuoteRejectionReason, type VerificationPage } from "./verify-quotes";
export {
  DOCUMENT_ROLE_EVIDENCE_SCHEMA,
  EXTRACTION_EVIDENCE_AUDIT_KEYS,
  EXTRACTION_EVIDENCE_METHOD,
  EXTRACTION_EVIDENCE_RECORD_SCHEMA,
  EXTRACTION_EVIDENCE_VERIFICATION_SCHEMA,
  VERIFIED_EVIDENCE_INDEX_SCHEMA,
  extractionEvidenceAuditMetadata,
  extractionEvidenceCanonicalJson,
  findVerifiedEvidence,
  parseDocumentRoleEvidence,
  parseExtractionEvidenceVerification,
  parseVerifiedEvidenceIndex,
  verifyDocumentRoleEvidence,
  verifyExtractionEvidence,
} from "./extraction-evidence-trust";
export type {
  DocumentRoleEvidence,
  ExtractionEvidenceAuditMetadata,
  ExtractionEvidenceRecord,
  ExtractionEvidenceVerification,
  FrozenCasePage,
  VerifiedEvidenceIndex,
  VerifyExtractionEvidenceInput,
} from "./extraction-evidence-trust";

export {
  compileEffectiveDomainPack,
  composeEffectiveDomainPack,
  EFFECTIVE_DOMAIN_PACK_SCHEMA,
  parseEffectiveDomainPack,
};
export type {
  ApplicabilityDecision,
  ApplicabilityExpr,
  ApplicabilityResult,
  CaseAttribute,
  ClauseExpression,
  ClauseOrigin,
  ClauseProvenance,
  CompileEffectiveDomainPackInput,
  DisabledClause,
  EffectiveDomainPack,
  EffectiveExtensionInput,
  ExtensionAuthorization,
  PackLayerRef,
  PackLayerRole,
  StudyContractIssue,
  StudyContractResult,
} from "./effective-domain-pack";

export const CASE_INVESTIGATION_SPECIFICATION_SCHEMA = "hive.case-investigation-specification/1" as const;
export const MODEL_PROPOSAL_SCHEMA = "hive.model-proposal/1" as const;
export const EVIDENCE_VERIFICATION_RECORD_SCHEMA = "hive.evidence-verification-record/1" as const;
export const INVESTIGATION_COMPLETENESS_SCHEMA = "hive.investigation-completeness/1" as const;

export const MODEL_PROPOSAL_KINDS = ["FIELD", "RELATIONSHIP", "DOCUMENT", "STATEMENT", "GAP"] as const;
export type ModelProposalKind = (typeof MODEL_PROPOSAL_KINDS)[number];

export const EVIDENCE_VERIFICATION_OUTCOMES = ["QUOTE_MATCHED", "QUOTE_REJECTED", "CITATION_ABSENT"] as const;
export type EvidenceVerificationOutcome = (typeof EVIDENCE_VERIFICATION_OUTCOMES)[number];
export const EVIDENCE_VERIFICATION_METHOD = "QUOTE_ON_PAGE" as const;

export const COMPLETENESS_OUTCOMES = ["COMPLETE", "INCOMPLETE", "BLOCKED", "NOT_APPLICABLE"] as const;
export type CompletenessOutcome = (typeof COMPLETENESS_OUTCOMES)[number];

export const CLAUSE_APPLICABILITY = ["APPLICABLE", "UNVERIFIED", "OUT_OF_SCOPE", "DISABLED", "PRESENTATION", "STRUCTURAL"] as const;
export type ClauseApplicability = (typeof CLAUSE_APPLICABILITY)[number];

export const CLAUSE_APPLICABILITY_REASONS = [
  "EXPRESSION_TRUE",
  "EXPRESSION_FALSE",
  "EXPRESSION_UNKNOWN",
  "DISABLED",
  "PRESENTATION",
  "STRUCTURAL",
] as const;
export type ClauseApplicabilityReason = (typeof CLAUSE_APPLICABILITY_REASONS)[number];

const PRESENTATION_KINDS = new Set(["persona", "report", "term", "note", "guideline", "referenceTable"]);
const STRUCTURAL_KINDS = new Set(["entity", "chain", "workflow"]);
const CONFIDENCE_KEYS = new Set(["confidence", "score", "probability"]);
const LAYER_ROLES = new Set<PackLayerRole>(["BASE", "PLATFORM", "PRO", "FIRM"]);

const ID = /^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DIGEST = /^[a-f0-9]{64}$/;
const CLAIM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export type SpecificationClause = {
  definitionId: string;
  kind: string;
  provenance: ClauseProvenance | null;
  applicability: ClauseApplicability;
  reason: ClauseApplicabilityReason;
  editReason?: string;
};

/** Which clauses of an effective pack apply to one Hive. This is not an investigation window plan. */
export type CaseInvestigationSpecification = {
  schema: typeof CASE_INVESTIGATION_SPECIFICATION_SCHEMA;
  digest: string;
  hiveId: string;
  effectivePackDigest: string;
  layers: Array<Pick<PackLayerRef, "role" | "packId" | "version" | "digest">>;
  caseAttributes: CaseAttribute[];
  clauses: SpecificationClause[];
};

export type ModelProposalCitation = { documentId: string; page: number; quote: string };

/** Untrusted model output. Confidence is not a field. The claim is not executed. */
export type ModelProposal = {
  schema: typeof MODEL_PROPOSAL_SCHEMA;
  proposalId: string;
  clauseId: string;
  kind: ModelProposalKind;
  citations: ModelProposalCitation[];
  claim: Record<string, string | number | boolean | null>;
};

export type EvidenceCitationResult = {
  documentId: string;
  page: number;
  quoteDigest: string;
  reason: QuoteRejectionReason | null;
};

/**
 * Independent quote check for one proposal.
 * `claimStatus` stays `NOT_ACCEPTED`: a quote on the named page does not establish the claim.
 * Quote text, page text, and the claim body are not stored.
 */
export type EvidenceVerificationRecord = {
  schema: typeof EVIDENCE_VERIFICATION_RECORD_SCHEMA;
  proposalId: string;
  clauseId: string;
  kind: ModelProposalKind;
  outcome: EvidenceVerificationOutcome;
  method: typeof EVIDENCE_VERIFICATION_METHOD;
  claimStatus: "NOT_ACCEPTED";
  claimDigest: string;
  proposalDigest: string;
  citations: EvidenceCitationResult[];
};

export type ClauseCompleteness = {
  definitionId: string;
  outcome: CompletenessOutcome;
  reason:
    | "CITATIONS_MATCHED"
    | "CITATION_MISSING"
    | "CITATION_REJECTED"
    | "APPLICABILITY_UNVERIFIED"
    | "OUT_OF_SCOPE"
    | "DISABLED"
    | "PRESENTATION"
    | "STRUCTURAL";
};

/**
 * Citation coverage of one specification.
 * `COMPLETE` means every applicable clause has quote-matched citations.
 * It is not a rule verdict, it does not publish the pack, and it does not accept `hive.canonical-study/1`.
 */
export type InvestigationCompleteness = {
  schema: typeof INVESTIGATION_COMPLETENESS_SCHEMA;
  digest: string;
  specificationDigest: string;
  effectivePackDigest: string;
  outcome: CompletenessOutcome;
  claimStatus: "NOT_ACCEPTED";
  clauses: ClauseCompleteness[];
};

export type SpecifyCaseInvestigationInput = {
  pack: EffectiveDomainPack;
  hiveId: string;
  attributes: readonly CaseAttribute[];
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
  return { ok: true, value: freezeDeep(value) };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value: ObjectMap, allowed: readonly string[], path: string, issues: StudyContractIssue[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) issue(issues, "unknown_field", path + "." + key, "Field is not part of this contract.");
  }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function classifyClause(kind: string, result: ApplicabilityResult): Pick<SpecificationClause, "applicability" | "reason"> {
  if (result === "FALSE") return { applicability: "OUT_OF_SCOPE", reason: "EXPRESSION_FALSE" };
  if (result === "UNKNOWN") return { applicability: "UNVERIFIED", reason: "EXPRESSION_UNKNOWN" };
  if (PRESENTATION_KINDS.has(kind)) return { applicability: "PRESENTATION", reason: "PRESENTATION" };
  if (STRUCTURAL_KINDS.has(kind)) return { applicability: "STRUCTURAL", reason: "STRUCTURAL" };
  return { applicability: "APPLICABLE", reason: "EXPRESSION_TRUE" };
}

function specificationDigestBody(specification: Omit<CaseInvestigationSpecification, "digest">): unknown {
  return {
    schema: specification.schema,
    hiveId: specification.hiveId,
    effectivePackDigest: specification.effectivePackDigest,
    layers: specification.layers,
    caseAttributes: specification.caseAttributes,
    clauses: specification.clauses,
  };
}

export function specifyCaseInvestigation(input: SpecifyCaseInvestigationInput): StudyContractResult<CaseInvestigationSpecification> {
  const parsed = parseEffectiveDomainPack(input.pack);
  if (!parsed.ok) return parsed;
  const issues: StudyContractIssue[] = [];
  if (!isValidUuid(input.hiveId)) issue(issues, "hive_invalid", "$.hiveId", "Hive id must be a UUID.");
  const attributes = readCaseAttributes(input.attributes, "$.attributes", issues);
  if (!attributes || issues.length > 0) return finish(issues, undefined as never);
  const pack = parsed.value;
  const provided = new Map(attributes.map((attribute) => [attribute.key, attribute]));
  const extras = new Map(pack.clauseExpressions.map((item) => [item.definitionId, item.expression]));
  const included = new Map(pack.decisions.filter((decision) => decision.included).map((decision) => [decision.packId + "\0" + decision.version, decision]));
  const clauses: SpecificationClause[] = [];
  for (const definition of pack.definitions) {
    const provenance = pack.provenance.find((item) => item.definitionId === definition.id) ?? null;
    const decision = provenance ? included.get(provenance.packId + "\0" + provenance.version) : undefined;
    if (!provenance || !decision) {
      issue(issues, "provenance_unresolved", definition.id, "Clause lineage is not an included layer.");
      continue;
    }
    const extra = extras.get(definition.id);
    const expression = extra ? canonicalizeApplicabilityExpr({ op: "AND", args: [decision.expression, extra] }) : decision.expression;
    const evaluated = evaluateApplicability(expression, provided);
    if (!evaluated.ok) {
      issue(issues, evaluated.code, definition.id, evaluated.message);
      continue;
    }
    clauses.push({ definitionId: definition.id, kind: definition.kind, provenance, ...classifyClause(definition.kind, evaluated.result) });
  }
  for (const disabled of pack.disabled) {
    clauses.push({
      definitionId: disabled.definitionId,
      kind: "disabled",
      provenance: null,
      applicability: "DISABLED",
      reason: "DISABLED",
      editReason: disabled.reason,
    });
  }
  clauses.sort((left, right) => left.definitionId.localeCompare(right.definitionId));
  if (issues.length > 0) return finish(issues, undefined as never);
  const built: Omit<CaseInvestigationSpecification, "digest"> = {
    schema: CASE_INVESTIGATION_SPECIFICATION_SCHEMA,
    hiveId: input.hiveId,
    effectivePackDigest: pack.digest,
    layers: pack.layers.map(({ role, packId, version, digest }) => ({ role, packId, version, digest })),
    caseAttributes: attributes,
    clauses,
  };
  return parseCaseInvestigationSpecification({ ...built, digest: packDigest(specificationDigestBody(built)) });
}

export function parseCaseInvestigationSpecification(raw: unknown): StudyContractResult<CaseInvestigationSpecification> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(raw)) return finish([{ code: "specification_invalid", path: "$", message: "Expected an object." }], undefined as never);
  exactKeys(raw, ["schema", "digest", "hiveId", "effectivePackDigest", "layers", "caseAttributes", "clauses"], "$", issues);
  if (raw.schema !== CASE_INVESTIGATION_SPECIFICATION_SCHEMA) issue(issues, "schema_invalid", "$.schema", "Unsupported specification schema.");
  if (typeof raw.hiveId !== "string" || !isValidUuid(raw.hiveId)) issue(issues, "hive_invalid", "$.hiveId", "Hive id must be a UUID.");
  if (!validDigest(raw.digest) || !validDigest(raw.effectivePackDigest)) issue(issues, "digest_invalid", "$.digest", "Expected a SHA-256 digest.");
  if (!Array.isArray(raw.layers) || !Array.isArray(raw.caseAttributes) || !Array.isArray(raw.clauses)) {
    issue(issues, "specification_invalid", "$", "Layers, attributes, and clauses are required.");
    return finish(issues, undefined as never);
  }
  const layers: CaseInvestigationSpecification["layers"] = [];
  raw.layers.forEach((item, index) => {
    const path = "$.layers[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "layer_invalid", path, "A layer must be an object.");
      return;
    }
    exactKeys(item, ["role", "packId", "version", "digest"], path, issues);
    if (!LAYER_ROLES.has(item.role as PackLayerRole) || !validId(item.packId) || typeof item.version !== "string" || !VERSION.test(item.version) || !validDigest(item.digest)) {
      issue(issues, "layer_invalid", path, "Layer role, id, version, and digest are required.");
      return;
    }
    layers.push({ role: item.role as PackLayerRole, packId: item.packId, version: item.version, digest: item.digest });
  });
  const caseAttributes = readCaseAttributes(raw.caseAttributes, "$.caseAttributes", issues);
  const clauses: SpecificationClause[] = [];
  raw.clauses.forEach((item, index) => {
    const clause = readSpecificationClause(item, "$.clauses[" + index + "]", issues);
    if (clause) clauses.push(clause);
  });
  if (issues.length > 0 || !caseAttributes || layers.length !== raw.layers.length || clauses.length !== raw.clauses.length) {
    return finish(issues, undefined as never);
  }
  const built: Omit<CaseInvestigationSpecification, "digest"> = {
    schema: CASE_INVESTIGATION_SPECIFICATION_SCHEMA,
    hiveId: raw.hiveId as string,
    effectivePackDigest: raw.effectivePackDigest as string,
    layers,
    caseAttributes,
    clauses,
  };
  if (packDigest(specificationDigestBody(built)) !== raw.digest) issue(issues, "digest_mismatch", "$.digest", "Specification digest does not match its body.");
  return finish(issues, { ...built, digest: raw.digest as string });
}

function readSpecificationClause(raw: unknown, path: string, issues: StudyContractIssue[]): SpecificationClause | null {
  if (!isObject(raw)) {
    issue(issues, "clause_invalid", path, "A clause must be an object.");
    return null;
  }
  exactKeys(raw, ["definitionId", "kind", "provenance", "applicability", "reason", "editReason"], path, issues);
  if (!validId(raw.definitionId) || typeof raw.kind !== "string" || !(CLAUSE_APPLICABILITY as readonly string[]).includes(String(raw.applicability))) {
    issue(issues, "clause_invalid", path, "Clause id, kind, and applicability are required.");
    return null;
  }
  if (!(CLAUSE_APPLICABILITY_REASONS as readonly string[]).includes(String(raw.reason))) {
    issue(issues, "clause_invalid", path + ".reason", "Clause reason is not recognized.");
    return null;
  }
  let provenance: ClauseProvenance | null = null;
  if (raw.applicability === "DISABLED") {
    if (raw.provenance !== null || raw.kind !== "disabled" || typeof raw.editReason !== "string" || raw.editReason.trim() === "") {
      issue(issues, "clause_invalid", path, "A disabled clause keeps its edit reason and no definition provenance.");
      return null;
    }
  } else if (!isObject(raw.provenance)) {
    issue(issues, "provenance_invalid", path + ".provenance", "An effective clause needs provenance.");
    return null;
  } else {
    provenance = readClauseProvenance(raw.provenance, path + ".provenance", issues);
    if (!provenance || provenance.definitionId !== raw.definitionId) {
      issue(issues, "provenance_mismatch", path, "Clause provenance must name the same definition.");
      return null;
    }
  }
  return {
    definitionId: raw.definitionId,
    kind: raw.kind,
    provenance,
    applicability: raw.applicability as ClauseApplicability,
    reason: raw.reason as ClauseApplicabilityReason,
    ...(typeof raw.editReason === "string" ? { editReason: raw.editReason } : {}),
  };
}

function claimValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 2000);
}

export function parseModelProposal(raw: unknown): StudyContractResult<ModelProposal> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(raw)) return finish([{ code: "proposal_invalid", path: "$", message: "Expected an object." }], undefined as never);
  exactKeys(raw, ["schema", "proposalId", "clauseId", "kind", "citations", "claim"], "$", issues);
  if (raw.schema !== MODEL_PROPOSAL_SCHEMA) issue(issues, "schema_invalid", "$.schema", "Unsupported proposal schema.");
  if (!validId(raw.proposalId) || !validId(raw.clauseId)) issue(issues, "proposal_invalid", "$", "Proposal and clause ids are required.");
  if (!(MODEL_PROPOSAL_KINDS as readonly string[]).includes(String(raw.kind))) {
    issue(issues, "proposal_kind", "$.kind", "Proposal kind is not part of the shared contract.");
  }
  if (!Array.isArray(raw.citations) || raw.citations.length > 20) issue(issues, "citations_invalid", "$.citations", "Citations must be a bounded array.");
  const citations: ModelProposalCitation[] = [];
  if (Array.isArray(raw.citations)) raw.citations.forEach((item, index) => {
    const path = "$.citations[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "citation_invalid", path, "A citation must be an object.");
      return;
    }
    exactKeys(item, ["documentId", "page", "quote"], path, issues);
    if (typeof item.documentId !== "string" || !isValidUuid(item.documentId)) issue(issues, "citation_invalid", path + ".documentId", "Document id must be a UUID.");
    if (typeof item.page !== "number" || !Number.isInteger(item.page) || item.page < 1 || item.page > 100000) {
      issue(issues, "citation_invalid", path + ".page", "Page must be a positive integer.");
    }
    if (typeof item.quote !== "string" || item.quote.trim() === "" || item.quote.length > 4000) {
      issue(issues, "citation_invalid", path + ".quote", "Quote must be non-empty text within the citation limit.");
    } else citations.push({ documentId: item.documentId as string, page: item.page as number, quote: item.quote });
  });
  if (raw.kind !== "GAP" && Array.isArray(raw.citations) && raw.citations.length === 0) {
    issue(issues, "citation_required", "$.citations", "A factual proposal needs at least one citation.");
  }
  const claim: ModelProposal["claim"] = {};
  if (!isObject(raw.claim) || Array.isArray(raw.claim)) issue(issues, "claim_invalid", "$.claim", "Claim must be an object of plain values.");
  else {
    const keys = Object.keys(raw.claim);
    if (keys.length > 30) issue(issues, "claim_invalid", "$.claim", "Claim has too many fields.");
    for (const key of keys) {
      if (CONFIDENCE_KEYS.has(key)) issue(issues, "confidence_not_evidence", "$.claim." + key, "Model confidence is not evidence.");
      else if (!CLAIM_KEY.test(key)) issue(issues, "claim_invalid", "$.claim." + key, "Claim field name is not allowed.");
      else if (!claimValue(raw.claim[key])) issue(issues, "claim_invalid", "$.claim." + key, "Claim values must be plain JSON scalars.");
      else claim[key] = raw.claim[key] as string | number | boolean | null;
    }
  }
  if (issues.length > 0 || !(MODEL_PROPOSAL_KINDS as readonly string[]).includes(String(raw.kind))) return finish(issues, undefined as never);
  return finish(issues, {
    schema: MODEL_PROPOSAL_SCHEMA,
    proposalId: raw.proposalId as string,
    clauseId: raw.clauseId as string,
    kind: raw.kind as ModelProposalKind,
    citations,
    claim,
  });
}

function citationDigest(quote: string): string {
  return packDigest(normalizeQuoteText(quote));
}

function evidenceDigestBody(record: Omit<EvidenceVerificationRecord, "proposalDigest">): unknown {
  return {
    schema: record.schema,
    proposalId: record.proposalId,
    clauseId: record.clauseId,
    kind: record.kind,
    outcome: record.outcome,
    method: record.method,
    claimStatus: record.claimStatus,
    claimDigest: record.claimDigest,
    citations: record.citations,
  };
}

export function verifyModelProposal(
  raw: unknown,
  pages: ReadonlyMap<string, readonly VerificationPage[]>,
): StudyContractResult<EvidenceVerificationRecord> {
  const parsed = parseModelProposal(raw);
  if (!parsed.ok) return parsed;
  const proposal = parsed.value;
  const issues: StudyContractIssue[] = [];
  const citations: EvidenceCitationResult[] = [];
  for (const citation of proposal.citations) {
    const list = pages.get(citation.documentId);
    if (list && new Set(list.map((page) => page.pageNumber)).size !== list.length) {
      issue(issues, "duplicate_page", "$.pages." + citation.documentId, "Each authorized page number is listed once.");
      continue;
    }
    const authorized = new Map((list ?? []).map((page) => [page.pageNumber, normalizeQuoteText(page.text)]));
    const reason = checkQuote({ page: citation.page, quote: citation.quote }, authorized);
    citations.push({
      documentId: citation.documentId,
      page: citation.page,
      quoteDigest: citationDigest(citation.quote),
      reason,
    });
  }
  if (issues.length > 0) return finish(issues, undefined as never);
  const outcome: EvidenceVerificationOutcome = citations.length === 0
    ? "CITATION_ABSENT"
    : citations.every((citation) => citation.reason === null) ? "QUOTE_MATCHED" : "QUOTE_REJECTED";
  const built: Omit<EvidenceVerificationRecord, "proposalDigest"> = {
    schema: EVIDENCE_VERIFICATION_RECORD_SCHEMA,
    proposalId: proposal.proposalId,
    clauseId: proposal.clauseId,
    kind: proposal.kind,
    outcome,
    method: EVIDENCE_VERIFICATION_METHOD,
    claimStatus: "NOT_ACCEPTED",
    claimDigest: packDigest(proposal.claim),
    citations,
  };
  return parseEvidenceVerificationRecord({ ...built, proposalDigest: packDigest(evidenceDigestBody(built)) });
}

export function parseEvidenceVerificationRecord(raw: unknown): StudyContractResult<EvidenceVerificationRecord> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(raw)) return finish([{ code: "record_invalid", path: "$", message: "Expected an object." }], undefined as never);
  exactKeys(raw, [
    "schema", "proposalId", "clauseId", "kind", "outcome", "method", "claimStatus", "claimDigest", "proposalDigest", "citations",
  ], "$", issues);
  if (raw.schema !== EVIDENCE_VERIFICATION_RECORD_SCHEMA) issue(issues, "schema_invalid", "$.schema", "Unsupported verification schema.");
  if (raw.method !== EVIDENCE_VERIFICATION_METHOD) issue(issues, "method_invalid", "$.method", "Verification method must be an independent quote check.");
  if (raw.claimStatus !== "NOT_ACCEPTED") issue(issues, "claim_not_accepted", "$.claimStatus", "A quote check does not accept a claim.");
  if (!validId(raw.proposalId) || !validId(raw.clauseId)) issue(issues, "record_invalid", "$", "Proposal and clause ids are required.");
  if (!(MODEL_PROPOSAL_KINDS as readonly string[]).includes(String(raw.kind))) issue(issues, "proposal_kind", "$.kind", "Proposal kind is not part of the shared contract.");
  if (!(EVIDENCE_VERIFICATION_OUTCOMES as readonly string[]).includes(String(raw.outcome))) issue(issues, "outcome_invalid", "$.outcome", "Verification outcome is not recognized.");
  if (!validDigest(raw.claimDigest) || !validDigest(raw.proposalDigest)) issue(issues, "digest_invalid", "$", "Expected a SHA-256 digest.");
  if (!Array.isArray(raw.citations)) {
    issue(issues, "citations_invalid", "$.citations", "Citations must be an array.");
    return finish(issues, undefined as never);
  }
  const citations: EvidenceCitationResult[] = [];
  raw.citations.forEach((item, index) => {
    const path = "$.citations[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "citation_invalid", path, "A citation result must be an object.");
      return;
    }
    exactKeys(item, ["documentId", "page", "quoteDigest", "reason"], path, issues);
    if (typeof item.documentId !== "string" || !isValidUuid(item.documentId) || !validDigest(item.quoteDigest)) {
      issue(issues, "citation_invalid", path, "Citation document id and quote digest are required.");
      return;
    }
    if (typeof item.page !== "number" || !Number.isInteger(item.page) || item.page < 1) {
      issue(issues, "citation_invalid", path + ".page", "Page must be a positive integer.");
      return;
    }
    if (item.reason !== null && typeof item.reason !== "string") {
      issue(issues, "citation_invalid", path + ".reason", "Citation reason must be a rejection code or null.");
      return;
    }
    citations.push({ documentId: item.documentId, page: item.page, quoteDigest: item.quoteDigest, reason: item.reason as QuoteRejectionReason | null });
  });
  if (issues.length > 0 || citations.length !== raw.citations.length) return finish(issues, undefined as never);
  const outcome = raw.outcome as EvidenceVerificationOutcome;
  if (outcome === "CITATION_ABSENT" && citations.length !== 0) issue(issues, "outcome_mismatch", "$.outcome", "An absent citation has no citation results.");
  if (outcome === "QUOTE_MATCHED" && (citations.length === 0 || citations.some((citation) => citation.reason !== null))) {
    issue(issues, "outcome_mismatch", "$.outcome", "A matched outcome requires every citation to match.");
  }
  if (outcome === "QUOTE_REJECTED" && !citations.some((citation) => citation.reason !== null)) {
    issue(issues, "outcome_mismatch", "$.outcome", "A rejected outcome names at least one rejection.");
  }
  if (issues.length > 0) return finish(issues, undefined as never);
  const built: Omit<EvidenceVerificationRecord, "proposalDigest"> = {
    schema: EVIDENCE_VERIFICATION_RECORD_SCHEMA,
    proposalId: raw.proposalId as string,
    clauseId: raw.clauseId as string,
    kind: raw.kind as ModelProposalKind,
    outcome,
    method: EVIDENCE_VERIFICATION_METHOD,
    claimStatus: "NOT_ACCEPTED",
    claimDigest: raw.claimDigest as string,
    citations,
  };
  if (packDigest(evidenceDigestBody(built)) !== raw.proposalDigest) issue(issues, "digest_mismatch", "$.proposalDigest", "Verification digest does not match its body.");
  return finish(issues, { ...built, proposalDigest: raw.proposalDigest as string });
}

function completenessDigestBody(result: Omit<InvestigationCompleteness, "digest">): unknown {
  return {
    schema: result.schema,
    specificationDigest: result.specificationDigest,
    effectivePackDigest: result.effectivePackDigest,
    outcome: result.outcome,
    claimStatus: result.claimStatus,
    clauses: result.clauses,
  };
}

function clauseOutcome(clause: SpecificationClause, records: readonly EvidenceVerificationRecord[]): ClauseCompleteness {
  if (clause.applicability === "OUT_OF_SCOPE") return { definitionId: clause.definitionId, outcome: "NOT_APPLICABLE", reason: "OUT_OF_SCOPE" };
  if (clause.applicability === "DISABLED") return { definitionId: clause.definitionId, outcome: "NOT_APPLICABLE", reason: "DISABLED" };
  if (clause.applicability === "PRESENTATION") return { definitionId: clause.definitionId, outcome: "NOT_APPLICABLE", reason: "PRESENTATION" };
  if (clause.applicability === "STRUCTURAL") return { definitionId: clause.definitionId, outcome: "NOT_APPLICABLE", reason: "STRUCTURAL" };
  if (clause.applicability === "UNVERIFIED") return { definitionId: clause.definitionId, outcome: "BLOCKED", reason: "APPLICABILITY_UNVERIFIED" };
  if (records.some((record) => record.outcome === "QUOTE_REJECTED")) {
    return { definitionId: clause.definitionId, outcome: "INCOMPLETE", reason: "CITATION_REJECTED" };
  }
  if (records.length === 0 || records.some((record) => record.outcome !== "QUOTE_MATCHED")) {
    return { definitionId: clause.definitionId, outcome: "INCOMPLETE", reason: "CITATION_MISSING" };
  }
  return { definitionId: clause.definitionId, outcome: "COMPLETE", reason: "CITATIONS_MATCHED" };
}

function overallOutcome(clauses: readonly ClauseCompleteness[]): CompletenessOutcome {
  if (clauses.some((clause) => clause.outcome === "BLOCKED")) return "BLOCKED";
  if (clauses.some((clause) => clause.outcome === "INCOMPLETE")) return "INCOMPLETE";
  if (clauses.some((clause) => clause.outcome === "COMPLETE")) return "COMPLETE";
  return "NOT_APPLICABLE";
}

export function assessInvestigationCompleteness(
  specification: unknown,
  records: readonly unknown[],
): StudyContractResult<InvestigationCompleteness> {
  const parsed = parseCaseInvestigationSpecification(specification);
  if (!parsed.ok) return parsed;
  const issues: StudyContractIssue[] = [];
  const verified: EvidenceVerificationRecord[] = [];
  const seen = new Set<string>();
  records.forEach((record, index) => {
    const result = parseEvidenceVerificationRecord(record);
    if (!result.ok) {
      result.issues.forEach((item) => issue(issues, item.code, "$.records[" + index + "]" + item.path.slice(1), item.message));
      return;
    }
    if (seen.has(result.value.proposalId)) issue(issues, "duplicate_proposal", "$.records[" + index + "]", "Each proposal is verified once.");
    seen.add(result.value.proposalId);
    const clause = parsed.value.clauses.find((item) => item.definitionId === result.value.clauseId);
    if (!clause) issue(issues, "unknown_clause", "$.records[" + index + "]", "Verification names a clause that is not in the specification.");
    else if (clause.applicability !== "APPLICABLE" && clause.applicability !== "UNVERIFIED") {
      issue(issues, "clause_not_evidence", "$.records[" + index + "]", "Verification does not attach to an out-of-scope, disabled, presentation, or structural clause.");
    }
    verified.push(result.value);
  });
  if (issues.length > 0) return finish(issues, undefined as never);
  const clauses = parsed.value.clauses.map((clause) => clauseOutcome(clause, verified.filter((record) => record.clauseId === clause.definitionId)))
    .sort((left, right) => left.definitionId.localeCompare(right.definitionId));
  const built: Omit<InvestigationCompleteness, "digest"> = {
    schema: INVESTIGATION_COMPLETENESS_SCHEMA,
    specificationDigest: parsed.value.digest,
    effectivePackDigest: parsed.value.effectivePackDigest,
    outcome: overallOutcome(clauses),
    claimStatus: "NOT_ACCEPTED",
    clauses,
  };
  return parseInvestigationCompleteness({ ...built, digest: packDigest(completenessDigestBody(built)) });
}

export function parseInvestigationCompleteness(raw: unknown): StudyContractResult<InvestigationCompleteness> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(raw)) return finish([{ code: "completeness_invalid", path: "$", message: "Expected an object." }], undefined as never);
  exactKeys(raw, ["schema", "digest", "specificationDigest", "effectivePackDigest", "outcome", "claimStatus", "clauses"], "$", issues);
  if (raw.schema !== INVESTIGATION_COMPLETENESS_SCHEMA) issue(issues, "schema_invalid", "$.schema", "Unsupported completeness schema.");
  if (raw.claimStatus !== "NOT_ACCEPTED") issue(issues, "claim_not_accepted", "$.claimStatus", "Completeness does not accept a claim or a Study.");
  if (!validDigest(raw.digest) || !validDigest(raw.specificationDigest) || !validDigest(raw.effectivePackDigest)) {
    issue(issues, "digest_invalid", "$", "Expected a SHA-256 digest.");
  }
  if (!(COMPLETENESS_OUTCOMES as readonly string[]).includes(String(raw.outcome))) issue(issues, "outcome_invalid", "$.outcome", "Completeness outcome is not recognized.");
  if (!Array.isArray(raw.clauses)) {
    issue(issues, "clauses_invalid", "$.clauses", "Clause outcomes must be an array.");
    return finish(issues, undefined as never);
  }
  const clauses: ClauseCompleteness[] = [];
  raw.clauses.forEach((item, index) => {
    const path = "$.clauses[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "clause_invalid", path, "A clause outcome must be an object.");
      return;
    }
    exactKeys(item, ["definitionId", "outcome", "reason"], path, issues);
    if (!validId(item.definitionId) || !(COMPLETENESS_OUTCOMES as readonly string[]).includes(String(item.outcome))) {
      issue(issues, "clause_invalid", path, "Clause id and outcome are required.");
      return;
    }
    const reasons = ["CITATIONS_MATCHED", "CITATION_MISSING", "CITATION_REJECTED", "APPLICABILITY_UNVERIFIED", "OUT_OF_SCOPE", "DISABLED", "PRESENTATION", "STRUCTURAL"];
    if (!reasons.includes(String(item.reason))) {
      issue(issues, "clause_invalid", path + ".reason", "Clause completeness reason is not recognized.");
      return;
    }
    clauses.push({ definitionId: item.definitionId, outcome: item.outcome as CompletenessOutcome, reason: item.reason as ClauseCompleteness["reason"] });
  });
  if (issues.length > 0 || clauses.length !== raw.clauses.length) return finish(issues, undefined as never);
  if (overallOutcome(clauses) !== raw.outcome) issue(issues, "outcome_mismatch", "$.outcome", "Overall outcome does not match the clauses.");
  const built: Omit<InvestigationCompleteness, "digest"> = {
    schema: INVESTIGATION_COMPLETENESS_SCHEMA,
    specificationDigest: raw.specificationDigest as string,
    effectivePackDigest: raw.effectivePackDigest as string,
    outcome: raw.outcome as CompletenessOutcome,
    claimStatus: "NOT_ACCEPTED",
    clauses,
  };
  if (validDigest(raw.digest) && packDigest(completenessDigestBody(built)) !== raw.digest) {
    issue(issues, "digest_mismatch", "$.digest", "Completeness digest does not match its body.");
  }
  return finish(issues, { ...built, digest: raw.digest as string });
}

export {
  PROMPT_COMPILATION_SCHEMA,
  PROMPT_INPUT_TOKEN_LIMIT,
  PROMPT_REQUEST_BYTE_LIMIT,
  PROMPT_TEMPLATE_VERSION,
  compileInvestigationPrompt,
  parsePromptCompilation,
} from "./domain-prompt-compiler";
export type {
  AuthorizedDisclosurePage,
  CompileInvestigationPromptInput,
  DisclosurePolicy,
  PromptCapacityFailure,
  PromptCompilation,
  PromptCompileResult,
  PromptCapacityLimits,
  PromptFactValue,
  PromptLimitation,
  PromptSection,
  WindowPromptScope,
} from "./domain-prompt-compiler";
export { compileDomainPack } from "./domain-pack-compiler";
export {
  PACK_GUIDED_CANONICALIZE_PROMPT_ID,
  PACK_GUIDED_MAX_ATTEMPTS,
  PACK_GUIDED_OUTPUT_SCHEMA,
  PACK_GUIDED_PROPOSAL_KINDS,
  PACK_GUIDED_RESOLUTION_SCHEMA,
} from "./pack-guided-ids";
export type { PackGuidedProposalKind } from "./pack-guided-ids";
export { assessPackGuidedBudget, packGuidedEstimatedUsd, packGuidedInputTokenLimit, packGuidedRequestByteLimit } from "./pack-guided-budget";
export type { PackGuidedBudgetFailure } from "./pack-guided-budget";
export { diagnosticCode, evidenceIndexOf, resolvePackGuidedOutput } from "./pack-guided-output";
export type { PackGuidedResolution, ResolvedEvidenceReference, ResolvedPackGuidedProposal } from "./pack-guided-output";
export {
  SYNTHETIC_EXECUTION_CORPORA,
  SYNTHETIC_EXECUTION_FIXTURES,
  SYNTHETIC_MAYA_FIXTURE_ID,
  SYNTHETIC_MAYA_PAGE_DIGESTS,
  identifySyntheticExecutionFixture,
  resolveSyntheticExecutionFixtureId,
  syntheticExecutionCorpus,
  syntheticExecutionFixture,
} from "./synthetic-execution-fixtures";
export type { SyntheticExecutionCorpus, SyntheticExecutionFixture, SyntheticFixtureRefusal } from "./synthetic-execution-fixtures";
export { constructPackGuidedStudy, PACK_GUIDED_STUDY_ENGINE_ID, PACK_GUIDED_STUDY_VALIDATION_SCHEMA } from "./pack-guided-study";
export type { ConstructPackGuidedStudyInput, PackGuidedStudyResult, PackGuidedStudyValidation } from "./pack-guided-study";
