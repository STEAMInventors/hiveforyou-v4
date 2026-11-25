/**
 * Offline candidate binder.
 * Turns untrusted investigation candidates into hive.verified-case-facts/1.
 * Quotes are checked against authorized pages. A candidate citation is not proof.
 * A quote that names both endpoints does not establish a relationship.
 * Citing a field fact about each endpoint does not establish the link.
 * evidenceForLink is a question, not a matcher. Nothing here calls a model.
 *
 * Trusted relationship meaning is not available to this binder. Quote
 * authenticity, endpoint identity, source provenance, and authored direction
 * stay in force, and none of them is relational meaning. Keyword lists,
 * negation lists, and model confidence are not verifiers. Until a separate
 * trusted verifier accepts a proposal, free-text relationship candidates are
 * REVIEW_REQUIRED with RELATIONSHIP_SEMANTICS_UNVERIFIED and are not copied
 * into hive.verified-case-facts/1.
 *
 * Required contract for that verifier, not implemented here: it must accept
 * or withhold one compiled relationship id, the authored from/to direction,
 * the verified endpoint instances, and quotes that already passed checkQuote.
 * Acceptance has to be independent of endpoint co-occurrence and of any
 * boolean, score, or label supplied by the candidate. Absence of the verifier
 * is not acceptance. This binder does not invent that acceptance.
 */
import { decimalFromPlain } from "../analysis/decimal-formula";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import { packDigest } from "./domain-pack-compiler";
import type { DomainInvestigationPlan, InvestigationTask } from "./domain-investigation-plan";
import {
  calendarDayIndex,
  VERIFIED_CASE_FACTS_SCHEMA,
  type VerifiedCaseFacts,
  type VerifiedDocumentFact,
  type VerifiedFact,
  type VerifiedRelationshipFact,
  type VerifiedScalar,
  type VerifiedSourceRef,
} from "./domain-pack-rules";
import {
  DOMAIN_PACK_RUNTIME_SCHEMA,
  type CompiledDomainPack,
  type EffectiveDefinition,
  type FieldValueType,
} from "./domain-pack-source";
import { checkQuote, normalizeQuoteText, type VerificationPage } from "./verify-quotes";

export const INVESTIGATION_CANDIDATES_SCHEMA = "hive.investigation-candidates/1" as const;
export const UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA = "hive.investigation-unresolved-candidates/1" as const;

export const BINDER_REASON_CODES = [
  "CANDIDATE_MALFORMED",
  "CROSS_INSTANCE",
  "DIRECTION_MISMATCH",
  "ENDPOINT_FACTS_ARE_NOT_A_LINK",
  "ENDPOINTS_NOT_IDENTIFIED",
  "FIELD_COERCION",
  "IDENTITY_CONFLICT",
  "INSTANCE_UNVERIFIED",
  "INVENTED_FACT",
  "MISSING_EVIDENCE",
  "PAGE_NOT_PROVIDED",
  "QUOTE_CASE_MISMATCH",
  "QUOTE_EMPTY",
  "QUOTE_HAS_ELLIPSIS",
  "QUOTE_NOT_FOUND",
  "QUOTE_ON_OTHER_PAGE",
  "RELATIONSHIP_SEMANTICS_UNVERIFIED",
  "RELATIONSHIP_SUPPORT_UNDETERMINED",
  "TABLE_CELL_NOT_FOUND",
  "TASK_MISMATCH",
  "TYPE_MISMATCH",
  "UNAUTHORIZED_DOCUMENT",
  "UNKNOWN_DEFINITION",
  "UNKNOWN_TASK",
  "VALUE_NOT_IN_QUOTE",
  "WRONG_DOCUMENT",
] as const;
export type BinderReasonCode = (typeof BINDER_REASON_CODES)[number];

const FORBIDDEN_KEYS = new Set([
  "outcome",
  "daysBetween",
  "verdict",
  "jurisdiction",
  "applicability",
  "extractionFactIds",
  "status",
]);
const HARD_REASONS = new Set<BinderReasonCode>([
  "CANDIDATE_MALFORMED",
  "CROSS_INSTANCE",
  "DIRECTION_MISMATCH",
  "FIELD_COERCION",
  "INVENTED_FACT",
  "MISSING_EVIDENCE",
  "PAGE_NOT_PROVIDED",
  "QUOTE_CASE_MISMATCH",
  "QUOTE_EMPTY",
  "QUOTE_HAS_ELLIPSIS",
  "QUOTE_NOT_FOUND",
  "QUOTE_ON_OTHER_PAGE",
  "TABLE_CELL_NOT_FOUND",
  "TASK_MISMATCH",
  "TYPE_MISMATCH",
  "UNAUTHORIZED_DOCUMENT",
  "UNKNOWN_DEFINITION",
  "UNKNOWN_TASK",
  "VALUE_NOT_IN_QUOTE",
  "WRONG_DOCUMENT",
]);

/** A hard binder reason rejects the evidence. It is not an unresolved finding. */
export function binderReasonRejectsRun(code: string): boolean {
  return HARD_REASONS.has(code as BinderReasonCode);
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIELD_KEYS = ["candidateId", "taskId", "kind", "entityId", "instanceId", "fieldId", "documentId", "extractionFactId", "value"];
const DOCUMENT_KEYS = ["candidateId", "taskId", "kind", "documentKindId", "documentId", "extractionFactId", "subject", "evidence"];
const RELATIONSHIP_KEYS = ["candidateId", "taskId", "kind", "relationshipId", "fromInstanceId", "toInstanceId", "evidence"];
const ENVELOPE_KEYS = ["schema", "planDigest", "packDigest", "extractionDigest", "candidates"];

export type CandidateEvidence = { sourceDocumentId: string; page: number; quote: string };
export type AuthorizedDocument = { documentId: string; pages: readonly VerificationPage[] };
export type CandidateBinderInput = {
  plan: DomainInvestigationPlan;
  pack: CompiledDomainPack;
  /** Untrusted model output. */
  candidates: unknown;
  extractions: readonly DocExtraction[];
  documents: readonly AuthorizedDocument[];
};
export type UnresolvedCandidate = {
  candidateId: string;
  kind: "FIELD" | "DOCUMENT" | "RELATIONSHIP" | "UNKNOWN";
  trust: "UNRESOLVED" | "REVIEW_REQUIRED";
  reasons: readonly BinderReasonCode[];
  entityId?: string;
  instanceId?: string;
  fieldId?: string;
  documentId?: string;
  documentKindId?: string;
  extractionFactId?: string;
  relationshipId?: string;
  fromEntityId?: string;
  toEntityId?: string;
  fromInstanceId?: string;
  toInstanceId?: string;
  sourceRefs: readonly VerifiedSourceRef[];
  evidence: readonly CandidateEvidence[];
};
export type UnresolvedCandidates = {
  schema: typeof UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA;
  candidates: readonly UnresolvedCandidate[];
};
export type BinderIssue = { code: string; path: string; message: string };
export type CandidateBinderResult =
  | { ok: true; verified: VerifiedCaseFacts; unresolved: UnresolvedCandidates; digest: string }
  | { ok: false; issues: BinderIssue[] };

type ObjectMap = Record<string, unknown>;
type PageCorpus = Map<string, Map<number, string>>;
type FactIndex = Map<string, ExtractionFact>;
type AcceptedField = {
  candidateId: string;
  entityId: string;
  instanceId: string;
  fieldId: string;
  documentId: string;
  extractionFactId: string;
  value: VerifiedScalar;
  sourceRefs: VerifiedSourceRef[];
  quotes: string[];
};
type AcceptedDocument = {
  candidateId: string;
  documentKindId: string;
  documentId: string;
  extractionFactId: string;
  subject?: { entityId: string; instanceId: string };
  sourceRefs: VerifiedSourceRef[];
};
type OpenCandidate = { index: number; raw: ObjectMap; reasons: BinderReasonCode[] };

const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const asReason = (value: string): BinderReasonCode => (BINDER_REASON_CODES as readonly string[]).includes(value) ? value as BinderReasonCode : "CANDIDATE_MALFORMED";

/** Digest of the extraction facts a candidate set is allowed to cite. */
export function authorizedExtractionDigest(extractions: readonly DocExtraction[]): string {
  const projection = [...extractions].map((extraction) => ({
    documentId: extraction.documentId,
    facts: [...extraction.facts].map((fact) => ({
      id: fact.id,
      valueAsWritten: fact.valueAsWritten,
      evidence: fact.evidence.map((item) => ({ page: item.page, quote: item.quote })),
    })).sort((left, right) => left.id.localeCompare(right.id)),
  })).sort((left, right) => left.documentId.localeCompare(right.documentId));
  return packDigest(projection);
}

function issue(into: BinderIssue[], code: string, path: string, message: string): void {
  into.push({ code, path, message });
}

function fail(issues: BinderIssue[]): CandidateBinderResult {
  const sorted = [...issues].sort((left, right) => (left.path + "\0" + left.code).localeCompare(right.path + "\0" + right.code));
  return { ok: false, issues: sorted };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) freezeDeep(child);
  }
  return value;
}

function exactKeys(value: ObjectMap, allowed: readonly string[]): boolean {
  const ok = new Set(allowed);
  return Object.keys(value).every((key) => ok.has(key));
}

function forbiddenKeys(value: unknown, path: string, issues: BinderIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenKeys(item, path + "[" + index + "]", issues));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      issue(issues, "forbidden_field", path + "." + key, "Candidates cannot set outcomes, verdicts, jurisdiction, applicability, or relationship fact ids.");
    }
    forbiddenKeys(child, path + "." + key, issues);
  }
}

function stableId(prefix: string, material: unknown): string {
  return prefix + packDigest(material).slice(0, 20);
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

function containsPhrase(text: string, phrase: string): boolean {
  const needle = normalizeQuoteText(phrase);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?<![A-Za-z0-9])" + escaped + "(?![A-Za-z0-9])").test(text);
}

function sortRefs(refs: readonly VerifiedSourceRef[]): VerifiedSourceRef[] {
  const seen = new Set<string>();
  const result: VerifiedSourceRef[] = [];
  for (const ref of refs) {
    const key = ref.documentId + "\0" + (ref.page ?? "") + "\0" + (ref.excerptId ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result.sort((left, right) => (left.documentId + "\0" + (left.page ?? "") + "\0" + (left.excerptId ?? "")).localeCompare(right.documentId + "\0" + (right.page ?? "") + "\0" + (right.excerptId ?? "")));
}

function quoteProblem(documentId: string, page: number, quote: string, corpus: PageCorpus): BinderReasonCode | null {
  const pages = corpus.get(documentId);
  if (!pages) return "UNAUTHORIZED_DOCUMENT";
  const reason = checkQuote({ page, quote }, pages);
  if (reason === null) return null;
  if (reason === "quote_not_found") {
    for (const [otherId, otherPages] of corpus) {
      if (otherId === documentId) continue;
      for (const pageNumber of otherPages.keys()) {
        if (checkQuote({ page: pageNumber, quote }, otherPages) === null) return "WRONG_DOCUMENT";
      }
    }
  }
  return asReason(reason.toUpperCase());
}

function readScalar(value: unknown): VerifiedScalar | null {
  if (!isObject(value) || typeof value.value !== "string" || typeof value.valueType !== "string") return null;
  if (value.valueType === "MONEY") {
    if (!exactKeys(value, ["valueType", "value", "currency"]) || typeof value.currency !== "string") return null;
    return { valueType: "MONEY", value: value.value, currency: value.currency };
  }
  if (value.valueType === "QUANTITY") {
    if (!exactKeys(value, ["valueType", "value", "unit"]) || typeof value.unit !== "string") return null;
    return { valueType: "QUANTITY", value: value.value, unit: value.unit };
  }
  if (!["TEXT", "NUMBER", "DATE", "BOOLEAN"].includes(value.valueType) || !exactKeys(value, ["valueType", "value"])) return null;
  return { valueType: value.valueType as "TEXT" | "NUMBER" | "DATE" | "BOOLEAN", value: value.value };
}

function valueAgreement(fieldType: FieldValueType, written: string, proposed: VerifiedScalar): BinderReasonCode | null {
  if (proposed.valueType !== fieldType) return "TYPE_MISMATCH";
  const text = normalizeQuoteText(written);
  if (!text) return "FIELD_COERCION";
  if (fieldType === "TEXT") return proposed.value === text ? null : "FIELD_COERCION";
  if (fieldType === "BOOLEAN") return (text === "true" || text === "false") && proposed.value === text ? null : "FIELD_COERCION";
  if (fieldType === "DATE") return text === proposed.value && calendarDayIndex(proposed.value) !== null ? null : "FIELD_COERCION";
  if (decimalFromPlain(text) === null || proposed.value !== text) return "FIELD_COERCION";
  if (fieldType === "MONEY" && !nonempty(proposed.valueType === "MONEY" ? proposed.currency : "")) return "FIELD_COERCION";
  if (fieldType === "QUANTITY" && !nonempty(proposed.valueType === "QUANTITY" ? proposed.unit : "")) return "FIELD_COERCION";
  return null;
}

function sameScalar(left: VerifiedScalar, right: VerifiedScalar): boolean {
  if (left.valueType !== right.valueType) return false;
  if (left.valueType === "TEXT" || left.valueType === "BOOLEAN" || left.valueType === "DATE") return left.value === right.value;
  if (left.valueType === "MONEY" && right.valueType === "MONEY" && left.currency !== right.currency) return false;
  if (left.valueType === "QUANTITY" && right.valueType === "QUANTITY" && left.unit !== right.unit) return false;
  const leftDecimal = decimalFromPlain(left.value);
  const rightDecimal = decimalFromPlain(right.value);
  if (!leftDecimal || !rightDecimal) return left.value === right.value;
  return leftDecimal.units === rightDecimal.units && leftDecimal.scale === rightDecimal.scale;
}

function readEvidence(value: unknown): CandidateEvidence[] | null {
  if (!Array.isArray(value)) return null;
  const evidence: CandidateEvidence[] = [];
  for (const item of value) {
    if (!isObject(item) || !exactKeys(item, ["sourceDocumentId", "page", "quote"])) return null;
    if (typeof item.sourceDocumentId !== "string" || !nonempty(item.sourceDocumentId)) return null;
    if (typeof item.page !== "number" || !Number.isInteger(item.page) || item.page < 1) return null;
    if (typeof item.quote !== "string" || item.quote.trim() === "") return null;
    evidence.push({ sourceDocumentId: item.sourceDocumentId, page: item.page, quote: item.quote });
  }
  return evidence;
}

function definitionsOf(pack: CompiledDomainPack): Map<string, EffectiveDefinition> {
  return new Map(pack.definitions.map((definition) => [definition.id, definition]));
}

function taskFor(plan: DomainInvestigationPlan, definitionId: string, kind: InvestigationTask["taskKind"]): InvestigationTask | undefined {
  return plan.tasks.find((task) => task.definitionId === definitionId && task.taskKind === kind);
}

function identityKeyIds(task: InvestigationTask | undefined, entity: Extract<EffectiveDefinition, { kind: "entity" }>): string[] | null {
  if (!task?.identityKeys || task.identityKeys.length === 0) return null;
  const fields = new Set(entity.fields.map((field) => field.id));
  if (task.identityKeys.some((key) => !fields.has(key))) return null;
  return [...task.identityKeys];
}

function pushReason(reasons: BinderReasonCode[], reason: BinderReasonCode): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function trustFor(reasons: readonly BinderReasonCode[]): "UNRESOLVED" | "REVIEW_REQUIRED" {
  return reasons.some((reason) => HARD_REASONS.has(reason)) ? "UNRESOLVED" : "REVIEW_REQUIRED";
}

function claimedRefs(evidence: readonly CandidateEvidence[], excerptId?: string): VerifiedSourceRef[] {
  return sortRefs(evidence.map((item) => ({
    documentId: item.sourceDocumentId,
    page: String(item.page),
    ...(excerptId ? { excerptId } : {}),
  })));
}

function buildCorpus(documents: readonly AuthorizedDocument[], issues: BinderIssue[]): PageCorpus | null {
  const corpus: PageCorpus = new Map();
  documents.forEach((document, index) => {
    const path = "$.documents[" + index + "]";
    if (!nonempty(document?.documentId)) {
      issue(issues, "source_invalid", path, "Authorized document id is required.");
      return;
    }
    if (corpus.has(document.documentId)) {
      issue(issues, "duplicate_document", path, "Authorized document ids must be unique.");
      return;
    }
    const pages = new Map<number, string>();
    for (const page of document.pages ?? []) {
      if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1 || typeof page.text !== "string") {
        issue(issues, "source_invalid", path, "Authorized pages need a page number and text.");
        return;
      }
      if (pages.has(page.pageNumber)) {
        issue(issues, "duplicate_page", path, "An authorized document repeats a page number.");
        return;
      }
      pages.set(page.pageNumber, normalizeQuoteText(page.text));
    }
    corpus.set(document.documentId, pages);
  });
  return issues.length ? null : corpus;
}

function indexFacts(extractions: readonly DocExtraction[], issues: BinderIssue[]): FactIndex | null {
  const index: FactIndex = new Map();
  const documents = new Set<string>();
  extractions.forEach((extraction, extractionIndex) => {
    if (!nonempty(extraction?.documentId)) {
      issue(issues, "extraction_invalid", "$.extractions[" + extractionIndex + "]", "Extraction document id is required.");
      return;
    }
    if (documents.has(extraction.documentId)) {
      issue(issues, "duplicate_extraction", "$.extractions[" + extractionIndex + "]", "One authorized extraction per document.");
      return;
    }
    documents.add(extraction.documentId);
    for (const fact of extraction.facts ?? []) {
      const key = extraction.documentId + "\0" + fact.id;
      if (index.has(key)) {
        issue(issues, "duplicate_fact", key, "Extraction fact ids must be unique within a document.");
        return;
      }
      index.set(key, fact);
    }
  });
  return issues.length ? null : index;
}

function fieldQuotes(fact: ExtractionFact): string[] {
  return fact.evidence.map((item) => normalizeQuoteText(item.quote)).filter((quote) => quote.length > 0);
}

function acceptField(
  open: OpenCandidate,
  plan: DomainInvestigationPlan,
  pack: CompiledDomainPack,
  facts: FactIndex,
  corpus: PageCorpus,
): AcceptedField | null {
  const raw = open.raw;
  if (raw.kind !== "FIELD" || !exactKeys(raw, FIELD_KEYS)) {
    pushReason(open.reasons, "CANDIDATE_MALFORMED");
    return null;
  }
  const entityId = typeof raw.entityId === "string" ? raw.entityId : "";
  const instanceId = identifier(raw.instanceId);
  const fieldId = typeof raw.fieldId === "string" ? raw.fieldId : "";
  const documentId = typeof raw.documentId === "string" ? raw.documentId : "";
  const extractionFactId = typeof raw.extractionFactId === "string" ? raw.extractionFactId : "";
  const proposed = readScalar(raw.value);
  if (!instanceId || !nonempty(fieldId) || !nonempty(documentId) || !nonempty(extractionFactId) || !proposed) {
    pushReason(open.reasons, "CANDIDATE_MALFORMED");
    return null;
  }
  const task = taskFor(plan, entityId, "BIND_ENTITY");
  if (raw.taskId !== task?.taskId) pushReason(open.reasons, task ? "TASK_MISMATCH" : "UNKNOWN_TASK");
  const definition = definitionsOf(pack).get(entityId);
  const entity = definition?.kind === "entity" ? definition : null;
  if (!entity) pushReason(open.reasons, "UNKNOWN_DEFINITION");
  const field = entity?.fields.find((item) => item.id === fieldId);
  if (entity && !field) pushReason(open.reasons, "UNKNOWN_DEFINITION");
  const fact = facts.get(documentId + "\0" + extractionFactId);
  if (!fact) pushReason(open.reasons, "INVENTED_FACT");
  if (!corpus.has(documentId)) pushReason(open.reasons, "UNAUTHORIZED_DOCUMENT");
  if (!fact || !field) return null;
  if (fact.evidence.length === 0) {
    pushReason(open.reasons, "MISSING_EVIDENCE");
    return null;
  }
  const agreement = valueAgreement(field.valueType, fact.valueAsWritten, proposed);
  if (agreement) pushReason(open.reasons, agreement);
  const quoteReasons: BinderReasonCode[] = [];
  for (const item of fact.evidence) {
    const problem = quoteProblem(documentId, item.page, item.quote, corpus);
    if (problem) pushReason(quoteReasons, problem);
  }
  for (const reason of quoteReasons) pushReason(open.reasons, reason);
  const quotes = fieldQuotes(fact);
  const valueInQuote = quotes.some((quote) => containsPhrase(quote, proposed.value));
  if (!valueInQuote) pushReason(open.reasons, "VALUE_NOT_IN_QUOTE");
  if (proposed.valueType === "MONEY" && !quotes.some((quote) => containsPhrase(quote, proposed.currency))) {
    pushReason(open.reasons, "FIELD_COERCION");
  }
  if (proposed.valueType === "QUANTITY" && !quotes.some((quote) => containsPhrase(quote, proposed.unit))) {
    pushReason(open.reasons, "FIELD_COERCION");
  }
  if (open.reasons.length > 0) return null;
  return {
    candidateId: String(raw.candidateId),
    entityId,
    instanceId,
    fieldId,
    documentId,
    extractionFactId,
    value: proposed,
    sourceRefs: sortRefs(fact.evidence.map((item) => ({
      documentId,
      page: String(item.page),
      excerptId: extractionFactId,
    }))),
    quotes,
  };
}

function acceptDocument(
  open: OpenCandidate,
  plan: DomainInvestigationPlan,
  pack: CompiledDomainPack,
  facts: FactIndex,
  corpus: PageCorpus,
): AcceptedDocument | null {
  const raw = open.raw;
  if (raw.kind !== "DOCUMENT" || !exactKeys(raw, DOCUMENT_KEYS)) {
    pushReason(open.reasons, "CANDIDATE_MALFORMED");
    return null;
  }
  const documentKindId = typeof raw.documentKindId === "string" ? raw.documentKindId : "";
  const documentId = typeof raw.documentId === "string" ? raw.documentId : "";
  const extractionFactId = typeof raw.extractionFactId === "string" ? raw.extractionFactId : "";
  const evidence = readEvidence(raw.evidence);
  if (!nonempty(documentKindId) || !nonempty(documentId) || !nonempty(extractionFactId) || !evidence) {
    pushReason(open.reasons, "CANDIDATE_MALFORMED");
    return null;
  }
  const task = taskFor(plan, documentKindId, "BIND_DOCUMENT");
  if (raw.taskId !== task?.taskId) pushReason(open.reasons, task ? "TASK_MISMATCH" : "UNKNOWN_TASK");
  const definition = definitionsOf(pack).get(documentKindId);
  if (definition?.kind !== "document") pushReason(open.reasons, "UNKNOWN_DEFINITION");
  if (!corpus.has(documentId)) pushReason(open.reasons, "UNAUTHORIZED_DOCUMENT");
  const fact = facts.get(documentId + "\0" + extractionFactId);
  if (!fact) pushReason(open.reasons, "INVENTED_FACT");
  if (evidence.length === 0) pushReason(open.reasons, "MISSING_EVIDENCE");
  let subject: { entityId: string; instanceId: string } | undefined;
  if (raw.subject !== undefined) {
    if (!isObject(raw.subject) || !exactKeys(raw.subject, ["entityId", "instanceId"])) pushReason(open.reasons, "CANDIDATE_MALFORMED");
    else {
      const instanceId = identifier(raw.subject.instanceId);
      if (typeof raw.subject.entityId !== "string" || !instanceId) pushReason(open.reasons, "CANDIDATE_MALFORMED");
      else subject = { entityId: raw.subject.entityId, instanceId };
    }
  }
  if (!fact || evidence.length === 0) return null;
  const allowed = new Set(fact.evidence.map((item) => item.page + "\0" + normalizeQuoteText(item.quote)));
  for (const item of evidence) {
    const problem = quoteProblem(item.sourceDocumentId, item.page, item.quote, corpus);
    if (problem) pushReason(open.reasons, problem);
    if (item.sourceDocumentId !== documentId || !allowed.has(item.page + "\0" + normalizeQuoteText(item.quote))) {
      pushReason(open.reasons, "INVENTED_FACT");
    }
  }
  if (open.reasons.length > 0) return null;
  return {
    candidateId: String(raw.candidateId),
    documentKindId,
    documentId,
    extractionFactId,
    ...(subject ? { subject } : {}),
    sourceRefs: claimedRefs(evidence, extractionFactId),
  };
}

type InstanceIdentity = { entityId: string; instanceId: string; values: string[] };

function instanceKey(entityId: string, instanceId: string): string {
  return entityId + "\0" + instanceId;
}

function identitiesFrom(fields: readonly AcceptedField[], plan: DomainInvestigationPlan, pack: CompiledDomainPack): {
  verified: Map<string, InstanceIdentity>;
  conflicted: Set<string>;
} {
  const grouped = new Map<string, AcceptedField[]>();
  for (const field of fields) {
    const key = instanceKey(field.entityId, field.instanceId);
    const list = grouped.get(key) ?? [];
    list.push(field);
    grouped.set(key, list);
  }
  const verified = new Map<string, InstanceIdentity>();
  const conflicted = new Set<string>();
  const tuples = new Map<string, string[]>();
  for (const [key, group] of grouped) {
    const entity = definitionsOf(pack).get(group[0].entityId);
    if (entity?.kind !== "entity") continue;
    const keys = identityKeyIds(taskFor(plan, entity.id, "BIND_ENTITY"), entity);
    if (!keys) continue;
    const values: string[] = [];
    let complete = true;
    for (const fieldId of keys) {
      const matches = group.filter((field) => field.fieldId === fieldId);
      const distinct = [...new Map(matches.map((field) => [field.value.value, field.value])).values()];
      if (distinct.length !== 1) {
        complete = false;
        conflicted.add(key);
        break;
      }
      values.push(distinct[0].value);
    }
    if (!complete) continue;
    const tuple = entity.id + "\0" + values.join("\0");
    const prior = tuples.get(tuple) ?? [];
    prior.push(key);
    tuples.set(tuple, prior);
    verified.set(key, { entityId: entity.id, instanceId: group[0].instanceId, values });
  }
  for (const keys of tuples.values()) {
    if (keys.length < 2) continue;
    for (const key of keys) {
      verified.delete(key);
      conflicted.add(key);
    }
  }
  return { verified, conflicted };
}

function quoteIdentifiesOther(field: AcceptedField, identities: Map<string, InstanceIdentity>): boolean {
  const own = identities.get(instanceKey(field.entityId, field.instanceId));
  if (!own) return false;
  for (const identity of identities.values()) {
    if (identity.entityId !== field.entityId || identity.instanceId === field.instanceId) continue;
    const namesOther = identity.values.every((value) => field.quotes.some((quote) => containsPhrase(quote, value)));
    const namesOwn = own.values.every((value) => field.quotes.some((quote) => containsPhrase(quote, value)));
    if (namesOther && !namesOwn) return true;
  }
  return false;
}

/**
 * Checks provenance, quote authenticity, endpoint identity, and authored direction.
 * A passing free-text quote is withheld: co-occurrence of the endpoint identities
 * is not relational meaning, and no trusted verifier is called.
 */
function relationshipSupport(
  open: OpenCandidate,
  evidence: CandidateEvidence[],
  plan: DomainInvestigationPlan,
  pack: CompiledDomainPack,
  corpus: PageCorpus,
  identities: Map<string, InstanceIdentity>,
  conflicted: Set<string>,
  fields: readonly AcceptedField[],
): void {
  const raw = open.raw;
  const relationshipId = typeof raw.relationshipId === "string" ? raw.relationshipId : "";
  const fromInstanceId = identifier(raw.fromInstanceId);
  const toInstanceId = identifier(raw.toInstanceId);
  if (!fromInstanceId || !toInstanceId) {
    pushReason(open.reasons, "CANDIDATE_MALFORMED");
    return;
  }
  const task = taskFor(plan, relationshipId, "BIND_RELATIONSHIP");
  if (raw.taskId !== task?.taskId) pushReason(open.reasons, task ? "TASK_MISMATCH" : "UNKNOWN_TASK");
  const definition = definitionsOf(pack).get(relationshipId);
  const relationship = definition?.kind === "relationship" ? definition : null;
  if (!relationship) {
    pushReason(open.reasons, "UNKNOWN_DEFINITION");
    return;
  }
  const from = identities.get(instanceKey(relationship.fromEntityId, fromInstanceId));
  const to = identities.get(instanceKey(relationship.toEntityId, toInstanceId));
  const fromEntity = [...identities.values()].find((identity) => identity.instanceId === fromInstanceId);
  const toEntity = [...identities.values()].find((identity) => identity.instanceId === toInstanceId);
  if (fromEntity && fromEntity.entityId !== relationship.fromEntityId) pushReason(open.reasons, "DIRECTION_MISMATCH");
  if (toEntity && toEntity.entityId !== relationship.toEntityId) pushReason(open.reasons, "DIRECTION_MISMATCH");
  if (conflicted.has(instanceKey(relationship.fromEntityId, fromInstanceId)) || conflicted.has(instanceKey(relationship.toEntityId, toInstanceId))) {
    pushReason(open.reasons, "IDENTITY_CONFLICT");
  }
  if (!from || !to) {
    const fromDeclared = identityKeyIds(taskFor(plan, relationship.fromEntityId, "BIND_ENTITY"), entityOrNull(pack, relationship.fromEntityId));
    const toDeclared = identityKeyIds(taskFor(plan, relationship.toEntityId, "BIND_ENTITY"), entityOrNull(pack, relationship.toEntityId));
    pushReason(open.reasons, fromDeclared && toDeclared ? "INSTANCE_UNVERIFIED" : "RELATIONSHIP_SUPPORT_UNDETERMINED");
  }
  if (relationship.evidenceRequired && evidence.length === 0) pushReason(open.reasons, "MISSING_EVIDENCE");
  if (!relationship.evidenceRequired && evidence.length === 0) pushReason(open.reasons, "RELATIONSHIP_SUPPORT_UNDETERMINED");
  const passing: CandidateEvidence[] = [];
  for (const item of evidence) {
    const problem = quoteProblem(item.sourceDocumentId, item.page, item.quote, corpus);
    if (problem) pushReason(open.reasons, problem);
    else passing.push(item);
  }
  if (evidence.length > 0 && passing.length !== evidence.length) return;
  if (!from || !to || passing.length === 0) return;
  const endpointQuotes = new Set(fields.filter((field) =>
    (field.entityId === relationship.fromEntityId && field.instanceId === fromInstanceId) ||
    (field.entityId === relationship.toEntityId && field.instanceId === toInstanceId))
    .flatMap((field) => field.quotes));
  const independent = passing.filter((item) => {
    const quote = normalizeQuoteText(item.quote);
    const namesBoth = [...from.values, ...to.values].every((value) => containsPhrase(quote, value));
    return namesBoth && !endpointQuotes.has(quote);
  });
  if (independent.length === 0) {
    const onlyEndpointFacts = passing.every((item) => endpointQuotes.has(normalizeQuoteText(item.quote)));
    pushReason(open.reasons, onlyEndpointFacts ? "ENDPOINT_FACTS_ARE_NOT_A_LINK" : "ENDPOINTS_NOT_IDENTIFIED");
    return;
  }
  if (open.reasons.length > 0) return;
  pushReason(open.reasons, "RELATIONSHIP_SEMANTICS_UNVERIFIED");
}

function entityOrNull(pack: CompiledDomainPack, entityId: string): Extract<EffectiveDefinition, { kind: "entity" }> {
  const definition = definitionsOf(pack).get(entityId);
  if (definition?.kind === "entity") return definition;
  return { kind: "entity", id: entityId, label: "", fields: [], origin: { packId: "", version: "", operation: "base" } };
}

function unresolvedRecord(open: OpenCandidate, pack: CompiledDomainPack, fields: FactIndex): UnresolvedCandidate {
  const raw = open.raw;
  const kind = raw.kind === "FIELD" || raw.kind === "DOCUMENT" || raw.kind === "RELATIONSHIP" ? raw.kind : "UNKNOWN";
  const evidence = kind === "FIELD"
    ? fieldEvidence(raw, fields)
    : readEvidence(raw.evidence) ?? [];
  const extractionFactId = typeof raw.extractionFactId === "string" ? raw.extractionFactId : undefined;
  const relationshipId = typeof raw.relationshipId === "string" ? raw.relationshipId : undefined;
  const relationship = relationshipId ? definitionsOf(pack).get(relationshipId) : undefined;
  const reasons = [...open.reasons].sort();
  return {
    candidateId: typeof raw.candidateId === "string" && raw.candidateId.trim() ? raw.candidateId : "candidate-" + open.index,
    kind,
    trust: trustFor(reasons),
    reasons,
    ...(typeof raw.entityId === "string" ? { entityId: raw.entityId } : {}),
    ...(typeof raw.instanceId === "string" ? { instanceId: raw.instanceId } : {}),
    ...(typeof raw.fieldId === "string" ? { fieldId: raw.fieldId } : {}),
    ...(typeof raw.documentId === "string" ? { documentId: raw.documentId } : {}),
    ...(typeof raw.documentKindId === "string" ? { documentKindId: raw.documentKindId } : {}),
    ...(extractionFactId ? { extractionFactId } : {}),
    ...(relationshipId ? { relationshipId } : {}),
    ...(relationship?.kind === "relationship" ? { fromEntityId: relationship.fromEntityId, toEntityId: relationship.toEntityId } : {}),
    ...(typeof raw.fromInstanceId === "string" ? { fromInstanceId: raw.fromInstanceId } : {}),
    ...(typeof raw.toInstanceId === "string" ? { toInstanceId: raw.toInstanceId } : {}),
    sourceRefs: claimedRefs(evidence, kind === "RELATIONSHIP" ? undefined : extractionFactId),
    evidence,
  };
}

function fieldEvidence(raw: ObjectMap, facts: FactIndex): CandidateEvidence[] {
  const documentId = typeof raw.documentId === "string" ? raw.documentId : "";
  const extractionFactId = typeof raw.extractionFactId === "string" ? raw.extractionFactId : "";
  const fact = facts.get(documentId + "\0" + extractionFactId);
  if (!fact) return [];
  return fact.evidence.map((item) => ({ sourceDocumentId: documentId, page: item.page, quote: item.quote }));
}

function toFact(field: AcceptedField): VerifiedFact {
  return {
    id: stableId("F-", {
      entityId: field.entityId,
      instanceId: field.instanceId,
      fieldId: field.fieldId,
      value: field.value,
      documentId: field.documentId,
      extractionFactId: field.extractionFactId,
    }),
    status: "VERIFIED",
    entityId: field.entityId,
    instanceId: field.instanceId,
    fieldId: field.fieldId,
    value: field.value,
    sourceRefs: field.sourceRefs,
  };
}

function conflictsOf(fields: readonly AcceptedField[]): VerifiedCaseFacts["conflicts"] {
  const groups = new Map<string, AcceptedField[]>();
  for (const field of fields) {
    const key = field.entityId + "\0" + field.instanceId + "\0" + field.fieldId;
    const list = groups.get(key) ?? [];
    list.push(field);
    groups.set(key, list);
  }
  const conflicts: VerifiedCaseFacts["conflicts"] = [];
  for (const group of groups.values()) {
    if (group.some((field) => !sameScalar(field.value, group[0].value))) {
      conflicts.push({ entityId: group[0].entityId, instanceId: group[0].instanceId, fieldId: group[0].fieldId });
    }
  }
  return conflicts.sort((left, right) => (left.entityId + left.instanceId + left.fieldId).localeCompare(right.entityId + right.instanceId + right.fieldId));
}

/**
 * Binds candidates that pass the compiled pack, the pinned plan, and authorized pages.
 * Digest mismatches and forbidden verdict fields reject the set and emit no verified facts.
 * Unresolved candidates stay unresolved. Free-text relationships are never marked VERIFIED.
 */
export function bindInvestigationCandidates(input: CandidateBinderInput): CandidateBinderResult {
  const issues: BinderIssue[] = [];
  if (!isObject(input?.pack) || input.pack.schema !== DOMAIN_PACK_RUNTIME_SCHEMA || !nonempty(input.pack.identity?.digest)) {
    issue(issues, "pack_snapshot_required", "$.pack", "Binding starts from a compiled domain-pack snapshot.");
  }
  if (!isObject(input?.plan) || input.plan.schema !== "hive.domain-investigation-plan/1" || !nonempty(input.plan.digest)) {
    issue(issues, "plan_required", "$.plan", "Binding starts from a compiled investigation plan.");
  }
  if (issues.length) return fail(issues);
  if (input.plan.pack.digest !== input.pack.identity.digest || input.plan.pack.packId !== input.pack.identity.packId || input.plan.pack.version !== input.pack.identity.version) {
    issue(issues, "pack_mismatch", "$.plan.pack", "The plan is not pinned to this compiled pack.");
  }
  forbiddenKeys(input.candidates, "$.candidates", issues);
  if (!isObject(input.candidates) || !exactKeys(input.candidates, ENVELOPE_KEYS)) {
    issue(issues, "candidates_invalid", "$.candidates", "Candidates must be one investigation-candidate envelope.");
    return fail(issues);
  }
  if (input.candidates.schema !== INVESTIGATION_CANDIDATES_SCHEMA) {
    issue(issues, "schema_invalid", "$.candidates.schema", "Unsupported investigation-candidate schema.");
  }
  if (input.candidates.planDigest !== input.plan.digest) issue(issues, "digest_mismatch", "$.candidates.planDigest", "Candidate plan digest does not match the pinned plan.");
  if (input.candidates.packDigest !== input.pack.identity.digest) issue(issues, "digest_mismatch", "$.candidates.packDigest", "Candidate pack digest does not match the compiled pack.");
  const extractionDigest = authorizedExtractionDigest(input.extractions ?? []);
  if (input.candidates.extractionDigest !== extractionDigest) {
    issue(issues, "digest_mismatch", "$.candidates.extractionDigest", "Candidate extraction digest does not match the authorized extractions.");
  }
  if (!Array.isArray(input.candidates.candidates)) {
    issue(issues, "candidates_invalid", "$.candidates.candidates", "Candidates must be a list.");
  }
  const corpus = buildCorpus(input.documents ?? [], issues);
  const facts = indexFacts(input.extractions ?? [], issues);
  if (issues.length || !corpus || !facts || !Array.isArray(input.candidates.candidates)) return fail(issues);

  const seenIds = new Set<string>();
  const opened: OpenCandidate[] = [];
  input.candidates.candidates.forEach((candidate, index) => {
    const path = "$.candidates.candidates[" + index + "]";
    if (!isObject(candidate)) {
      issue(issues, "candidate_invalid", path, "A candidate must be an object.");
      return;
    }
    const candidateId = identifier(candidate.candidateId);
    if (!candidateId) {
      issue(issues, "candidate_invalid", path + ".candidateId", "Candidate id is required.");
      return;
    }
    if (seenIds.has(candidateId)) issue(issues, "duplicate_candidate", path + ".candidateId", "Candidate ids must be unique.");
    seenIds.add(candidateId);
    opened.push({ index, raw: { ...candidate, candidateId }, reasons: [] });
  });
  if (issues.length) return fail(issues);

  const acceptedFields: AcceptedField[] = [];
  const fieldOpens: OpenCandidate[] = [];
  const documentOpens: OpenCandidate[] = [];
  const relationshipOpens: OpenCandidate[] = [];
  for (const open of opened) {
    if (open.raw.kind === "FIELD") {
      fieldOpens.push(open);
      const accepted = acceptField(open, input.plan, input.pack, facts, corpus);
      if (accepted) acceptedFields.push(accepted);
    } else if (open.raw.kind === "DOCUMENT") documentOpens.push(open);
    else if (open.raw.kind === "RELATIONSHIP") relationshipOpens.push(open);
    else pushReason(open.reasons, "CANDIDATE_MALFORMED");
  }

  const instanceEntities = new Map<string, Set<string>>();
  for (const field of acceptedFields) {
    const entities = instanceEntities.get(field.instanceId) ?? new Set<string>();
    entities.add(field.entityId);
    instanceEntities.set(field.instanceId, entities);
  }
  const sharedInstances = new Set([...instanceEntities.entries()].filter(([, entities]) => entities.size > 1).map(([instanceId]) => instanceId));
  const factUsers = new Map<string, Set<string>>();
  for (const field of acceptedFields) {
    const key = field.documentId + "\0" + field.extractionFactId;
    const users = factUsers.get(key) ?? new Set<string>();
    users.add(instanceKey(field.entityId, field.instanceId));
    factUsers.set(key, users);
  }
  const sharedFacts = new Set([...factUsers.entries()].filter(([, users]) => users.size > 1).map(([key]) => key));
  let fields = acceptedFields.filter((field) => {
    const shared = sharedInstances.has(field.instanceId) || sharedFacts.has(field.documentId + "\0" + field.extractionFactId);
    if (!shared) return true;
    const open = fieldOpens.find((item) => item.raw.candidateId === field.candidateId);
    if (open) pushReason(open.reasons, "CROSS_INSTANCE");
    return false;
  });

  let identity = identitiesFrom(fields, input.plan, input.pack);
  fields = fields.filter((field) => {
    if (!quoteIdentifiesOther(field, identity.verified)) return true;
    const open = fieldOpens.find((item) => item.raw.candidateId === field.candidateId);
    if (open) pushReason(open.reasons, "CROSS_INSTANCE");
    return false;
  });
  identity = identitiesFrom(fields, input.plan, input.pack);

  const acceptedDocuments: AcceptedDocument[] = [];
  for (const open of documentOpens) {
    const accepted = acceptDocument(open, input.plan, input.pack, facts, corpus);
    if (!accepted) continue;
    if (accepted.subject) {
      const key = instanceKey(accepted.subject.entityId, accepted.subject.instanceId);
      if (!identity.verified.has(key)) {
        pushReason(open.reasons, identity.conflicted.has(key) ? "IDENTITY_CONFLICT" : "INSTANCE_UNVERIFIED");
        continue;
      }
    }
    acceptedDocuments.push(accepted);
  }

  for (const open of relationshipOpens) {
    if (open.raw.kind !== "RELATIONSHIP" || !exactKeys(open.raw, RELATIONSHIP_KEYS)) {
      pushReason(open.reasons, "CANDIDATE_MALFORMED");
      continue;
    }
    const evidence = readEvidence(open.raw.evidence);
    if (!evidence) {
      pushReason(open.reasons, "CANDIDATE_MALFORMED");
      continue;
    }
    relationshipSupport(open, evidence, input.plan, input.pack, corpus, identity.verified, identity.conflicted, fields);
  }

  const verifiedFacts = [...new Map(fields.map((field) => [toFact(field).id, toFact(field)])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  const verifiedDocuments = [...new Map(acceptedDocuments.map((document) => {
    const fact: VerifiedDocumentFact = {
      id: stableId("D-", {
        documentKindId: document.documentKindId,
        documentId: document.documentId,
        extractionFactId: document.extractionFactId,
        subject: document.subject ?? null,
      }),
      status: "VERIFIED",
      documentKindId: document.documentKindId,
      ...(document.subject ? { subject: document.subject } : {}),
      sourceRefs: document.sourceRefs,
    };
    return [fact.id, fact] as const;
  })).values()].sort((left, right) => left.id.localeCompare(right.id));
  // Empty until a trusted verifier accepts relational meaning. DP-2 reads only this array.
  const verifiedRelationships: VerifiedRelationshipFact[] = [];
  const verified: VerifiedCaseFacts = {
    schema: VERIFIED_CASE_FACTS_SCHEMA,
    coverage: "INCOMPLETE",
    facts: verifiedFacts,
    documents: verifiedDocuments,
    relationships: verifiedRelationships,
    conflicts: conflictsOf(fields),
  };
  const unresolvedCandidates = opened
    .filter((open) => open.reasons.length > 0)
    .map((open) => unresolvedRecord(open, input.pack, facts))
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId) || left.kind.localeCompare(right.kind));
  const unresolved: UnresolvedCandidates = {
    schema: UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
    candidates: unresolvedCandidates,
  };
  const digest = packDigest({ verified, unresolved });
  return freezeDeep({ ok: true as const, verified, unresolved, digest });
}
