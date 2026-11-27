/**
 * Constructs `hive.canonical-study/1` from one resolved pack-guided output.
 * The model proposes. This module recovers only the quotations and written values
 * already on that resolution, then reuses the investigation binder, typed-source
 * relationship check, coverage ledger, and Study projection.
 * It does not call a model, schedule windows, or pretend a page was read.
 * A failed validation returns the caller's existing Study unchanged.
 */
import { computeSha256Digest } from "../source-documents/document-read-contracts";
import type { CanonicalStudy } from "./canonical-study-contracts";
import { DOCUMENT_ROLES } from "./canonical-study-contracts";
import type { AuthorizedDocument } from "./domain-investigation-binder";
import type { SupplementalArtifacts } from "./domain-investigation-plan";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  DOMAIN_PACK_SOURCE_SCHEMA,
  type CompiledDomainPack,
  type DomainPackSource,
  type EffectiveDefinition,
  type FieldValueType,
  type PackDefinition,
} from "./domain-pack-source";
import type { DocExtraction } from "./extraction-contracts";
import {
  prepareInvestigationStudy,
  runInvestigationStudyEngine,
  FIELD_MAPPING_PROPOSAL_SCHEMA,
} from "./investigation-study-engine";
import { packGuidedResolutionDigest, type PackGuidedResolution, type ResolvedPackGuidedProposal } from "./pack-guided-output";
import type { CaseInvestigationSpecification, EffectiveDomainPack } from "./study-engine-contracts";
import { checkQuote, normalizeQuoteText } from "./verify-quotes";

export const PACK_GUIDED_STUDY_ENGINE_ID = "hive.pack-guided-study/1" as const;
export const PACK_GUIDED_STUDY_VALIDATION_SCHEMA = "hive.pack-guided-study-validation/1" as const;

export const PACK_GUIDED_STUDY_CODES = [
  "ACCEPTED",
  "applicability_unresolved",
  "mandatory_question_missing",
  "evidence_unresolved",
  "relationship_invalid",
  "document_role_missing",
  "document_role_invalid",
  "incomplete_evidence",
  "calculation_unsupported",
  "proposal_invalid",
  "engine_failed",
] as const;
export type PackGuidedStudyCode = (typeof PACK_GUIDED_STUDY_CODES)[number];

export type PackGuidedStudyValidation = {
  schema: typeof PACK_GUIDED_STUDY_VALIDATION_SCHEMA;
  digest: string;
  engineId: typeof PACK_GUIDED_STUDY_ENGINE_ID;
  outcome: "ACCEPTED" | "PRESERVED";
  code: PackGuidedStudyCode;
  effectivePackDigest: string;
  evidenceDigest: string;
  specificationDigest: string;
  resolutionDigest: string;
  compiledPackDigest: string | null;
  planDigest: string | null;
  ledgerDigest: string | null;
  engineCode: string | null;
  verifiedFactIds: string[];
  interpretationIds: string[];
  uncertaintyIds: string[];
  unresolvedRelationshipIds: string[];
};

export type PackGuidedStudyResult = {
  ok: boolean;
  outcome: "ACCEPTED" | "PRESERVED";
  code: PackGuidedStudyCode;
  study: CanonicalStudy | null;
  engineId: typeof PACK_GUIDED_STUDY_ENGINE_ID;
  effectivePackDigest: string;
  evidenceDigest: string;
  validation: PackGuidedStudyValidation;
};

export type ConstructPackGuidedStudyInput = {
  resolution: PackGuidedResolution;
  pack: EffectiveDomainPack;
  specification: CaseInvestigationSpecification;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedDocument[];
  questionObligationIds: readonly string[];
  evidenceDigest: string;
  existingStudy: CanonicalStudy | null;
  studyDate: string;
  /** Compiled relationship structures. A proposal cannot supply these. */
  relationshipStructures?: readonly unknown[];
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ROLES = new Set<string>(DOCUMENT_ROLES);
const CALCULATION_KEYS = new Set(["result", "calculation", "calculationResult", "daysBetween"]);
const VERDICT_VALUES = new Set(["SHOWN", "PARTLY_SHOWN", "NOT_SHOWN", "NOT_APPLICABLE"]);
const KEPT = new Set(["APPLICABLE", "PRESENTATION", "STRUCTURAL"]);
const PRESENTATION = new Set(["persona", "report", "term", "note", "guideline", "referenceTable"]);
const VALUE_TYPES = new Set<FieldValueType>(["TEXT", "NUMBER", "DATE", "BOOLEAN", "MONEY", "QUANTITY"]);

type FailureCode = Exclude<PackGuidedStudyCode, "ACCEPTED">;

function sorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function claimString(claim: ResolvedPackGuidedProposal["claim"], key: string): string | null {
  const value = claim[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function toPackDefinition(definition: EffectiveDefinition): PackDefinition {
  const copy = structuredClone(definition) as PackDefinition & { origin?: unknown };
  delete copy.origin;
  return copy;
}

function pageText(pages: readonly AuthorizedDocument[], documentId: string, pageNumber: number): string | null {
  const document = pages.find((item) => item.documentId === documentId);
  return document?.pages.find((item) => item.pageNumber === pageNumber)?.text ?? null;
}

function writtenFact(extractions: readonly DocExtraction[], documentId: string, factId: string) {
  for (const extraction of extractions) {
    if (extraction.documentId !== documentId) continue;
    const fact = extraction.facts.find((item) => item.id === factId);
    if (fact) return fact;
  }
  return null;
}

function mentionsEntity(definition: PackDefinition, entityId: string): boolean {
  const walk = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(walk);
    const record = value as Record<string, unknown>;
    if (record.entityId === entityId) return true;
    return Object.values(record).some(walk);
  };
  return walk(definition);
}

function artifactsFor(pack: CompiledDomainPack): SupplementalArtifacts {
  const ofKind = (kind: PackDefinition["kind"]) => pack.definitions.filter((definition) => definition.kind === kind);
  const entities = ofKind("entity");
  const documents = ofKind("document");
  const presentation = pack.definitions.filter((definition) => PRESENTATION.has(definition.kind));
  const rules = pack.definitions.filter((definition) => definition.kind === "check" || definition.kind === "calculation");
  return {
    ontology: {
      schema: "hive.domain-ontology-spec/1",
      packRef: { packId: pack.identity.packId, version: pack.identity.version },
      entities: entities.map((definition) => ({
        id: definition.id,
        factClass: "RECORD",
        fields: definition.kind === "entity" ? definition.fields.map((field) => ({ id: field.id, valueType: field.valueType })) : [],
        ruleIds: rules.filter((rule) => mentionsEntity(rule, definition.id)).map((rule) => rule.id),
        documentKinds: documents.map((item) => item.id),
        instanceBoundary: "One record.",
        ...(definition.kind === "entity" && definition.fields[0] ? { identityKeys: [definition.fields[0].id] } : {}),
      })),
      relationships: ofKind("relationship").map((definition) => definition.kind === "relationship" ? {
        id: definition.id,
        fromEntityId: definition.fromEntityId,
        toEntityId: definition.toEntityId,
      } : definition),
      documents: documents.map((definition) => ({
        id: definition.id,
        entities: entities.map((item) => item.id),
        checksSupported: [],
        requirementBasis: "PROFESSIONALLY_RECOMMENDED",
      })),
    },
    authorityRegister: {
      schema: "hive.domain-authority-register/1",
      authorities: [],
      definitionAuthorityMap: {},
      authorityRoles: {},
      structuralDefinitions: Object.fromEntries(presentation.map((definition) => [
        definition.id,
        "STRUCTURAL - persona/report/intake definition; makes no domain claim.",
      ])),
      unusedAuthorityDisposition: {},
    },
    conflictPatterns: { schema: "hive.domain-conflict-pattern-spec/1", dp1Supported: false, patterns: [] },
    stateOverlays: { schema: "hive.domain-state-overlay-spec/1", dp1Supported: false, overlays: [] },
    factClasses: { schema: "hive.domain-fact-class-spec/1", dp1Supported: false, classes: ["RECORD"] },
    workflowCoverage: { schema: "hive.domain-workflow-coverage-spec/1", dp1Supported: false, rows: [] },
    unsupportedOperators: { schema: "hive.domain-unsupported-operator-spec/1", dp1Supported: false, operators: [] },
  };
}

function seal(body: Omit<PackGuidedStudyValidation, "digest">): PackGuidedStudyValidation {
  return { ...body, digest: packDigest(body) };
}

export function constructPackGuidedStudy(input: ConstructPackGuidedStudyInput): PackGuidedStudyResult {
  const effectivePackDigest = DIGEST.test(input.pack?.digest ?? "") ? input.pack.digest : "";
  const evidenceDigest = DIGEST.test(input.evidenceDigest) ? input.evidenceDigest : "";
  const specificationDigest = DIGEST.test(input.specification?.digest ?? "") ? input.specification.digest : "";
  const resolutionDigest = DIGEST.test(input.resolution?.digest ?? "") ? input.resolution.digest : "";
  const interpretationIds = sorted((input.resolution?.proposals ?? [])
    .filter((proposal) => proposal.kind === "STATEMENT" && typeof proposal.claim.questionId !== "string")
    .map((proposal) => proposal.proposalId));
  const uncertaintyIds = sorted((input.resolution?.proposals ?? [])
    .filter((proposal) => proposal.uncertainty !== null || proposal.kind === "GAP")
    .map((proposal) => proposal.proposalId));

  const finish = (
    code: FailureCode,
    extra?: Partial<Pick<PackGuidedStudyValidation, "compiledPackDigest" | "planDigest" | "ledgerDigest" | "engineCode" | "verifiedFactIds" | "unresolvedRelationshipIds">>,
  ): PackGuidedStudyResult => {
    const validation = seal({
      schema: PACK_GUIDED_STUDY_VALIDATION_SCHEMA,
      engineId: PACK_GUIDED_STUDY_ENGINE_ID,
      outcome: "PRESERVED",
      code,
      effectivePackDigest,
      evidenceDigest,
      specificationDigest,
      resolutionDigest,
      compiledPackDigest: extra?.compiledPackDigest ?? null,
      planDigest: extra?.planDigest ?? null,
      ledgerDigest: extra?.ledgerDigest ?? null,
      engineCode: extra?.engineCode ?? null,
      verifiedFactIds: extra?.verifiedFactIds ?? [],
      interpretationIds,
      uncertaintyIds,
      unresolvedRelationshipIds: extra?.unresolvedRelationshipIds ?? [],
    });
    return {
      ok: false,
      outcome: "PRESERVED",
      code,
      study: input.existingStudy,
      engineId: PACK_GUIDED_STUDY_ENGINE_ID,
      effectivePackDigest,
      evidenceDigest,
      validation,
    };
  };

  if (
    input.resolution?.schema !== "hive.pack-guided-resolution/1"
    || input.resolution.claimStatus !== "NOT_ACCEPTED"
    || input.resolution.studyStatus !== "NOT_ACCEPTED"
    || input.resolution.evidenceDigest !== evidenceDigest
    || packGuidedResolutionDigest(input.resolution) !== input.resolution.digest
    || input.specification?.effectivePackDigest !== effectivePackDigest
    || !ISO_DATE.test(input.studyDate)
  ) return finish("proposal_invalid");

  if (input.specification.clauses.some((clause) => clause.applicability === "UNVERIFIED")) return finish("applicability_unresolved");

  const clauseById = new Map(input.specification.clauses.map((clause) => [clause.definitionId, clause]));
  const questions = input.specification.clauses
    .filter((clause) => clause.kind === "question" && clause.applicability === "APPLICABLE")
    .map((clause) => clause.definitionId);
  const mandatory = sorted([...questions, ...input.questionObligationIds]);
  for (const questionId of mandatory) {
    const answers = input.resolution.proposals.filter((proposal) =>
      proposal.kind === "STATEMENT" && proposal.claim.questionId === questionId && proposal.clauseId === questionId);
    if (answers.length !== 1) return finish("mandatory_question_missing");
  }

  for (const proposal of input.resolution.proposals) {
    if (proposal.claimStatus !== "NOT_ACCEPTED" || proposal.studyStatus !== "NOT_ACCEPTED") return finish("proposal_invalid");
    if (!clauseById.has(proposal.clauseId)) return finish("proposal_invalid");
    if (Object.keys(proposal.claim).some((key) => CALCULATION_KEYS.has(key))) return finish("calculation_unsupported");
    if (Object.values(proposal.claim).some((value) => typeof value === "string" && VERDICT_VALUES.has(value))) return finish("proposal_invalid");
    for (const reference of proposal.references) {
      const text = pageText(input.pages, reference.documentId, reference.page);
      if (!text || computeSha256Digest(text) !== reference.sourcePageDigest) return finish("evidence_unresolved");
      if (packDigest(normalizeQuoteText(reference.quote)) !== reference.quoteDigest) return finish("evidence_unresolved");
      const authorized = new Map([[reference.page, normalizeQuoteText(text)]]);
      if (checkQuote({ page: reference.page, quote: reference.quote }, authorized) !== null) return finish("evidence_unresolved");
      const fact = writtenFact(input.extractions, reference.documentId, reference.extractionFactId);
      const sameQuote = fact?.evidence.some((item) => item.page === reference.page && normalizeQuoteText(item.quote) === normalizeQuoteText(reference.quote));
      if (!fact || !sameQuote) return finish("evidence_unresolved");
      if (reference.value !== null && reference.value !== fact.valueAsWritten) return finish("evidence_unresolved");
    }
  }

  const included = new Map(input.pack.definitions.map((definition) => [definition.id, definition]));
  const fieldRows: Array<{
    documentId: string;
    extractionFactId: string;
    entityId: string;
    instanceId: string;
    fieldId: string;
    valueType: FieldValueType;
    value: string;
  }> = [];
  const relationshipRows: Array<{
    documentId: string;
    extractionFactId: string;
    relationshipId: string;
    fromInstanceId: string;
    toInstanceId: string;
  }> = [];
  const documentRoles: Array<{ documentId: string; role: "ANCHOR" | "SUPPORTING" | "REFERENCE"; page: number; quote: string }> = [];
  const assessments: Array<{ statement: string; factIds: string[] }> = [];
  const gaps: Array<{ kind: "MISSING_DOCUMENT" | "MISSING_INFORMATION"; statement: string; documentKindId?: string; entityId?: string; fieldId?: string }> = [];
  const answers: Array<{ questionId: string; audience: "customer" | "professional" | "all"; factIds: string[]; uncertainty?: string }> = [];
  const instances = new Map<string, string>();

  for (const proposal of [...input.resolution.proposals].sort((left, right) => left.proposalId.localeCompare(right.proposalId))) {
    const reference = proposal.references[0];
    if (proposal.kind === "FIELD" || proposal.kind === "RELATIONSHIP" || proposal.kind === "DOCUMENT") {
      if (!reference || proposal.references.length !== 1 || proposal.uncertainty !== null) return finish("evidence_unresolved");
    }
    if (proposal.kind === "FIELD") {
      const entityId = claimString(proposal.claim, "entityId");
      const instanceId = claimString(proposal.claim, "instanceId");
      const fieldId = claimString(proposal.claim, "fieldId");
      const definition = entityId ? included.get(entityId) : undefined;
      const field = definition && definition.kind === "entity" ? definition.fields.find((item) => item.id === fieldId) : undefined;
      if (!entityId || !instanceId || !fieldId || !ID_PATTERN.test(instanceId) || !field || !VALUE_TYPES.has(field.valueType) || !reference) {
        return finish("proposal_invalid");
      }
      const stated = claimString(proposal.claim, "value");
      const value = reference.value;
      if (value === null || (stated !== null && stated !== value)) return finish("evidence_unresolved");
      const statedType = claimString(proposal.claim, "valueType");
      if (statedType !== null && statedType !== field.valueType) return finish("proposal_invalid");
      instances.set(instanceId, entityId);
      fieldRows.push({
        documentId: reference.documentId,
        extractionFactId: reference.extractionFactId,
        entityId,
        instanceId,
        fieldId,
        valueType: field.valueType,
        value,
      });
    }
    if (proposal.kind === "DOCUMENT") {
      const documentKindId = claimString(proposal.claim, "documentKindId");
      const role = claimString(proposal.claim, "role");
      const definition = documentKindId ? included.get(documentKindId) : undefined;
      if (!documentKindId || !role || !ROLES.has(role) || !definition || definition.kind !== "document" || !reference) {
        return finish("document_role_invalid");
      }
      if (!input.extractions.some((extraction) => extraction.documentId === reference.documentId)) return finish("document_role_missing");
      documentRoles.push({ documentId: reference.documentId, role: role as "ANCHOR" | "SUPPORTING" | "REFERENCE", page: reference.page, quote: reference.quote });
    }
    if (proposal.kind === "RELATIONSHIP") {
      const relationshipId = claimString(proposal.claim, "relationshipId");
      const fromInstanceId = claimString(proposal.claim, "fromInstanceId");
      const toInstanceId = claimString(proposal.claim, "toInstanceId");
      const definition = relationshipId ? included.get(relationshipId) : undefined;
      if (!relationshipId || !fromInstanceId || !toInstanceId || !definition || definition.kind !== "relationship" || !reference) {
        return finish("relationship_invalid");
      }
      relationshipRows.push({
        documentId: reference.documentId,
        extractionFactId: reference.extractionFactId,
        relationshipId,
        fromInstanceId,
        toInstanceId,
      });
    }
    if (proposal.kind === "STATEMENT" && typeof proposal.claim.questionId === "string") {
      const question = included.get(proposal.claim.questionId);
      const audience = question && question.kind === "question" ? question.audience : null;
      if (!audience) return finish("mandatory_question_missing");
      const factIds = proposal.references.map((item) => item.extractionFactId);
      answers.push({
        questionId: proposal.claim.questionId,
        audience,
        factIds,
        ...(proposal.uncertainty ? { uncertainty: proposal.uncertainty } : {}),
      });
    } else if (proposal.kind === "STATEMENT") {
      const statement = claimString(proposal.claim, "statement") ?? "Interpretation is not verified evidence.";
      if (proposal.references.some((item) => normalizeQuoteText(item.quote) === normalizeQuoteText(statement))) return finish("evidence_unresolved");
      assessments.push({ statement, factIds: proposal.references.map((item) => item.extractionFactId) });
    }
    if (proposal.kind === "GAP") {
      const statement = proposal.uncertainty ?? claimString(proposal.claim, "statement");
      if (!statement) return finish("proposal_invalid");
      const gapKind = claimString(proposal.claim, "gapKind");
      const documentKindId = claimString(proposal.claim, "documentKindId") ?? undefined;
      if (gapKind === "MISSING_DOCUMENT") {
        const definition = documentKindId ? included.get(documentKindId) : undefined;
        if (!definition || definition.kind !== "document") return finish("proposal_invalid");
        gaps.push({ kind: "MISSING_DOCUMENT", statement, documentKindId });
      } else if (gapKind !== null && gapKind !== "MISSING_INFORMATION") {
        return finish("proposal_invalid");
      } else {
        gaps.push({
          kind: "MISSING_INFORMATION",
          statement,
          ...(claimString(proposal.claim, "entityId") ? { entityId: claimString(proposal.claim, "entityId") ?? undefined } : {}),
          ...(claimString(proposal.claim, "fieldId") ? { fieldId: claimString(proposal.claim, "fieldId") ?? undefined } : {}),
        });
      }
    }
  }

  for (const row of relationshipRows) {
    const definition = included.get(row.relationshipId);
    if (!definition || definition.kind !== "relationship") return finish("relationship_invalid");
    if (instances.get(row.fromInstanceId) !== definition.fromEntityId || instances.get(row.toInstanceId) !== definition.toEntityId) {
      return finish("relationship_invalid");
    }
  }

  const expectedDocuments = [...input.extractions].map((extraction) => extraction.documentId).sort();
  const quotedDocuments = [...documentRoles].map((role) => role.documentId).sort();
  if (expectedDocuments.length === 0 || quotedDocuments.length !== expectedDocuments.length || expectedDocuments.some((id, index) => id !== quotedDocuments[index])) {
    return finish("document_role_missing");
  }

  for (const definition of input.pack.definitions) {
    if (definition.kind !== "entity") continue;
    const clause = clauseById.get(definition.id);
    if (!clause || !KEPT.has(clause.applicability)) continue;
    for (const field of definition.fields) {
      if (field.required !== true) continue;
      const mapped = fieldRows.some((row) => row.entityId === definition.id && row.fieldId === field.id);
      if (!mapped) return finish("incomplete_evidence");
    }
  }

  const base = input.pack.layers.find((layer) => layer.role === "BASE") ?? null;
  if (!base) return finish("proposal_invalid");
  const definitions = input.pack.definitions
    .filter((definition) => {
      const clause = clauseById.get(definition.id);
      return clause ? KEPT.has(clause.applicability) : false;
    })
    .map(toPackDefinition)
    .sort((left, right) => left.id.localeCompare(right.id));
  const source: DomainPackSource = {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: base.packId, version: base.version, title: base.packId },
    ownership: base.ownership,
    applicability: input.pack.applicability,
    definitions,
    changes: [],
    review: { status: "DRAFT" },
  };
  const compiled = compileDomainPack(source);
  if (!compiled.ok) return finish("proposal_invalid");
  const prepared = prepareInvestigationStudy({ packSource: source, artifacts: artifactsFor(compiled.value) });
  if (!prepared.ok) return finish("engine_failed", { engineCode: prepared.code });

  if (fieldRows.length === 0 && relationshipRows.length === 0) return finish("incomplete_evidence");
  const engine = runInvestigationStudyEngine({
    prepared: prepared.prepared,
    extractions: input.extractions,
    pages: input.pages,
    proposal: { schema: FIELD_MAPPING_PROPOSAL_SCHEMA, mappings: fieldRows, relationships: relationshipRows },
    studyDate: input.studyDate,
    relationshipStructures: input.relationshipStructures,
    investigation: {
      intentText: "",
      documentRoles,
      measurements: [],
      assessments,
      determinations: [],
      conflicts: [],
      gaps,
      answers,
    },
  });
  if (!engine.ok) {
    const code: FailureCode = engine.code === "INVALID_EVIDENCE" || engine.code === "VERIFICATION_FAILED"
      ? "evidence_unresolved"
      : engine.code === "EMPTY_CANDIDATES" || engine.code === "LEDGER_FAILED"
        ? "incomplete_evidence"
        : engine.code === "INCOMPLETE_DOCUMENTS"
          ? "document_role_missing"
          : engine.code === "MAPPING_INVALID"
            ? "proposal_invalid"
            : "engine_failed";
    return finish(code, { compiledPackDigest: prepared.prepared.pack.identity.digest, engineCode: engine.code });
  }

  for (const role of documentRoles) {
    const projected = engine.study.documents.find((document) => document.sourceDocumentId === role.documentId);
    if (!projected || projected.classification !== "QUOTED" || projected.role !== role.role) return finish("document_role_invalid");
  }
  for (const row of fieldRows) {
    const supported = engine.study.spine.some((item) =>
      item.status === "SUPPORTED" && item.kind === row.fieldId && item.supportingFactIds.includes(row.extractionFactId));
    if (!supported) return finish("incomplete_evidence");
  }

  const verifiedFactIds = sorted(engine.study.spine
    .filter((item) => item.status === "SUPPORTED" && item.kind !== "relationship" && item.kind !== "calculation" && item.kind !== "progress")
    .flatMap((item) => item.supportingFactIds));
  const unresolvedRelationshipIds = sorted(relationshipRows
    .filter((row) => !engine.study.spine.some((item) => item.kind === "relationship" && item.status === "SUPPORTED" && item.id.startsWith(`rel:${row.relationshipId}:`)))
    .map((row) => row.relationshipId));
  const validation = seal({
    schema: PACK_GUIDED_STUDY_VALIDATION_SCHEMA,
    engineId: PACK_GUIDED_STUDY_ENGINE_ID,
    outcome: "ACCEPTED",
    code: "ACCEPTED",
    effectivePackDigest,
    evidenceDigest,
    specificationDigest,
    resolutionDigest,
    compiledPackDigest: engine.packDigest,
    planDigest: engine.planDigest,
    ledgerDigest: engine.ledgerDigest,
    engineCode: null,
    verifiedFactIds,
    interpretationIds,
    uncertaintyIds,
    unresolvedRelationshipIds,
  });
  return {
    ok: true,
    outcome: "ACCEPTED",
    code: "ACCEPTED",
    study: engine.study,
    engineId: PACK_GUIDED_STUDY_ENGINE_ID,
    effectivePackDigest,
    evidenceDigest,
    validation,
  };
}
