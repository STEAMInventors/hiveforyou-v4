/**
 * Rebuild Study bridge from verified hive.doc-extraction/1 facts to hive.canonical-study/1.
 *
 * The model may propose which fact belongs on which pack field. Hive copies provenance
 * from the extraction, refuses conversions the written value does not already state,
 * and accepts a study only after the binder, the ledger, and canonical verification agree.
 * This module does not call a model, invent a relationship, or compute a day count.
 */
import type { CanonicalStudy } from "./canonical-study-contracts";
import { parseCanonicalStudy, verifyCanonicalStudy } from "./canonical-study-contracts";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  binderReasonRejectsRun,
  bindInvestigationCandidates,
  INVESTIGATION_CANDIDATES_SCHEMA,
  type AuthorizedDocument,
  type CandidateEvidence,
} from "./domain-investigation-binder";
import { buildCoverageLedger, investigationEvidenceDigest } from "./domain-investigation-ledger";
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

function projectStudy(input: {
  prepared: PreparedStudy;
  extractions: readonly DocExtraction[];
  verifiedFacts: ReadonlyArray<{ fieldId: string; value: string; documentId: string; extractionFactId: string; page: string | undefined }>;
  unresolvedRelationships: ReadonlyArray<{ relationshipId: string; extractionFactId: string; page: number | null }>;
  unsupported: readonly UnsupportedConversion[];
  studyDate: string;
}): CanonicalStudy {
  const known = new Set(input.extractions.flatMap((extraction) => extraction.facts.map((fact) => fact.id)));
  const packDigestValue = input.prepared.pack.identity.digest;
  const planDigestValue = input.prepared.plan.digest;
  const documents = [...input.extractions]
    .sort((left, right) => left.documentId.localeCompare(right.documentId))
    .map((extraction) => {
      const dated = extraction.document.keyDates.find((item) => item.date && ISO_DATE.test(item.date));
      return {
        sourceDocumentId: extraction.documentId,
        role: "SUPPORTING" as const,
        typeInPlainWords: extraction.document.documentType || extraction.fileName,
        date: dated?.date ?? null,
        version: null,
        chainPosition: null,
      };
    });
  const spine = input.verifiedFacts
    .filter((fact) => known.has(fact.extractionFactId))
    .sort((left, right) => left.extractionFactId.localeCompare(right.extractionFactId))
    .map((fact, index) => ({
      id: `S${index + 1}`,
      label: `${fact.fieldId}: ${fact.value}${fact.page ? ` (page ${fact.page})` : ""}`,
      kind: fact.fieldId,
      status: "SUPPORTED" as const,
      supportingFactIds: [fact.extractionFactId],
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
    }));
  const outside = [
    ...input.unsupported.map((item) => ({
      statement: `Written value was not converted: ${item.valueAsWritten}.${item.page ? ` Page ${item.page}.` : ""}`,
      factIds: known.has(item.extractionFactId) ? [item.extractionFactId] : [],
    })),
    ...input.unresolvedRelationships.map((item) => ({
      statement: `Relationship ${item.relationshipId} is not verified.${item.page ? ` Page ${item.page}.` : ""}`,
      factIds: known.has(item.extractionFactId) ? [item.extractionFactId] : [],
    })),
  ].sort((left, right) => left.statement.localeCompare(right.statement));
  const checklist = input.prepared.plan.tasks
    .filter((task) => task.taskKind === "REVIEW_CHECK")
    .sort((left, right) => left.definitionId.localeCompare(right.definitionId))
    .map((task) => ({
      checkId: task.definitionId,
      verdict: "NOT_ASSESSED" as const,
      factIds: [],
      note: `Review required. pack ${packDigestValue} plan ${planDigestValue}`,
    }));
  const dates = input.verifiedFacts
    .filter((fact) => ISO_DATE.test(fact.value))
    .sort((left, right) => left.extractionFactId.localeCompare(right.extractionFactId))
    .map((fact) => ({
      date: fact.value,
      asWritten: fact.value,
      statement: `${fact.fieldId}: ${fact.value}${fact.page ? ` (page ${fact.page})` : ""}`,
      factIds: [fact.extractionFactId],
    }));
  return {
    schema: "hive.canonical-study/1",
    documents,
    spineSource: spine.length > 0 ? "TIMELINE" : null,
    spine,
    outsideSpine: outside.map((item, index) => ({ id: `O${index + 1}`, statement: item.statement, factIds: item.factIds })),
    conflicts: [],
    timeline: dates,
    gaps: [],
    domainLabel: input.prepared.pack.identity.title,
    ...(checklist.length > 0 ? { checklist } : {}),
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
  if (bound.verified.relationships.length > 0) return { ok: false, code: "LEDGER_FAILED" };
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
  if (ledger.value.rows.some((row) => row.daysBetween !== undefined)) return { ok: false, code: "LEDGER_FAILED" };
  if (ledger.value.rows.some((row) => row.taskKind === "REVIEW_CHECK" && (row.disposition === "ESTABLISHED" || row.disposition === "COMPUTED" || row.disposition === "NOT_SATISFIED"))) {
    return { ok: false, code: "LEDGER_FAILED" };
  }
  const known = new Set(input.extractions.flatMap((extraction) => extraction.facts.map((fact) => fact.id)));
  const verifiedFacts = bound.verified.facts.flatMap((fact) => {
    const extractionFactId = evidenceFactId(fact.sourceRefs.find((ref) => ref.excerptId)?.excerptId, known);
    if (!extractionFactId) return [];
    const page = fact.sourceRefs.find((ref) => ref.page)?.page;
    return [{
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
  const drafted = projectStudy({
    prepared: input.prepared,
    extractions: input.extractions,
    verifiedFacts,
    unresolvedRelationships,
    unsupported: adapted.adapted.unsupported,
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
