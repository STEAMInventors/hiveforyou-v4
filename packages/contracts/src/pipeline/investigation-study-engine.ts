/**
 * Rebuild Study bridge from verified hive.doc-extraction/1 facts to hive.canonical-study/1.
 *
 * The model may propose which fact belongs on which pack field. Hive copies provenance
 * from the extraction, refuses conversions the written value does not already state,
 * and accepts a study only after the binder, the ledger, and canonical verification agree.
 * This module does not call a model. A relationship is admitted only by the typed-source
 * verifier. A day count is the ledger's result, not a number from the proposal.
 */
import { compareDecimal, decimalFromPlain, evaluateFormula, formatDecimal } from "../analysis/decimal-formula";
import type { CanonicalGap, CanonicalStudy, SpineSource } from "./canonical-study-contracts";
import { parseCanonicalStudy, verifyCanonicalStudy } from "./canonical-study-contracts";
import { measurementRoleForField, type CoordinatedInvestigationRecord } from "./domain-investigation-agent";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  binderReasonRejectsRun,
  bindInvestigationCandidates,
  INVESTIGATION_CANDIDATES_SCHEMA,
  type AuthorizedDocument,
  type CandidateEvidence,
  type UnresolvedCandidates,
} from "./domain-investigation-binder";
import { buildCoverageLedger, investigationEvidenceDigest, type DomainInvestigationLedger, type LedgerRow } from "./domain-investigation-ledger";
import {
  compileInvestigationPlan,
  type DomainInvestigationPlan,
  type SupplementalArtifacts,
} from "./domain-investigation-plan";
import { calendarDayIndex, type VerifiedCaseFacts, type VerifiedFieldConflict } from "./domain-pack-rules";
import {
  assessRelationshipTypedSource,
  authoredRelationshipDirection,
  decideRelationshipVerification,
  relationshipCandidateContentDigest,
  relationshipStructureDigest,
  RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA,
  RELATIONSHIP_VERIFICATION_CONTEXT_SCHEMA,
  type RelationshipVerificationRecord,
} from "./domain-relationship-verification";

export { authoredRelationshipDirection, relationshipStructureDigest, RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA };
import {
  type CompiledDomainPack,
  type DomainPackSource,
  type FieldValueType,
  type PackPredicate,
} from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import type { CanonicalChainItem, CheckVerdict, PersonaCoverageItem } from "./pack-canonicalize";
import { normalizeQuoteText } from "./verify-quotes";

export const FIELD_MAPPING_REQUEST_SCHEMA = "hive.field-mapping-request/1" as const;
export const FIELD_MAPPING_PROPOSAL_SCHEMA = "hive.field-mapping-proposal/1" as const;

export const INVESTIGATION_ENGINE_FAILURES = [
  "EMPTY_CANDIDATES",
  "INVALID_EVIDENCE",
  "VERIFICATION_FAILED",
  "INCOMPLETE_DOCUMENTS",
  "MAPPING_INVALID",
  "RECORD_TEXT_BOUNDARY",
  "PACK_COMPILE_FAILED",
  "PLAN_COMPILE_FAILED",
  "BIND_FAILED",
  "LEDGER_FAILED",
] as const;
export type InvestigationEngineFailureCode = (typeof INVESTIGATION_ENGINE_FAILURES)[number];

const MAPPING_KEYS = ["documentId", "extractionFactId", "entityId", "instanceId", "fieldId", "valueType", "value"] as const;
const RELATIONSHIP_KEYS = ["documentId", "extractionFactId", "relationshipId", "fromInstanceId", "toInstanceId"] as const;
const PROPOSAL_KEYS = ["schema", "mappings", "relationships"] as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALUE_TYPES = new Set<FieldValueType>(["TEXT", "NUMBER", "DATE", "BOOLEAN", "MONEY", "QUANTITY"]);
const FORBIDDEN_KEYS = new Set(["outcome", "daysBetween", "verdict", "jurisdiction", "applicability", "status", "calculation", "conclusion"]);
const QUOTE_KEYS = new Set(["quote", "quotes", "pageText", "page_text", "recordText", "text"]);

export type InvestigationEnginePin = {
  readonly hiveId: string;
  readonly packSource: DomainPackSource;
  readonly artifacts: SupplementalArtifacts;
  readonly pages: readonly AuthorizedDocument[];
  /** Compiled relationship structures. Absent means the case has no typed source. */
  readonly relationshipStructures?: readonly unknown[];
};

export type InvestigationCompleteness = {
  readonly complete: boolean;
  readonly unfinished: readonly string[];
};

export type InvestigationEngineSuccess = {
  readonly ok: true;
  readonly study: CanonicalStudy;
  readonly completeness: InvestigationCompleteness;
  readonly packDigest: string;
  readonly planDigest: string;
  readonly evidenceDigest: string;
  readonly ledgerDigest: string;
};

export type InvestigationEngineResult =
  | InvestigationEngineSuccess
  | { readonly ok: false; readonly code: InvestigationEngineFailureCode };

type ObjectMap = Record<string, unknown>;
type PreparedStudy = { pack: CompiledDomainPack; plan: DomainInvestigationPlan };
type MappingRow = {
  documentId: string;
  extractionFactId: string;
  entityId: string;
  instanceId: string;
  fieldId: string;
  valueType: FieldValueType;
  value: string;
};
type RelationshipRow = {
  documentId: string;
  extractionFactId: string;
  relationshipId: string;
  fromInstanceId: string;
  toInstanceId: string;
};
type Proposal = { mappings: MappingRow[]; relationships: RelationshipRow[] };
type UnsupportedConversion = { extractionFactId: string; documentId: string; valueAsWritten: string; page: number | null };

const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);

function exactKeys(value: ObjectMap, allowed: readonly string[]): boolean {
  const ok = new Set<string>(allowed);
  return Object.keys(value).every((key) => ok.has(key));
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

function forbidden(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => forbidden(item));
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEYS.has(key) || QUOTE_KEYS.has(key) || forbidden(child));
}

function phraseInQuote(quote: string, phrase: string): boolean {
  const needle = normalizeQuoteText(phrase);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?<![A-Za-z0-9])" + escaped + "(?![A-Za-z0-9])").test(normalizeQuoteText(quote));
}

function valueAlreadyWritten(valueType: FieldValueType, written: string, proposed: string): boolean {
  if (proposed !== written) return false;
  if (valueType === "TEXT") return written.length > 0;
  if (valueType === "BOOLEAN") return written === "true" || written === "false";
  if (valueType === "DATE") return ISO_DATE.test(written) && calendarDayIndex(written) !== null;
  if (valueType === "NUMBER" || valueType === "MONEY" || valueType === "QUANTITY") return /^[0-9]+(?:\.[0-9]+)?$/.test(written);
  return false;
}

function taskId(plan: DomainInvestigationPlan, definitionId: string, taskKind: string): string | null {
  return plan.tasks.find((task) => task.definitionId === definitionId && task.taskKind === taskKind)?.taskId ?? null;
}

function candidateId(kind: string, material: unknown): string {
  return kind + packDigest(material).slice(0, 20);
}

function factKey(documentId: string, factId: string): string {
  return documentId + "\0" + factId;
}

function indexFacts(extractions: readonly DocExtraction[]): Map<string, { extraction: DocExtraction; fact: ExtractionFact }> | null {
  const index = new Map<string, { extraction: DocExtraction; fact: ExtractionFact }>();
  for (const extraction of extractions) {
    if (extraction.schema !== "hive.doc-extraction/1") return null;
    for (const fact of extraction.facts) {
      const key = factKey(extraction.documentId, fact.id);
      if (index.has(key)) return null;
      index.set(key, { extraction, fact });
    }
  }
  return index;
}

/** Field and relationship catalog plus fact values. Page text is not included. */
export function buildFieldMappingRequest(pack: CompiledDomainPack, extractions: readonly DocExtraction[]) {
  const fields = pack.definitions
    .filter((definition) => definition.kind === "entity")
    .flatMap((definition) => definition.fields.map((field) => ({
      entityId: definition.id,
      fieldId: field.id,
      valueType: field.valueType,
    })))
    .sort((left, right) => (left.entityId + left.fieldId).localeCompare(right.entityId + right.fieldId));
  const relationships = pack.definitions
    .filter((definition) => definition.kind === "relationship")
    .map((definition) => ({
      relationshipId: definition.id,
      fromEntityId: definition.fromEntityId,
      toEntityId: definition.toEntityId,
    }))
    .sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));
  const facts = [...extractions]
    .sort((left, right) => left.documentId.localeCompare(right.documentId))
    .flatMap((extraction) => [...extraction.facts]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((fact) => ({
        documentId: extraction.documentId,
        extractionFactId: fact.id,
        attribute: fact.attribute,
        valueAsWritten: fact.valueAsWritten,
        pageNumbers: fact.evidence.map((item) => item.page),
      })));
  return {
    schema: FIELD_MAPPING_REQUEST_SCHEMA,
    instruction: "Propose field and relationship mappings only. Do not state findings, calculations, relationship conclusions, or legal conclusions. Return hive.field-mapping-proposal/1.",
    fields,
    relationships,
    facts,
  };
}

/** True when serialized payload contains a page that is not itself one fact's written value. */
export function fieldMappingRequestLeaksRecordText(
  payload: unknown,
  pages: readonly { text: string }[],
): boolean {
  if (forbidden(payload)) return true;
  const serialized = JSON.stringify(payload);
  const allowed = new Set<string>();
  if (isObject(payload) && Array.isArray(payload.facts)) {
    for (const fact of payload.facts) {
      if (isObject(fact) && typeof fact.valueAsWritten === "string") allowed.add(fact.valueAsWritten);
    }
  }
  return pages.some((page) => {
    const text = page.text;
    return text.length > 0 && serialized.includes(text) && !allowed.has(text);
  });
}

export function prepareInvestigationStudy(pin: Pick<InvestigationEnginePin, "packSource" | "artifacts">):
  | { ok: true; prepared: PreparedStudy }
  | { ok: false; code: "PACK_COMPILE_FAILED" | "PLAN_COMPILE_FAILED" } {
  const compiled = compileDomainPack(pin.packSource);
  if (!compiled.ok) return { ok: false, code: "PACK_COMPILE_FAILED" };
  const artifacts = pin.artifacts;
  const digests = {
    ontology: packDigest(artifacts.ontology),
    authorityRegister: packDigest(artifacts.authorityRegister),
    conflictPatterns: packDigest(artifacts.conflictPatterns),
    stateOverlays: packDigest(artifacts.stateOverlays),
    factClasses: packDigest(artifacts.factClasses),
    workflowCoverage: packDigest(artifacts.workflowCoverage),
    unsupportedOperators: packDigest(artifacts.unsupportedOperators),
  };
  const planned = compileInvestigationPlan({ pack: compiled.value, artifacts, digests });
  if (!planned.ok) return { ok: false, code: "PLAN_COMPILE_FAILED" };
  return { ok: true, prepared: { pack: compiled.value, plan: planned.value } };
}

function readProposal(raw: unknown): Proposal | null {
  if (!isObject(raw) || raw.schema !== FIELD_MAPPING_PROPOSAL_SCHEMA || !exactKeys(raw, PROPOSAL_KEYS)) return null;
  if (forbidden(raw) || !Array.isArray(raw.mappings) || !Array.isArray(raw.relationships)) return null;
  const mappings: MappingRow[] = [];
  for (const item of raw.mappings) {
    if (!isObject(item) || !exactKeys(item, MAPPING_KEYS)) return null;
    const documentId = identifier(item.documentId);
    const extractionFactId = identifier(item.extractionFactId);
    const entityId = identifier(item.entityId);
    const instanceId = identifier(item.instanceId);
    const fieldId = identifier(item.fieldId);
    const valueType = typeof item.valueType === "string" && VALUE_TYPES.has(item.valueType as FieldValueType)
      ? item.valueType as FieldValueType
      : null;
    if (!documentId || !extractionFactId || !entityId || !instanceId || !fieldId || !valueType || typeof item.value !== "string") return null;
    mappings.push({ documentId, extractionFactId, entityId, instanceId, fieldId, valueType, value: item.value });
  }
  const relationships: RelationshipRow[] = [];
  for (const item of raw.relationships) {
    if (!isObject(item) || !exactKeys(item, RELATIONSHIP_KEYS)) return null;
    const documentId = identifier(item.documentId);
    const extractionFactId = identifier(item.extractionFactId);
    const relationshipId = identifier(item.relationshipId);
    const fromInstanceId = identifier(item.fromInstanceId);
    const toInstanceId = identifier(item.toInstanceId);
    if (!documentId || !extractionFactId || !relationshipId || !fromInstanceId || !toInstanceId) return null;
    relationships.push({ documentId, extractionFactId, relationshipId, fromInstanceId, toInstanceId });
  }
  return { mappings, relationships };
}

function fieldType(pack: CompiledDomainPack, entityId: string, fieldId: string): FieldValueType | null {
  const definition = pack.definitions.find((item) => item.kind === "entity" && item.id === entityId);
  if (!definition || definition.kind !== "entity") return null;
  return definition.fields.find((field) => field.id === fieldId)?.valueType ?? null;
}

type Adapted = {
  candidates: ObjectMap[];
  unsupported: UnsupportedConversion[];
};

function adaptCandidates(
  prepared: PreparedStudy,
  extractions: readonly DocExtraction[],
  proposal: Proposal,
): { ok: true; adapted: Adapted } | { ok: false; code: "INVALID_EVIDENCE" | "EMPTY_CANDIDATES" } {
  const facts = indexFacts(extractions);
  if (!facts) return { ok: false, code: "INVALID_EVIDENCE" };
  const candidates: ObjectMap[] = [];
  const unsupported: UnsupportedConversion[] = [];
  const seen = new Set<string>();
  for (const mapping of proposal.mappings) {
    const located = facts.get(factKey(mapping.documentId, mapping.extractionFactId));
    if (!located || located.extraction.documentId !== mapping.documentId) return { ok: false, code: "INVALID_EVIDENCE" };
    const fact = located.fact;
    if (fact.evidence.length === 0 || fact.evidence.some((item) => item.quote.trim() === "")) return { ok: false, code: "INVALID_EVIDENCE" };
    const expectedType = fieldType(prepared.pack, mapping.entityId, mapping.fieldId);
    const bindTask = taskId(prepared.plan, mapping.entityId, "BIND_ENTITY");
    if (!expectedType || !bindTask) return { ok: false, code: "INVALID_EVIDENCE" };
    if (expectedType !== mapping.valueType || !valueAlreadyWritten(mapping.valueType, fact.valueAsWritten, mapping.value)) {
      unsupported.push({
        extractionFactId: fact.id,
        documentId: mapping.documentId,
        valueAsWritten: fact.valueAsWritten,
        page: fact.evidence[0]?.page ?? null,
      });
      continue;
    }
    if (expectedType === "QUANTITY") {
      const unit = fieldUnit(prepared.pack, mapping.entityId, mapping.fieldId);
      const quotes = fact.evidence.map((item) => item.quote);
      if (!unit || !quotes.some((quote) => phraseInQuote(quote, unit))) {
        unsupported.push({
          extractionFactId: fact.id,
          documentId: mapping.documentId,
          valueAsWritten: fact.valueAsWritten,
          page: fact.evidence[0]?.page ?? null,
        });
        continue;
      }
      if (!fact.evidence.some((item) => phraseInQuote(item.quote, mapping.value))) return { ok: false, code: "INVALID_EVIDENCE" };
      const quantityId = candidateId("c", { kind: "FIELD", documentId: mapping.documentId, extractionFactId: fact.id, fieldId: mapping.fieldId });
      if (seen.has(quantityId)) return { ok: false, code: "INVALID_EVIDENCE" };
      seen.add(quantityId);
      candidates.push({
        candidateId: quantityId,
        taskId: bindTask,
        kind: "FIELD",
        entityId: mapping.entityId,
        instanceId: mapping.instanceId,
        fieldId: mapping.fieldId,
        documentId: mapping.documentId,
        extractionFactId: fact.id,
        value: { valueType: "QUANTITY", value: fact.valueAsWritten, unit },
      });
      continue;
    }
    if (!fact.evidence.some((item) => phraseInQuote(item.quote, mapping.value))) return { ok: false, code: "INVALID_EVIDENCE" };
    const id = candidateId("c", { kind: "FIELD", documentId: mapping.documentId, extractionFactId: fact.id, fieldId: mapping.fieldId });
    if (seen.has(id)) return { ok: false, code: "INVALID_EVIDENCE" };
    seen.add(id);
    candidates.push({
      candidateId: id,
      taskId: bindTask,
      kind: "FIELD",
      entityId: mapping.entityId,
      instanceId: mapping.instanceId,
      fieldId: mapping.fieldId,
      documentId: mapping.documentId,
      extractionFactId: fact.id,
      value: { valueType: mapping.valueType, value: fact.valueAsWritten },
    });
  }
  for (const link of proposal.relationships) {
    const located = facts.get(factKey(link.documentId, link.extractionFactId));
    if (!located) return { ok: false, code: "INVALID_EVIDENCE" };
    const fact = located.fact;
    const bindTask = taskId(prepared.plan, link.relationshipId, "BIND_RELATIONSHIP");
    if (!bindTask || fact.evidence.length === 0) return { ok: false, code: "INVALID_EVIDENCE" };
    const evidence: CandidateEvidence[] = fact.evidence.map((item) => ({
      sourceDocumentId: link.documentId,
      page: item.page,
      quote: item.quote,
    }));
    const id = candidateId("r", { kind: "RELATIONSHIP", documentId: link.documentId, extractionFactId: fact.id, relationshipId: link.relationshipId });
    if (seen.has(id)) return { ok: false, code: "INVALID_EVIDENCE" };
    seen.add(id);
    candidates.push({
      candidateId: id,
      taskId: bindTask,
      kind: "RELATIONSHIP",
      relationshipId: link.relationshipId,
      fromInstanceId: link.fromInstanceId,
      toInstanceId: link.toInstanceId,
      evidence,
    });
  }
  if (candidates.length === 0 && unsupported.length === 0) return { ok: false, code: "EMPTY_CANDIDATES" };
  return { ok: true, adapted: { candidates, unsupported } };
}

function evidenceFactId(excerptId: string | undefined, known: ReadonlySet<string>): string | null {
  return excerptId && known.has(excerptId) ? excerptId : null;
}

const PROGRESS_CLAIM = /\b(met|achieved|mastered|improved|on track|made progress|has been met)\b/i;
const EMPTY_RECORD: CoordinatedInvestigationRecord = {
  intentText: "",
  documentRoles: [],
  measurements: [],
  assessments: [],
  determinations: [],
  conflicts: [],
  gaps: [],
  answers: [],
};

function readableField(fieldId: string): string {
  return fieldId.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
}

function definitionLabel(pack: CompiledDomainPack, id: string): string {
  return pack.definitions.find((definition) => definition.id === id)?.label ?? id;
}

function findingLabel(pack: CompiledDomainPack, entityId: string, fieldId: string, value: string, page: string | undefined): string {
  const entity = definitionLabel(pack, entityId);
  const role = measurementRoleForField(entity, fieldId);
  const prefix = role === "BASELINE" ? "Baseline" : role === "TARGET" ? "Target" : role === "ACTUAL" ? "Later measurement" : null;
  const sentence = `${entity} ${readableField(fieldId)} is ${value}${page ? ` (page ${page})` : ""}`;
  const text = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return prefix ? `${prefix}: ${text}` : text;
}

function excerptIds(refs: readonly { excerptId?: string }[], known: ReadonlySet<string>): string[] {
  return [...new Set(refs.flatMap((ref) => ref.excerptId && known.has(ref.excerptId) ? [ref.excerptId] : []))];
}

function evidenceInsufficient(row: LedgerRow, coverage: DomainInvestigationLedger["evidenceCoverage"]): boolean {
  if (coverage === "INCOMPLETE" || row.reasonCodes.includes("INCOMPLETE_COVERAGE") || row.reasonCodes.includes("SOURCE_MISSING") || row.reasonCodes.includes("NEGATION_OF_UNKNOWN")) {
    return true;
  }
  return false;
}

function verdictFor(row: LedgerRow, coverage: DomainInvestigationLedger["evidenceCoverage"]): CheckVerdict {
  if (
    row.taskKind === "REVIEW_CHECK"
    || row.reasonCodes.includes("REVIEW_REQUIRED")
    || row.disposition === "NOT_EVALUATED"
    || row.disposition === "DEFERRED"
    || row.disposition === "UNRESOLVED_INSTANCE"
    || row.disposition === "PRESENTATION"
  ) return "NOT_ASSESSED";
  if (row.disposition === "DISABLED") return "NOT_APPLICABLE";
  if (row.disposition === "CONFLICT") return "CONFLICT";
  if (evidenceInsufficient(row, coverage)) return "NOT_ASSESSED";
  if (row.disposition === "ESTABLISHED" || row.disposition === "COMPUTED") return "SHOWN";
  if (row.disposition === "NOT_SATISFIED") return "NOT_SHOWN";
  if (row.disposition === "NOT_ESTABLISHED") {
    const absent = row.reasonCodes.includes("FIELD_MISSING") || row.reasonCodes.includes("DOCUMENT_MISSING") || row.reasonCodes.includes("COMPARE_FAILS");
    return coverage === "COMPLETE" && absent ? "NOT_SHOWN" : "NOT_ASSESSED";
  }
  return "NOT_ASSESSED";
}

function checklistNote(verdict: CheckVerdict, row: LedgerRow, packDigestValue: string, planDigestValue: string): string {
  const digest = `pack ${packDigestValue} plan ${planDigestValue}`;
  if (verdict === "NOT_ASSESSED") {
    if (row.taskKind === "REVIEW_CHECK" || row.reasonCodes.includes("REVIEW_REQUIRED")) {
      return `Not assessed. The compiled criterion is review only, so document coverage is not a legal conclusion. ${digest}`;
    }
    return `Not assessed. The saved evidence is not sufficient. ${digest}`;
  }
  if (verdict === "SHOWN") return "Established from cited evidence.";
  if (verdict === "NOT_SHOWN") return "The saved documents do not show this.";
  if (verdict === "CONFLICT") return "Cited values conflict.";
  return "This check does not apply to the saved record.";
}

function checklistFrom(ledger: DomainInvestigationLedger, known: ReadonlySet<string>, packDigestValue: string, planDigestValue: string) {
  const grouped = new Map<string, { verdict: CheckVerdict; factIds: string[]; row: LedgerRow }>();
  const rank: Record<CheckVerdict, number> = { CONFLICT: 5, SHOWN: 4, PARTLY_SHOWN: 3, NOT_SHOWN: 2, NOT_APPLICABLE: 1, NOT_ASSESSED: 0 };
  for (const row of ledger.rows) {
    if (row.taskKind !== "REVIEW_CHECK" && row.taskKind !== "EVALUATE_CHECK") continue;
    const verdict = verdictFor(row, ledger.evidenceCoverage);
    const factIds = excerptIds(row.sourceRefs, known);
    const current = grouped.get(row.definitionId);
    if (!current || rank[verdict] > rank[current.verdict]) grouped.set(row.definitionId, { verdict, factIds, row });
    else if (verdict === current.verdict) current.factIds = [...new Set([...current.factIds, ...factIds])];
  }
  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([checkId, item]) => {
      let verdict = item.verdict;
      let factIds = item.factIds;
      if ((verdict === "SHOWN" || verdict === "PARTLY_SHOWN" || verdict === "CONFLICT") && factIds.length === 0) {
        verdict = "NOT_ASSESSED";
      }
      return { checkId, verdict, factIds, note: checklistNote(verdict, item.row, packDigestValue, planDigestValue) };
    });
}

function documentMatches(extraction: DocExtraction, phrases: readonly string[]): boolean {
  const haystack = `${extraction.fileName} ${extraction.document.documentType} ${extraction.document.titleAsPrinted}`.toLowerCase();
  return phrases.some((phrase) => phrase.trim().length >= 8 && haystack.includes(phrase.trim().toLowerCase()));
}

function quoteNames(quote: string, name: string): boolean {
  const left = normalizeQuoteText(name).toLowerCase();
  const right = normalizeQuoteText(quote).toLowerCase();
  return left.length >= 8 && right.includes(left);
}

function quoteBacked(pages: readonly AuthorizedDocument[], documentId: string, page: number, quote: string): boolean {
  return quoteBackedRole({ documentId, page, quote }, pages);
}

function namedByVerifiedQuote(
  extractions: readonly DocExtraction[],
  pages: readonly AuthorizedDocument[],
  names: readonly string[],
): boolean {
  for (const extraction of extractions) {
    for (const fact of extraction.facts) {
      for (const evidence of fact.evidence) {
        if (!quoteBacked(pages, extraction.documentId, evidence.page, evidence.quote)) continue;
        if (names.some((name) => quoteNames(evidence.quote, name))) return true;
      }
    }
    for (const referenced of extraction.referencedDocuments) {
      if (!quoteBacked(pages, extraction.documentId, referenced.page, referenced.quote)) continue;
      if (names.some((name) => quoteNames(referenced.quote, name))) return true;
    }
  }
  return false;
}

function blankLabelMatches(label: string, entityLabel: string, fieldId: string): boolean {
  const needle = normalizeQuoteText(label).toLowerCase();
  if (needle.length < 3) return false;
  const field = normalizeQuoteText(readableField(fieldId)).toLowerCase();
  const id = normalizeQuoteText(fieldId).toLowerCase();
  const combined = normalizeQuoteText(`${entityLabel} ${readableField(fieldId)}`).toLowerCase();
  return needle === field || needle === id || needle === combined;
}

function intentQuestions(text: string): string[] {
  return text.split("?").map((part) => part.trim()).filter((part) => part.length >= 8).map((part) => `${part}?`);
}

function tokensOf(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 4));
}

type StudyFact = {
  entityId: string;
  instanceId: string;
  fieldId: string;
  value: string;
  documentId: string;
  extractionFactId: string;
  page: string | undefined;
};

const NUMBER_VALUE = /^[0-9]+(?:\.[0-9]+)?$/;
const DOCUMENT_DATE_FIELDS = ["effectiveStartDate", "startDate", "documentDate", "determinationDate", "meetingDate", "noticeDate"];

function documentedOrientation(
  documentId: string,
  facts: readonly StudyFact[],
  keyDate: string | null,
): { date: string | null; version: string | null } {
  let date = keyDate;
  for (const fieldId of DOCUMENT_DATE_FIELDS) {
    const fact = facts.find((item) => item.documentId === documentId && item.fieldId === fieldId && ISO_DATE.test(item.value));
    if (fact) {
      date = fact.value;
      break;
    }
  }
  const version = facts.find((item) => item.documentId === documentId && /version/i.test(item.fieldId) && item.value.trim() !== "");
  return { date, version: version?.value ?? null };
}

function chainLinkMatches(link: string, value: string): boolean {
  const left = normalizeQuoteText(link).toLowerCase();
  const right = normalizeQuoteText(value).toLowerCase();
  if (left.length < 8 || right.length < 8) return false;
  return right.includes(left) || left.includes(right);
}

function projectChains(
  pack: CompiledDomainPack,
  relationships: ReadonlyArray<{ relationshipId: string; factIds: readonly string[] }>,
): CanonicalChainItem[] {
  const admitted = relationships.flatMap((link) => {
    const definition = pack.definitions.find((item) => item.kind === "relationship" && item.id === link.relationshipId);
    if (!definition || definition.kind !== "relationship" || link.factIds.length === 0) return [];
    return [{ label: definition.label, factIds: [...link.factIds].sort() }];
  });
  return pack.definitions.flatMap((definition) => {
    if (definition.kind !== "chain") return [];
    return [{
      chainId: definition.id,
      rows: [{
        label: definition.label,
        links: definition.links.map((link) => {
          const match = admitted.find((item) => chainLinkMatches(link, item.label));
          return match ? { factIds: match.factIds } : { unresolved: true as const };
        }),
      }],
    }];
  });
}

function plainDifference(left: string, right: string): string | null {
  const evaluated = evaluateFormula({ op: "-", args: [{ value: left }, { value: right }] }, () => null);
  return evaluated.ok ? formatDecimal(evaluated.value) : null;
}

function fieldUnit(pack: CompiledDomainPack, entityId: string, fieldId: string): string {
  const entity = pack.definitions.find((item) => item.kind === "entity" && item.id === entityId);
  if (!entity || entity.kind !== "entity") return "";
  return entity.fields.find((field) => field.id === fieldId)?.unit ?? "";
}

function withUnit(value: string, unit: string): string {
  return unit ? `${value} ${unit}` : value;
}

function applicabilityOf(predicate: PackPredicate, facts: readonly StudyFact[]): "APPLIES" | "DOES_NOT_APPLY" | "UNDECIDED" {
  switch (predicate.op) {
    case "REVIEW_REQUIRED":
    case "COMPARE":
    case "DOCUMENT_PRESENT":
      return "UNDECIDED";
    case "FIELD_PRESENT":
      // A missing field is unexamined, not proof that the condition is absent.
      return facts.some((fact) => fact.entityId === predicate.entityId && fact.fieldId === predicate.fieldId) ? "APPLIES" : "UNDECIDED";
    case "ALL": {
      const states = predicate.conditions.map((condition) => applicabilityOf(condition, facts));
      if (states.includes("UNDECIDED")) return "UNDECIDED";
      if (states.includes("DOES_NOT_APPLY")) return "DOES_NOT_APPLY";
      return states.length > 0 ? "APPLIES" : "UNDECIDED";
    }
    case "ANY": {
      const states = predicate.conditions.map((condition) => applicabilityOf(condition, facts));
      if (states.includes("APPLIES")) return "APPLIES";
      if (states.includes("UNDECIDED")) return "UNDECIDED";
      return states.length > 0 ? "DOES_NOT_APPLY" : "UNDECIDED";
    }
    case "NOT": {
      const inner = applicabilityOf(predicate.condition, facts);
      if (inner === "UNDECIDED") return "UNDECIDED";
      return inner === "APPLIES" ? "DOES_NOT_APPLY" : "APPLIES";
    }
    default:
      return "UNDECIDED";
  }
}

function publishedCalculation(
  pack: CompiledDomainPack,
  row: LedgerRow,
  facts: readonly StudyFact[],
  known: ReadonlySet<string>,
  relationships: ReadonlyArray<{ fromInstanceId: string; toInstanceId: string; factIds: readonly string[] }>,
): { label: string; factIds: string[] } | null {
  const value = row.daysBetween ?? row.computedValue;
  if (row.disposition !== "COMPUTED" || value === undefined) return null;
  const definition = pack.definitions.find((item) => item.id === row.definitionId);
  if (!definition || definition.kind !== "calculation" || !definition.bindings) return null;
  const factIds = new Set(excerptIds(row.sourceRefs, known));
  const parts: string[] = [];
  for (const binding of definition.bindings) {
    if (!("entityId" in binding)) {
      if ("literal" in binding) parts.push(`${binding.role} ${binding.literal.value} ${binding.literal.unit}`);
      if ("referenceTableId" in binding) {
        const table = pack.definitions.find((item) => item.id === binding.referenceTableId);
        parts.push(`${binding.role} ${table && table.kind === "referenceTable" ? table.label : binding.referenceTableId}`);
      }
      continue;
    }
    const instanceId = row.instances.find((item) => item.entityId === binding.entityId)?.instanceId;
    const fact = facts.find((item) => item.entityId === binding.entityId && item.instanceId === instanceId && item.fieldId === binding.fieldId);
    if (!fact || !known.has(fact.extractionFactId)) return null;
    factIds.add(fact.extractionFactId);
    parts.push(`${binding.role} ${withUnit(fact.value, fieldUnit(pack, binding.entityId, binding.fieldId))}`);
  }
  const instances = new Set(row.instances.map((item) => item.instanceId));
  for (const link of relationships) {
    if (!instances.has(link.fromInstanceId) || !instances.has(link.toInstanceId)) continue;
    for (const factId of link.factIds) if (known.has(factId)) factIds.add(factId);
  }
  if (factIds.size === 0) return null;
  const resultUnit = row.daysBetween !== undefined ? " calendar days" : row.computedUnit ? ` ${row.computedUnit}` : "";
  const instanceNote = definition.operator === "SUM_BY" ? "" : row.instances.map((item) => item.instanceId).join(", ");
  return {
    label: `${definition.label}${instanceNote ? ` (${instanceNote})` : ""}: ${value}${resultUnit}. Inputs: ${parts.join("; ")}.`,
    factIds: [...factIds].sort(),
  };
}

type ProgressComparison = {
  label: string;
  factIds: string[];
  meetsPlan: boolean;
};

function progressComparisons(facts: readonly StudyFact[], record: CoordinatedInvestigationRecord, pack: CompiledDomainPack): ProgressComparison[] {
  const grouped = new Map<string, StudyFact[]>();
  for (const fact of facts) {
    const key = `${fact.entityId}\0${fact.instanceId}`;
    const list = grouped.get(key) ?? [];
    list.push(fact);
    grouped.set(key, list);
  }
  const comparisons: ProgressComparison[] = [];
  for (const group of grouped.values()) {
    const rows = group.map((fact) => ({
      ...fact,
      role: record.measurements.find((item) => item.extractionFactId === fact.extractionFactId)?.role
        ?? measurementRoleForField(definitionLabel(pack, fact.entityId), fact.fieldId),
    }));
    const baseline = rows.find((item) => item.role === "BASELINE" && NUMBER_VALUE.test(item.value));
    const planned = rows.find((item) => item.role === "TARGET" && NUMBER_VALUE.test(item.value));
    const observed = rows.find((item) => item.role === "ACTUAL" && NUMBER_VALUE.test(item.value));
    const baselineWhen = rows.find((item) => item.role === "BASELINE" && ISO_DATE.test(item.value))?.value ?? null;
    const observedWhen = rows.find((item) => item.role === "ACTUAL" && ISO_DATE.test(item.value))?.value ?? null;
    if (!baseline || !observed || !baselineWhen || !observedWhen || observedWhen <= baselineWhen) continue;
    const observedChange = plainDifference(observed.value, baseline.value);
    if (!observedChange) continue;
    const unit = fieldUnit(pack, baseline.entityId, baseline.fieldId);
    const factIds = [baseline.extractionFactId, observed.extractionFactId];
    const plannedChange = planned ? plainDifference(planned.value, baseline.value) : null;
    const plannedDecimal = planned ? decimalFromPlain(planned.value) : null;
    const observedDecimal = decimalFromPlain(observed.value);
    const meetsPlan = !!(plannedDecimal && observedDecimal && compareDecimal(observedDecimal, plannedDecimal) >= 0);
    const plannedText = planned && plannedChange
      ? `planned target ${withUnit(planned.value, unit)}; planned change from baseline ${withUnit(plannedChange, unit)}`
      : "planned target is not in the saved record";
    if (planned) factIds.push(planned.extractionFactId);
    const relation = !plannedDecimal || !observedDecimal
      ? "The planned target cannot be compared."
      : meetsPlan
        ? "The observed value is at or above the planned target."
        : "The observed value is below the planned target.";
    comparisons.push({
      meetsPlan,
      factIds,
      label: `Progress comparison for ${definitionLabel(pack, baseline.entityId)}: baseline ${withUnit(baseline.value, unit)}; ${plannedText}; observed ${withUnit(observed.value, unit)}. Observed change from baseline ${withUnit(observedChange, unit)}. ${relation}`,
    });
  }
  return comparisons;
}

function projectStudy(input: {
  prepared: PreparedStudy;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedDocument[];
  verifiedFacts: readonly StudyFact[];
  verifiedRelationships: ReadonlyArray<{ relationshipId: string; fromInstanceId: string; toInstanceId: string; factIds: string[] }>;
  unresolvedRelationships: ReadonlyArray<{ relationshipId: string; extractionFactId: string; page: number | null; reasons: readonly string[]; withheld: boolean }>;
  fieldConflicts: readonly VerifiedFieldConflict[];
  unsupported: readonly UnsupportedConversion[];
  ledger: DomainInvestigationLedger;
  proposalFacts: ReadonlySet<string>;
  record: CoordinatedInvestigationRecord;
  studyDate: string;
}): CanonicalStudy {
  const known = new Set(input.extractions.flatMap((extraction) => extraction.facts.map((fact) => fact.id)));
  const packDigestValue = input.prepared.pack.identity.digest;
  const planDigestValue = input.prepared.plan.digest;
  const pack = input.prepared.pack;
  const quotedRole = (documentId: string, page: number, quote: string) => {
    const document = input.pages.find((item) => item.documentId === documentId);
    const text = document?.pages.find((item) => item.pageNumber === page)?.text ?? "";
    const needle = normalizeQuoteText(quote);
    return needle.length > 0 && normalizeQuoteText(text).includes(needle);
  };
  const acceptedRoles = input.record.documentRoles.filter((role) => quotedRole(role.documentId, role.page, role.quote));
  const anchors = acceptedRoles.filter((role) => role.role === "ANCHOR");
  const dated = [...input.extractions].map((extraction) => ({
    extraction,
    date: extraction.document.keyDates.find((item) => item.date && ISO_DATE.test(item.date))?.date ?? null,
  })).sort((left, right) => left.extraction.documentId.localeCompare(right.extraction.documentId));
  const chainOrder = [...anchors].sort((left, right) => {
    const leftDate = dated.find((item) => item.extraction.documentId === left.documentId)?.date ?? "";
    const rightDate = dated.find((item) => item.extraction.documentId === right.documentId)?.date ?? "";
    return leftDate.localeCompare(rightDate) || left.documentId.localeCompare(right.documentId);
  });
  const documents = dated.map((item) => {
    const proposed = acceptedRoles.find((role) => role.documentId === item.extraction.documentId);
    const chainIndex = proposed?.role === "ANCHOR"
      ? chainOrder.findIndex((role) => role.documentId === item.extraction.documentId)
      : -1;
    const orientation = documentedOrientation(item.extraction.documentId, input.verifiedFacts, item.date);
    return {
      sourceDocumentId: item.extraction.documentId,
      role: proposed?.role ?? "REFERENCE",
      classification: proposed ? "QUOTED" as const : "UNRESOLVED" as const,
      typeInPlainWords: item.extraction.document.documentType || item.extraction.fileName,
      date: orientation.date,
      version: orientation.version,
      chainPosition: chainOrder.length > 1 && chainIndex >= 0 ? chainIndex + 1 : null,
    };
  });
  const spine = input.verifiedFacts
    .filter((fact) => known.has(fact.extractionFactId))
    .sort((left, right) => left.extractionFactId.localeCompare(right.extractionFactId))
    .map((fact) => ({
      id: fact.extractionFactId,
      label: findingLabel(pack, fact.entityId, fact.fieldId, fact.value, fact.page),
      kind: fact.fieldId,
      status: "SUPPORTED" as const,
      supportingFactIds: [fact.extractionFactId],
      contradictingFactIds: [] as string[],
      updatingFactIds: [] as string[],
      missing: [] as string[],
    }));
  for (const link of input.verifiedRelationships) {
    const factIds = link.factIds.filter((id) => known.has(id));
    if (factIds.length === 0) continue;
    spine.push({
      id: `rel:${link.relationshipId}:${factIds[0]}`,
      label: `${definitionLabel(pack, link.relationshipId)} is supported by the cited record.`,
      kind: "relationship",
      status: "SUPPORTED",
      supportingFactIds: factIds,
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
    });
  }
  const publishedCalculations = new Set<string>();
  const publishedLabels = new Set<string>();
  for (const row of input.ledger.rows) {
    const published = publishedCalculation(pack, row, input.verifiedFacts, known, input.verifiedRelationships);
    if (!published || publishedLabels.has(published.label)) continue;
    publishedLabels.add(published.label);
    publishedCalculations.add(row.definitionId);
    spine.push({
      id: row.rowId,
      label: published.label,
      kind: "calculation",
      status: "SUPPORTED",
      supportingFactIds: published.factIds,
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
    });
  }
  const comparisons = progressComparisons(input.verifiedFacts, input.record, pack);
  for (const comparison of comparisons) {
    const factIds = comparison.factIds.filter((id) => known.has(id));
    if (factIds.length === 0) continue;
    spine.push({
      id: `progress:${factIds[0]}`,
      label: comparison.label,
      kind: "progress",
      status: "SUPPORTED",
      supportingFactIds: factIds,
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
    });
  }
  const progressMeetsClaim = comparisons.some((item) => item.meetsPlan);
  const outside: { statement: string; factIds: string[] }[] = [
    ...input.unsupported.map((item) => ({
      statement: `Written value was not converted: ${item.valueAsWritten}.${item.page ? ` Page ${item.page}.` : ""}`,
      factIds: known.has(item.extractionFactId) ? [item.extractionFactId] : [],
    })),
    ...input.unresolvedRelationships.map((item) => ({
      statement: `Relationship ${item.relationshipId} is not verified (${item.reasons.join(", ")}).${item.page ? ` Page ${item.page}.` : ""}${item.withheld ? " The compiled source structure does not match the quoted text." : ""}`,
      factIds: known.has(item.extractionFactId) ? [item.extractionFactId] : [],
    })),
  ];
  for (const definition of pack.definitions) {
    if (definition.kind !== "calculation" || publishedCalculations.has(definition.id)) continue;
    const reasons = [...new Set(input.ledger.rows.filter((row) => row.definitionId === definition.id).flatMap((row) => row.reasonCodes))].sort();
    outside.push({
      statement: `Calculation ${definition.label} was not published (${reasons.join(", ") || "NOT_EVALUATED"}).`,
      factIds: [],
    });
  }
  for (const extraction of input.extractions) {
    for (const fact of extraction.facts) {
      const key = factKey(extraction.documentId, fact.id);
      if (input.proposalFacts.has(key) || fact.evidence.length === 0) continue;
      outside.push({
        statement: `Verified fact was not joined to a catalog field: ${fact.valueAsWritten}.`,
        factIds: [fact.id],
      });
    }
  }
  for (const assessment of input.record.assessments) {
    const factIds = assessment.factIds.filter((id) => known.has(id));
    if (PROGRESS_CLAIM.test(assessment.statement) && !progressMeetsClaim) {
      const lead = comparisons.length === 0
        ? "No subsequent measurement supports a progress conclusion."
        : "The later measurement does not support that progress conclusion.";
      outside.push({
        statement: `${lead} ${assessment.statement}`,
        factIds,
      });
      continue;
    }
    outside.push({
      statement: `Assessment is not a supported finding. ${assessment.statement}`,
      factIds,
    });
  }
  for (const determination of input.record.determinations) {
    outside.push({ statement: `Open for a professional: ${determination.statement}`, factIds: [] });
  }
  const conflicts = input.record.conflicts.flatMap((conflict) => {
    const factIds = conflict.factIds.filter((id) => known.has(id));
    const rows = factIds.flatMap((id) => input.verifiedFacts.filter((fact) => fact.extractionFactId === id));
    const sameField = rows.length >= 2
      && rows.every((row) => row.entityId === rows[0]?.entityId && row.fieldId === rows[0]?.fieldId && row.documentId.length >= 0)
      && new Set(rows.map((row) => `${row.entityId}\0${row.fieldId}\0${row.value}`)).size > 1
      && new Set(rows.map((row) => `${row.entityId}\0${row.fieldId}`)).size === 1;
    if (!sameField) {
      outside.push({
        statement: `The proposed disagreement is not two values of the same field. ${conflict.statement}`,
        factIds,
      });
      return [];
    }
    return [{ statement: conflict.statement, factIds }];
  });
  for (const conflict of input.fieldConflicts) {
    const rows = input.verifiedFacts.filter((fact) => fact.entityId === conflict.entityId && fact.instanceId === conflict.instanceId && fact.fieldId === conflict.fieldId);
    const factIds = [...new Set(rows.map((row) => row.extractionFactId))].filter((id) => known.has(id));
    if (factIds.length < 2) continue;
    const key = [...factIds].sort().join("\0");
    if (conflicts.some((item) => [...item.factIds].sort().join("\0") === key)) continue;
    conflicts.push({
      statement: `${definitionLabel(pack, conflict.entityId)} ${readableField(conflict.fieldId)} has more than one saved value.`,
      factIds,
    });
  }
  const gaps: CanonicalGap[] = [];
  const pushGap = (gap: Omit<CanonicalGap, "id" | "relatedSpineIds">) => {
    gaps.push({ ...gap, id: `G${gaps.length + 1}`, relatedSpineIds: [] });
  };
  const blankKeys = new Set<string>();
  const recordBlank = (documentId: string, label: string) => {
    const key = `${documentId}\0${normalizeQuoteText(label).toLowerCase()}`;
    if (blankKeys.has(key)) return;
    blankKeys.add(key);
    pushGap({
      statement: `The page shows ${label} blank.`,
      kind: "OBSERVATION",
      title: label.slice(0, 80),
      why: "A saved page shows this field blank.",
      holder: "",
      holderType: null,
      when: null,
      basisType: null,
      relatedFactIds: [],
    });
  };
  for (const extraction of input.extractions) {
    for (const blank of extraction.emptyFields) {
      const label = blank.label.trim();
      if (label.length < 3) continue;
      if (!quoteBacked(input.pages, extraction.documentId, blank.page, blank.quote)) continue;
      recordBlank(extraction.documentId, label);
    }
  }
  const requestKeys = new Set<string>();
  const recordRequest = (title: string, statement: string) => {
    const key = normalizeQuoteText(title).toLowerCase();
    if (requestKeys.has(key)) return;
    requestKeys.add(key);
    pushGap({
      statement,
      kind: "REQUESTABLE_DOCUMENT",
      title: title.slice(0, 80),
      why: "A verified quote names this record, and the authorized inventory does not contain it.",
      holder: "",
      holderType: null,
      when: null,
      basisType: "MENTIONED",
      relatedFactIds: [],
    });
  };
  for (const gap of input.record.gaps) {
    if (gap.kind === "MISSING_DOCUMENT") {
      const definition = pack.definitions.find((item) => item.kind === "document" && item.id === gap.documentKindId);
      const names = definition && definition.kind === "document"
        ? [definition.label, ...definition.aliases].map((name) => name.trim()).filter((name) => name.length >= 8)
        : [];
      if (names.length === 0 || input.extractions.some((extraction) => documentMatches(extraction, names))) continue;
      if (!namedByVerifiedQuote(input.extractions, input.pages, names)) continue;
      const title = definition && definition.kind === "document" ? definition.label : names[0] ?? gap.statement;
      recordRequest(title, gap.statement);
      continue;
    }
    const entity = pack.definitions.find((item) => item.kind === "entity" && item.id === gap.entityId);
    const fieldId = gap.fieldId ?? "";
    const matched = entity && entity.kind === "entity" && fieldId !== ""
      ? input.extractions.flatMap((extraction) => extraction.emptyFields.flatMap((blank) => {
        if (!quoteBacked(input.pages, extraction.documentId, blank.page, blank.quote)) return [];
        return blankLabelMatches(blank.label, entity.label, fieldId) ? [extraction.documentId] : [];
      }))
      : [];
    if (matched.length > 0 && entity && entity.kind === "entity") {
      recordBlank(matched[0] ?? "", `${entity.label} ${readableField(fieldId)}`);
      continue;
    }
    outside.push({
      statement: `Searched and not found: ${gap.statement}`,
      factIds: [],
    });
  }
  for (const extraction of input.extractions) {
    for (const referenced of extraction.referencedDocuments) {
      const name = referenced.description.trim();
      if (!quoteBacked(input.pages, extraction.documentId, referenced.page, referenced.quote)) continue;
      if (!quoteNames(referenced.quote, name)) continue;
      if (input.extractions.some((item) => documentMatches(item, [name]))) continue;
      recordRequest(name, `A verified quote names ${name}, and that record is not in the authorized inventory.`);
    }
  }
  const questions = pack.definitions.flatMap((definition) => definition.kind === "question" ? [definition] : []);
  const personas = pack.definitions.flatMap((definition) => definition.kind === "persona" ? [definition] : []);
  const personaCoverage: PersonaCoverageItem[] = [];
  const coverQuestion = (audience: PersonaCoverageItem["audience"], questionId: string) => {
    if (personaCoverage.some((item) => item.audience === audience && item.questionId === questionId)) return;
    const question = questions.find((item) => item.id === questionId);
    if (question && applicabilityOf(question.appliesWhen, input.verifiedFacts) === "DOES_NOT_APPLY") {
      personaCoverage.push({
        audience,
        questionId,
        status: "NOT_ASSESSED",
        factIds: [],
        checkIds: [],
        missing: "This question does not apply to the saved record.",
      });
      return;
    }
    const answer = input.record.answers.find((item) => item.questionId === questionId && (item.audience === audience || item.audience === "all"));
    let status: PersonaCoverageItem["status"] = "NOT_ASSESSED";
    let factIds: string[] = [];
    let missing = "";
    if (answer) {
      factIds = answer.factIds.filter((id) => known.has(id));
      missing = (answer.uncertainty ?? "").slice(0, 120);
      status = factIds.length === 0 ? "NOT_ANSWERABLE" : answer.uncertainty ? "PARTLY" : "ANSWERABLE";
    }
    personaCoverage.push({ audience, questionId, status, factIds, checkIds: [], missing });
  };
  for (const persona of personas) {
    for (const questionId of persona.questionIds) coverQuestion(persona.audience, questionId);
  }
  for (const question of questions) {
    if (question.audience === "all") {
      coverQuestion("customer", question.id);
      coverQuestion("professional", question.id);
    } else coverQuestion(question.audience, question.id);
  }
  const asked = intentQuestions(input.record.intentText);
  asked.forEach((question, index) => {
    const overlap = questions.some((item) => {
      const left = tokensOf(item.text);
      const shared = [...tokensOf(question)].filter((token) => left.has(token));
      return shared.length >= 4;
    });
    if (overlap) return;
    const answer = input.record.answers.find((item) => item.questionId === `intent:${index + 1}`);
    const factIds = answer?.factIds.filter((id) => known.has(id)) ?? [];
    const uncertainty = answer?.uncertainty?.trim() ?? "";
    const base = factIds.length > 0
      ? `Request not in the catalog: ${question}`
      : `Request not in the catalog, and not answered from the saved evidence: ${question}`;
    outside.push({
      statement: uncertainty === "" ? base : `${base} ${uncertainty}`,
      factIds,
    });
  });
  for (const item of dated) {
    if (acceptedRoles.some((role) => role.documentId === item.extraction.documentId)) continue;
    outside.push({
      statement: `Document ${item.extraction.fileName} has no evidence-backed role. Classification is unresolved.`,
      factIds: [],
    });
  }
  outside.sort((left, right) => left.statement.localeCompare(right.statement));
  const anchorCount = documents.filter((document) => document.classification === "QUOTED" && document.role === "ANCHOR").length;
  const dates = input.verifiedFacts
    .filter((fact) => ISO_DATE.test(fact.value))
    .sort((left, right) => left.extractionFactId.localeCompare(right.extractionFactId))
    .map((fact) => ({
      date: fact.value,
      asWritten: fact.value,
      statement: findingLabel(pack, fact.entityId, fact.fieldId, fact.value, fact.page),
      factIds: [fact.extractionFactId],
    }));
  const spineSource: SpineSource | null = anchorCount > 1
    ? "ANCHOR_CHAIN"
    : anchorCount === 1
      ? "ANCHOR"
      : dates.length > 0
        ? "TIMELINE"
        : spine.length > 0
          ? "PARTIES_AND_OBLIGATIONS"
          : null;
  const checklist = checklistFrom(input.ledger, known, packDigestValue, planDigestValue);
  const chains = projectChains(pack, input.verifiedRelationships);
  return {
    schema: "hive.canonical-study/1",
    documents,
    spineSource,
    spine,
    outsideSpine: outside.map((item, index) => ({ id: `O${index + 1}`, statement: item.statement, factIds: item.factIds })),
    conflicts: conflicts.map((item, index) => ({ id: `C${index + 1}`, statement: item.statement, factIds: item.factIds })),
    timeline: dates,
    gaps,
    domainLabel: pack.identity.title,
    ...(checklist.length > 0 ? { checklist } : {}),
    ...(chains.length > 0 ? { chains } : {}),
    ...(personaCoverage.length > 0 ? { personaCoverage } : {}),
    questionOrder: [`pack-digest:${packDigestValue}`, `plan-digest:${planDigestValue}`],
    studyDate: ISO_DATE.test(input.studyDate) ? input.studyDate : undefined,
  };
}

/** Rejects a study whose fact ids or document list do not survive canonical verification. */
export function assessCanonicalProjection(
  study: CanonicalStudy,
  extractions: readonly DocExtraction[],
): { ok: true; study: CanonicalStudy } | { ok: false; code: "VERIFICATION_FAILED" | "INCOMPLETE_DOCUMENTS" } {
  const parsed = parseCanonicalStudy(study);
  if (!parsed.ok) return { ok: false, code: "VERIFICATION_FAILED" };
  const known = new Set(extractions.flatMap((extraction) => extraction.facts.map((fact) => fact.id)));
  const verified = verifyCanonicalStudy(parsed.value, known);
  if (verified.drops.unknownFactIds > 0 || verified.drops.spineMarkedUnsupported > 0) {
    return { ok: false, code: "VERIFICATION_FAILED" };
  }
  const projected = new Set(verified.study.documents.map((document) => document.sourceDocumentId.toLowerCase()));
  const expected = new Set(extractions.map((extraction) => extraction.documentId.toLowerCase()));
  if (projected.size !== expected.size || [...expected].some((id) => !projected.has(id))) {
    return { ok: false, code: "INCOMPLETE_DOCUMENTS" };
  }
  const digestNotes = verified.study.questionOrder ?? [];
  if (!digestNotes.some((item) => item.startsWith("pack-digest:")) || !digestNotes.some((item) => item.startsWith("plan-digest:"))) {
    return { ok: false, code: "VERIFICATION_FAILED" };
  }
  return { ok: true, study: verified.study };
}

function quoteBackedRole(
  role: { documentId: string; page: number; quote: string },
  pages: readonly AuthorizedDocument[],
): boolean {
  const document = pages.find((item) => item.documentId === role.documentId);
  const text = document?.pages.find((item) => item.pageNumber === role.page)?.text ?? "";
  const needle = normalizeQuoteText(role.quote);
  return needle.length > 0 && normalizeQuoteText(text).includes(needle);
}

/** Separates a stopped investigation from a complete one. A failed gate does not drop accepted quotes. */
export function assessInvestigationCompleteness(input: {
  pack: CompiledDomainPack;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedDocument[];
  record: CoordinatedInvestigationRecord;
  study: CanonicalStudy;
}): InvestigationCompleteness {
  const unfinished: string[] = [];
  const quoted = new Set(
    input.record.documentRoles
      .filter((role) => quoteBackedRole(role, input.pages))
      .map((role) => role.documentId),
  );
  for (const extraction of [...input.extractions].sort((left, right) => left.documentId.localeCompare(right.documentId))) {
    if (!quoted.has(extraction.documentId)) unfinished.push(`document-role:${extraction.documentId}`);
  }
  const intentCount = input.record.intentText.split("?").map((part) => part.trim()).filter((part) => part.length >= 8).length;
  for (let index = 1; index <= intentCount; index += 1) {
    const answer = input.record.answers.find((item) => item.questionId === `intent:${index}`);
    if (!answer || (answer.factIds.length === 0 && !answer.uncertainty)) unfinished.push(`intent:${index}`);
  }
  if (input.record.shownQuestionIds) {
    for (const questionId of [...input.record.shownQuestionIds].sort()) {
      const answer = input.record.answers.find((item) => item.questionId === questionId);
      if (!answer || (answer.factIds.length === 0 && !answer.uncertainty)) unfinished.push(`question:${questionId}`);
    }
  }
  const examined = new Set((input.record.examinedPages ?? []).map((item) => `${item.documentId}\0${item.page}`));
  for (const role of input.record.documentRoles) {
    if (role.role !== "ANCHOR" || !quoted.has(role.documentId)) continue;
    const document = input.pages.find((item) => item.documentId === role.documentId);
    if (!document) continue;
    for (const page of document.pages) {
      if (page.text.trim() === "") continue;
      if (!examined.has(`${role.documentId}\0${page.pageNumber}`)) unfinished.push(`anchor-page:${role.documentId}:${page.pageNumber}`);
    }
  }
  const chainIds = new Set((input.study.chains ?? []).map((chain) => chain.chainId));
  for (const definition of input.pack.definitions) {
    if (definition.kind === "chain" && !chainIds.has(definition.id)) unfinished.push(`chain:${definition.id}`);
  }
  unfinished.sort();
  return { complete: unfinished.length === 0, unfinished };
}

function studyInstant(studyDate: string): string | null {
  if (!ISO_DATE.test(studyDate)) return null;
  const instant = `${studyDate}T12:00:00.000Z`;
  return new Date(instant).toISOString() === instant ? instant : null;
}

/**
 * Admits a relationship only when a compiled source structure matches the quote
 * and the verified endpoints. The model proposal is not an acceptance.
 */
function admitTypedRelationships(input: {
  prepared: PreparedStudy;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedDocument[];
  verified: VerifiedCaseFacts;
  unresolved: UnresolvedCandidates;
  binderDigest: string;
  structures: readonly unknown[] | undefined;
  studyDate: string;
}): { ok: true; verified: VerifiedCaseFacts; unresolved: UnresolvedCandidates; withheld: ReadonlySet<string> } | { ok: false; code: "BIND_FAILED" } {
  const structures = input.structures ?? [];
  if (structures.length === 0) return { ok: true, verified: input.verified, unresolved: input.unresolved, withheld: new Set() };
  const instant = studyInstant(input.studyDate);
  if (!instant) return { ok: false, code: "BIND_FAILED" };
  const eligible = input.unresolved.candidates.filter((candidate) =>
    candidate.kind === "RELATIONSHIP"
    && candidate.trust === "REVIEW_REQUIRED"
    && candidate.reasons.length === 1
    && candidate.reasons[0] === "RELATIONSHIP_SEMANTICS_UNVERIFIED"
    && candidate.relationshipId
    && candidate.fromEntityId
    && candidate.toEntityId
    && candidate.fromInstanceId
    && candidate.toInstanceId
  ).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  let records: RelationshipVerificationRecord[] = [];
  let verified = input.verified;
  let unresolved = input.unresolved;
  const revision = {
    extractionDigest: authorizedExtractionDigest(input.extractions),
    binderDigest: input.binderDigest,
    evidenceDigest: investigationEvidenceDigest(input.verified, input.unresolved),
  };
  for (const candidate of eligible) {
    const availability = assessRelationshipTypedSource(candidate.relationshipId ?? "", structures);
    if (availability === "STRUCTURE_UNAPPROVED") return { ok: false, code: "BIND_FAILED" };
    if (availability !== "TYPED_SOURCE_PRESENT") continue;
    const decision = decideRelationshipVerification({
      pack: input.prepared.pack,
      plan: input.prepared.plan,
      verified: input.verified,
      unresolved: input.unresolved,
      binderDigest: input.binderDigest,
      documents: input.pages,
      extractions: input.extractions,
      structures,
      records,
      decidedAt: instant,
      context: {
        schema: RELATIONSHIP_VERIFICATION_CONTEXT_SCHEMA,
        hiveId: "study-engine",
        actorId: "trusted-code",
        permission: "HIVE_OWNER",
        evidenceRevision: revision,
        candidate: {
          candidateId: candidate.candidateId,
          contentDigest: relationshipCandidateContentDigest({
            relationshipId: candidate.relationshipId ?? "",
            fromEntityId: candidate.fromEntityId ?? "",
            toEntityId: candidate.toEntityId ?? "",
            fromInstanceId: candidate.fromInstanceId ?? "",
            toInstanceId: candidate.toInstanceId ?? "",
            evidence: candidate.evidence,
          }),
        },
        packDigest: input.prepared.pack.identity.digest,
        planDigest: input.prepared.plan.digest,
      },
    });
    if (!decision.ok) return { ok: false, code: "BIND_FAILED" };
    records = [...decision.records];
    verified = decision.verified;
    unresolved = decision.unresolved;
  }
  return {
    ok: true,
    verified,
    unresolved,
    withheld: new Set(records.filter((record) => record.effect === "WITHHOLDS").map((record) => record.candidateId)),
  };
}

export function runInvestigationStudyEngine(input: {
  prepared: PreparedStudy;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedDocument[];
  proposal: unknown;
  studyDate: string;
  investigation?: CoordinatedInvestigationRecord;
  /** Compiled relationship structures. A model proposal cannot supply these. */
  relationshipStructures?: readonly unknown[];
}): InvestigationEngineResult {
  const proposal = readProposal(input.proposal);
  if (!proposal) return { ok: false, code: "MAPPING_INVALID" };
  const adapted = adaptCandidates(input.prepared, input.extractions, proposal);
  if (!adapted.ok) return adapted;
  const envelope = {
    schema: INVESTIGATION_CANDIDATES_SCHEMA,
    planDigest: input.prepared.plan.digest,
    packDigest: input.prepared.pack.identity.digest,
    extractionDigest: authorizedExtractionDigest(input.extractions),
    candidates: adapted.adapted.candidates,
  };
  const bound = bindInvestigationCandidates({
    pack: input.prepared.pack,
    plan: input.prepared.plan,
    extractions: input.extractions,
    documents: input.pages,
    candidates: envelope,
  });
  if (!bound.ok) return { ok: false, code: "BIND_FAILED" };
  if (bound.unresolved.candidates.some((candidate) => candidate.reasons.some((reason) => binderReasonRejectsRun(reason)))) {
    return { ok: false, code: "INVALID_EVIDENCE" };
  }
  const admitted = admitTypedRelationships({
    prepared: input.prepared,
    extractions: input.extractions,
    pages: input.pages,
    verified: bound.verified,
    unresolved: bound.unresolved,
    binderDigest: bound.digest,
    structures: input.relationshipStructures,
    studyDate: input.studyDate,
  });
  if (!admitted.ok) return admitted;
  const evidenceDigest = investigationEvidenceDigest(admitted.verified, admitted.unresolved);
  const ledger = buildCoverageLedger({
    plan: input.prepared.plan,
    pack: input.prepared.pack,
    verified: admitted.verified,
    unresolved: admitted.unresolved,
    evidenceDigest,
  });
  if (!ledger.ok) return { ok: false, code: "LEDGER_FAILED" };
  if (ledger.value.rows.some((row) => row.taskKind === "REVIEW_CHECK" && (row.disposition === "ESTABLISHED" || row.disposition === "COMPUTED" || row.disposition === "NOT_SATISFIED"))) {
    return { ok: false, code: "LEDGER_FAILED" };
  }
  const known = new Set(input.extractions.flatMap((extraction) => extraction.facts.map((fact) => fact.id)));
  const verifiedFacts = admitted.verified.facts.flatMap((fact) => {
    const extractionFactId = evidenceFactId(fact.sourceRefs.find((ref) => ref.excerptId)?.excerptId, known);
    if (!extractionFactId) return [];
    const page = fact.sourceRefs.find((ref) => ref.page)?.page;
    return [{
      entityId: fact.entityId,
      instanceId: fact.instanceId,
      fieldId: fact.fieldId,
      value: fact.value.value,
      documentId: fact.sourceRefs[0]?.documentId ?? "",
      extractionFactId,
      page,
    }];
  });
  if (verifiedFacts.length !== admitted.verified.facts.length) return { ok: false, code: "VERIFICATION_FAILED" };
  const unresolvedRelationships = admitted.unresolved.candidates
    .filter((candidate) => candidate.kind === "RELATIONSHIP" && candidate.trust === "REVIEW_REQUIRED" && candidate.relationshipId)
    .flatMap((candidate) => {
      const match = proposal.relationships.find((link) => link.relationshipId === candidate.relationshipId && link.fromInstanceId === candidate.fromInstanceId && link.toInstanceId === candidate.toInstanceId);
      if (!match || !known.has(match.extractionFactId)) return [];
      const page = candidate.evidence[0]?.page ?? null;
      return [{
        relationshipId: candidate.relationshipId!,
        extractionFactId: match.extractionFactId,
        page,
        reasons: candidate.reasons,
        withheld: admitted.withheld.has(candidate.candidateId),
      }];
    });
  const verifiedRelationships = admitted.verified.relationships.flatMap((link) => {
    const factIds = new Set(excerptIds(link.sourceRefs, known));
    const match = proposal.relationships.find((row) => row.relationshipId === link.relationshipId && row.fromInstanceId === link.fromInstanceId && row.toInstanceId === link.toInstanceId);
    if (match && known.has(match.extractionFactId)) factIds.add(match.extractionFactId);
    return factIds.size > 0 ? [{ relationshipId: link.relationshipId, fromInstanceId: link.fromInstanceId, toInstanceId: link.toInstanceId, factIds: [...factIds].sort() }] : [];
  });
  const proposalFacts = new Set<string>([
    ...proposal.mappings.map((row) => factKey(row.documentId, row.extractionFactId)),
    ...proposal.relationships.map((row) => factKey(row.documentId, row.extractionFactId)),
  ]);
  const drafted = projectStudy({
    prepared: input.prepared,
    extractions: input.extractions,
    pages: input.pages,
    verifiedFacts,
    verifiedRelationships,
    unresolvedRelationships,
    fieldConflicts: admitted.verified.conflicts,
    unsupported: adapted.adapted.unsupported,
    ledger: ledger.value,
    proposalFacts,
    record: input.investigation ?? EMPTY_RECORD,
    studyDate: input.studyDate,
  });
  const assessed = assessCanonicalProjection(drafted, input.extractions);
  if (!assessed.ok) return assessed;
  const completeness = assessInvestigationCompleteness({
    pack: input.prepared.pack,
    extractions: input.extractions,
    pages: input.pages,
    record: input.investigation ?? EMPTY_RECORD,
    study: assessed.study,
  });
  return {
    ok: true,
    study: assessed.study,
    completeness,
    packDigest: input.prepared.pack.identity.digest,
    planDigest: input.prepared.plan.digest,
    evidenceDigest,
    ledgerDigest: ledger.value.digest,
  };
}

/**
 * Final Canonical Study acceptance boundary. Projection may describe an incomplete
 * investigation. Acceptance requires completeness.complete and does not replace an earlier revision.
 */
export function acceptCanonicalInvestigation(
  result: InvestigationEngineResult,
): { ok: true; study: CanonicalStudy } | { ok: false; code: InvestigationEngineFailureCode | "INVESTIGATION_INCOMPLETE" } {
  if (!result.ok) return result;
  if (result.completeness.complete !== true) return { ok: false, code: "INVESTIGATION_INCOMPLETE" };
  return { ok: true, study: result.study };
}
