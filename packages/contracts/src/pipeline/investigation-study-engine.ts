/**
 * Rebuild Study bridge from verified hive.doc-extraction/1 facts to hive.canonical-study/1.
 *
 * The model may propose which fact belongs on which pack field. Hive copies provenance
 * from the extraction, refuses conversions the written value does not already state,
 * and accepts a study only after the binder, the ledger, and canonical verification agree.
 * This module does not call a model, invent a relationship, or compute a day count.
 */
import type { CanonicalGap, CanonicalStudy, SpineSource } from "./canonical-study-contracts";
import { parseCanonicalStudy, verifyCanonicalStudy } from "./canonical-study-contracts";
import type { CoordinatedInvestigationRecord } from "./domain-investigation-agent";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  binderReasonRejectsRun,
  bindInvestigationCandidates,
  INVESTIGATION_CANDIDATES_SCHEMA,
  type AuthorizedDocument,
  type CandidateEvidence,
} from "./domain-investigation-binder";
import { buildCoverageLedger, investigationEvidenceDigest, type DomainInvestigationLedger, type LedgerRow } from "./domain-investigation-ledger";
import {
  compileInvestigationPlan,
  type DomainInvestigationPlan,
  type SupplementalArtifacts,
} from "./domain-investigation-plan";
import { calendarDayIndex } from "./domain-pack-rules";
import {
  type CompiledDomainPack,
  type DomainPackSource,
  type FieldValueType,
} from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import type { CheckVerdict, PersonaCoverageItem } from "./pack-canonicalize";
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
};

export type InvestigationEngineSuccess = {
  readonly ok: true;
  readonly study: CanonicalStudy;
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
  if (candidates.length === 0) return { ok: false, code: "EMPTY_CANDIDATES" };
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

function measurementRoleForField(entityLabel: string, fieldId: string): "BASELINE" | "TARGET" | "ACTUAL" | null {
  const field = fieldId.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  if (/\bbaseline\b/.test(field)) return "BASELINE";
  if (/\btarget\b/.test(field)) return "TARGET";
  if (/\b(actual|observed|measured)\b/.test(field)) return "ACTUAL";
  if (/\bprogress\b/.test(entityLabel.toLowerCase()) && /\bvalue\b/.test(field)) return "ACTUAL";
  return null;
}

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

function verdictFor(row: LedgerRow): CheckVerdict {
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
  if (row.disposition === "ESTABLISHED" || row.disposition === "COMPUTED") return "SHOWN";
  if (row.disposition === "NOT_SATISFIED" || row.disposition === "NOT_ESTABLISHED") return "NOT_SHOWN";
  return "NOT_ASSESSED";
}

function checklistFrom(ledger: DomainInvestigationLedger, known: ReadonlySet<string>, packDigestValue: string, planDigestValue: string) {
  const grouped = new Map<string, { verdict: CheckVerdict; factIds: string[] }>();
  const rank: Record<CheckVerdict, number> = { CONFLICT: 5, SHOWN: 4, PARTLY_SHOWN: 3, NOT_SHOWN: 2, NOT_APPLICABLE: 1, NOT_ASSESSED: 0 };
  for (const row of ledger.rows) {
    if (row.taskKind !== "REVIEW_CHECK" && row.taskKind !== "EVALUATE_CHECK") continue;
    const verdict = verdictFor(row);
    const factIds = excerptIds(row.sourceRefs, known);
    const current = grouped.get(row.definitionId);
    if (!current || rank[verdict] > rank[current.verdict]) grouped.set(row.definitionId, { verdict, factIds });
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
      const note = verdict === "NOT_ASSESSED"
        ? `Review required. pack ${packDigestValue} plan ${planDigestValue}`
        : verdict === "SHOWN"
          ? "Established from cited evidence."
          : verdict === "NOT_SHOWN"
            ? "The saved documents do not show this."
            : verdict === "CONFLICT"
              ? "Cited values conflict."
              : "This check does not apply to the saved record.";
      return { checkId, verdict, factIds, note };
    });
}

function caseText(extractions: readonly DocExtraction[]): string {
  return extractions.flatMap((extraction) => [
    ...extraction.referencedDocuments.map((item) => `${item.description}\n${item.quote}`),
    ...extraction.facts.flatMap((fact) => fact.evidence.map((item) => item.quote)),
  ]).join("\n").toLowerCase();
}

function documentMatches(extraction: DocExtraction, phrases: readonly string[]): boolean {
  const haystack = `${extraction.fileName} ${extraction.document.documentType} ${extraction.document.titleAsPrinted}`.toLowerCase();
  return phrases.some((phrase) => phrase.trim().length >= 3 && haystack.includes(phrase.trim().toLowerCase()));
}

function intentQuestions(text: string): string[] {
  return text.split("?").map((part) => part.trim()).filter((part) => part.length >= 8).map((part) => `${part}?`);
}

function tokensOf(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 4));
}

function projectStudy(input: {
  prepared: PreparedStudy;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedDocument[];
  verifiedFacts: ReadonlyArray<{ entityId: string; fieldId: string; value: string; documentId: string; extractionFactId: string; page: string | undefined }>;
  verifiedRelationships: ReadonlyArray<{ relationshipId: string; factIds: string[] }>;
  unresolvedRelationships: ReadonlyArray<{ relationshipId: string; extractionFactId: string; page: number | null }>;
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
    const chainIndex = chainOrder.findIndex((role) => role.documentId === item.extraction.documentId);
    let role: "ANCHOR" | "SUPPORTING" | "REFERENCE" = "SUPPORTING";
    if (proposed) role = proposed.role;
    else if (dated.length === 1) role = "ANCHOR";
    return {
      sourceDocumentId: item.extraction.documentId,
      role,
      typeInPlainWords: item.extraction.document.documentType || item.extraction.fileName,
      date: item.date,
      version: null,
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
  for (const row of input.ledger.rows) {
    if (row.disposition !== "COMPUTED" || row.daysBetween === undefined) continue;
    const factIds = excerptIds(row.sourceRefs, known);
    if (factIds.length === 0) continue;
    spine.push({
      id: row.rowId,
      label: `${definitionLabel(pack, row.definitionId)}: ${row.daysBetween} calendar days, counted from the cited dates.`,
      kind: "calculation",
      status: "SUPPORTED",
      supportingFactIds: factIds,
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
    });
  }
  const measurements = input.verifiedFacts.map((fact) => ({
    ...fact,
    role: input.record.measurements.find((item) => item.extractionFactId === fact.extractionFactId)?.role
      ?? measurementRoleForField(definitionLabel(pack, fact.entityId), fact.fieldId),
  }));
  const baselineDate = measurements.find((item) => item.role === "BASELINE" && ISO_DATE.test(item.value))?.value ?? null;
  const targetNumber = measurements.find((item) => item.role === "TARGET" && /^[0-9]+(?:\.[0-9]+)?$/.test(item.value));
  const later = measurements.filter((item) => item.role === "ACTUAL");
  const laterAfterBaseline = later.filter((item) => {
    const datedFact = input.verifiedFacts.find((fact) => fact.extractionFactId !== item.extractionFactId && ISO_DATE.test(fact.value) && fact.documentId === item.documentId);
    const date = ISO_DATE.test(item.value) ? item.value : datedFact?.value ?? null;
    return date !== null && (baselineDate === null || date > baselineDate);
  });
  const progressReady = laterAfterBaseline.length > 0 && (!targetNumber || laterAfterBaseline.some((item) => /^[0-9]+(?:\.[0-9]+)?$/.test(item.value) && Number(item.value) >= Number(targetNumber.value)));
  const outside: { statement: string; factIds: string[] }[] = [
    ...input.unsupported.map((item) => ({
      statement: `Written value was not converted: ${item.valueAsWritten}.${item.page ? ` Page ${item.page}.` : ""}`,
      factIds: known.has(item.extractionFactId) ? [item.extractionFactId] : [],
    })),
    ...input.unresolvedRelationships.map((item) => ({
      statement: `Relationship ${item.relationshipId} is not verified.${item.page ? ` Page ${item.page}.` : ""}`,
      factIds: known.has(item.extractionFactId) ? [item.extractionFactId] : [],
    })),
  ];
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
    if (PROGRESS_CLAIM.test(assessment.statement) && !progressReady) {
      outside.push({
        statement: `No subsequent measurement supports a progress conclusion. ${assessment.statement}`,
        factIds,
      });
      continue;
    }
    if (factIds.length === 0) continue;
    spine.push({
      id: `assessment:${factIds[0]}`,
      label: assessment.statement,
      kind: "assessment",
      status: "SUPPORTED",
      supportingFactIds: factIds,
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
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
  const mentioned = caseText(input.extractions);
  const gaps: CanonicalGap[] = [];
  const pushGap = (gap: Omit<CanonicalGap, "id" | "relatedSpineIds">) => {
    gaps.push({ ...gap, id: `G${gaps.length + 1}`, relatedSpineIds: [] });
  };
  for (const gap of input.record.gaps) {
    if (gap.kind === "MISSING_DOCUMENT") {
      const definition = pack.definitions.find((item) => item.kind === "document" && item.id === gap.documentKindId);
      const phrases = definition && definition.kind === "document" ? [definition.label, ...definition.aliases] : [];
      const present = input.extractions.some((extraction) => documentMatches(extraction, phrases));
      const named = phrases.some((phrase) => phrase.length >= 3 && mentioned.includes(phrase.toLowerCase()));
      if (present || !named) {
        if (gap.entityId && gap.fieldId) {
          pushGap({
            statement: gap.statement,
            kind: "OBSERVATION",
            title: `${definitionLabel(pack, gap.entityId)} ${readableField(gap.fieldId)}`,
            why: "The record is present and this information is not in it.",
            holder: "",
            holderType: null,
            when: null,
            basisType: null,
            relatedFactIds: [],
          });
        }
        continue;
      }
      pushGap({
        statement: gap.statement,
        kind: "REQUESTABLE_DOCUMENT",
        title: definition && definition.kind === "document" ? definition.label : gap.statement.slice(0, 80),
        why: "A saved page names this record, and it is not in the document inventory.",
        holder: "",
        holderType: null,
        when: null,
        basisType: "MENTIONED",
        relatedFactIds: [],
      });
      continue;
    }
    pushGap({
      statement: gap.statement,
      kind: "OBSERVATION",
      title: gap.fieldId ? `${definitionLabel(pack, gap.entityId ?? "")} ${readableField(gap.fieldId)}` : "Missing information",
      why: "This information is not in a document that is already saved.",
      holder: "",
      holderType: null,
      when: null,
      basisType: null,
      relatedFactIds: [],
    });
  }
  const instances = new Map<string, { entityId: string; factIds: string[] }>();
  for (const fact of input.verifiedFacts) {
    const bucket = instances.get(`${fact.entityId}\0${fact.documentId}`) ?? { entityId: fact.entityId, factIds: [] };
    bucket.factIds.push(fact.extractionFactId);
    instances.set(`${fact.entityId}\0${fact.documentId}`, bucket);
  }
  for (const bucket of instances.values()) {
    const entity = pack.definitions.find((item) => item.kind === "entity" && item.id === bucket.entityId);
    if (!entity || entity.kind !== "entity") continue;
    const presentFields = new Set(input.verifiedFacts.filter((fact) => fact.entityId === bucket.entityId).map((fact) => fact.fieldId));
    for (const field of entity.fields) {
      if (!field.required || presentFields.has(field.id)) continue;
      pushGap({
        statement: `Missing information: ${entity.label} ${readableField(field.id)} is not in the saved record.`,
        kind: "OBSERVATION",
        title: `${entity.label} ${readableField(field.id)}`,
        why: "Other fields of this record are present. The missing item is information, not a missing document.",
        holder: "",
        holderType: null,
        when: null,
        basisType: null,
        relatedFactIds: bucket.factIds.filter((id) => known.has(id)),
      });
    }
  }
  for (const extraction of input.extractions) {
    for (const referenced of extraction.referencedDocuments) {
      const present = input.extractions.some((item) => documentMatches(item, [referenced.description]));
      if (present || referenced.description.trim().length < 3) continue;
      pushGap({
        statement: `A saved page names ${referenced.description}, and that record is not in the inventory.`,
        kind: "REQUESTABLE_DOCUMENT",
        title: referenced.description.slice(0, 80),
        why: "The page mentions the record. No saved document matches it.",
        holder: "",
        holderType: null,
        when: null,
        basisType: "MENTIONED",
        relatedFactIds: [],
      });
    }
  }
  const questions = pack.definitions.flatMap((definition) => definition.kind === "question" ? [definition] : []);
  const personas = pack.definitions.flatMap((definition) => definition.kind === "persona" ? [definition] : []);
  const personaCoverage: PersonaCoverageItem[] = [];
  for (const persona of personas) {
    for (const questionId of persona.questionIds) {
      const answer = input.record.answers.find((item) => item.questionId === questionId && (item.audience === persona.audience || item.audience === "all"));
      let status: PersonaCoverageItem["status"] = "NOT_ASSESSED";
      let factIds: string[] = [];
      let missing = "";
      if (answer) {
        factIds = answer.factIds.filter((id) => known.has(id));
        missing = (answer.uncertainty ?? "").slice(0, 120);
        status = factIds.length === 0 ? "NOT_ANSWERABLE" : answer.uncertainty ? "PARTLY" : "ANSWERABLE";
      }
      personaCoverage.push({ audience: persona.audience, questionId, status, factIds, checkIds: [], missing });
    }
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
    outside.push({
      statement: factIds.length > 0
        ? `Request not in the catalog: ${question}`
        : `Request not in the catalog, and not answered from the saved evidence: ${question}`,
      factIds,
    });
  });
  outside.sort((left, right) => left.statement.localeCompare(right.statement));
  const anchorCount = documents.filter((document) => document.role === "ANCHOR").length;
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

export function runInvestigationStudyEngine(input: {
  prepared: PreparedStudy;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedDocument[];
  proposal: unknown;
  studyDate: string;
  investigation?: CoordinatedInvestigationRecord;
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
  const evidenceDigest = investigationEvidenceDigest(bound.verified, bound.unresolved);
  const ledger = buildCoverageLedger({
    plan: input.prepared.plan,
    pack: input.prepared.pack,
    verified: bound.verified,
    unresolved: bound.unresolved,
    evidenceDigest,
  });
  if (!ledger.ok) return { ok: false, code: "LEDGER_FAILED" };
  if (ledger.value.rows.some((row) => row.taskKind === "REVIEW_CHECK" && (row.disposition === "ESTABLISHED" || row.disposition === "COMPUTED" || row.disposition === "NOT_SATISFIED"))) {
    return { ok: false, code: "LEDGER_FAILED" };
  }
  const known = new Set(input.extractions.flatMap((extraction) => extraction.facts.map((fact) => fact.id)));
  const verifiedFacts = bound.verified.facts.flatMap((fact) => {
    const extractionFactId = evidenceFactId(fact.sourceRefs.find((ref) => ref.excerptId)?.excerptId, known);
    if (!extractionFactId) return [];
    const page = fact.sourceRefs.find((ref) => ref.page)?.page;
    return [{
      entityId: fact.entityId,
      fieldId: fact.fieldId,
      value: fact.value.value,
      documentId: fact.sourceRefs[0]?.documentId ?? "",
      extractionFactId,
      page,
    }];
  });
  if (verifiedFacts.length !== bound.verified.facts.length) return { ok: false, code: "VERIFICATION_FAILED" };
  const unresolvedRelationships = bound.unresolved.candidates
    .filter((candidate) => candidate.kind === "RELATIONSHIP" && candidate.trust === "REVIEW_REQUIRED" && candidate.relationshipId)
    .flatMap((candidate) => {
      const match = proposal.relationships.find((link) => link.relationshipId === candidate.relationshipId && link.fromInstanceId === candidate.fromInstanceId && link.toInstanceId === candidate.toInstanceId);
      if (!match || !known.has(match.extractionFactId)) return [];
      const page = candidate.evidence[0]?.page ?? null;
      return [{ relationshipId: candidate.relationshipId!, extractionFactId: match.extractionFactId, page }];
    });
  const verifiedRelationships = bound.verified.relationships.flatMap((link) => {
    const factIds = excerptIds(link.sourceRefs, known);
    return factIds.length > 0 ? [{ relationshipId: link.relationshipId, factIds }] : [];
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
    unsupported: adapted.adapted.unsupported,
    ledger: ledger.value,
    proposalFacts,
    record: input.investigation ?? EMPTY_RECORD,
    studyDate: input.studyDate,
  });
  const assessed = assessCanonicalProjection(drafted, input.extractions);
  if (!assessed.ok) return assessed;
  return {
    ok: true,
    study: assessed.study,
    packDigest: input.prepared.pack.identity.digest,
    planDigest: input.prepared.plan.digest,
    evidenceDigest,
    ledgerDigest: ledger.value.digest,
  };
}
