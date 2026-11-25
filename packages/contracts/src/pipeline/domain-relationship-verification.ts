/**
 * Offline trusted relationship verification.
 * The binder quote-checks a relationship proposal and leaves it in review.
 * This module is the separate admission step. It validates a server-supplied
 * authorization context. It does not authenticate the actor, open a session,
 * read a credential, or call a model.
 * Acceptance is an append-only decision. Endpoint co-occurrence, keyword
 * overlap, and model confidence are not verifiers.
 */
import { packDigest } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
  type AuthorizedDocument,
  type UnresolvedCandidate,
  type UnresolvedCandidates,
} from "./domain-investigation-binder";
import { DOMAIN_INVESTIGATION_PLAN_SCHEMA, type DomainInvestigationPlan } from "./domain-investigation-plan";
import { investigationEvidenceDigest } from "./domain-investigation-ledger";
import {
  VERIFIED_CASE_FACTS_SCHEMA,
  type VerifiedCaseFacts,
  type VerifiedSourceRef,
} from "./domain-pack-rules";
import { DOMAIN_PACK_RUNTIME_SCHEMA, type CompiledDomainPack, type EffectiveDefinition } from "./domain-pack-source";
import { checkQuote, normalizeQuoteText, type VerificationPage } from "./verify-quotes";
import type { DocExtraction } from "./extraction-contracts";

export const RELATIONSHIP_VERIFICATION_SCHEMA = "hive.relationship-verification/1" as const;
export const RELATIONSHIP_VERIFICATION_CONTEXT_SCHEMA = "hive.relationship-verification-context/1" as const;
export const RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA = "hive.relationship-source-structure/1" as const;

export const RELATIONSHIP_VERIFICATION_FAILURES = [
  "CONTEXT_INVALID",
  "PERMISSION_DENIED",
  "DIGEST_MISMATCH",
  "REQUEST_INVALID",
  "CAUSAL_CONFLICT",
  "CANDIDATE_INVALID",
  "CHAIN_INVALID",
  "STRUCTURE_UNAPPROVED",
  "HUMAN_WITHHELD",
  "NOT_ELIGIBLE",
] as const;
export type RelationshipVerificationFailureCode = (typeof RELATIONSHIP_VERIFICATION_FAILURES)[number];

export type RelationshipTypedResult =
  | "NO_TYPED_SOURCE"
  | "TYPED_INAPPLICABLE"
  | "TYPED_ACCEPT"
  | "TYPED_OPPOSE"
  | "TYPED_MISMATCH"
  | "STRUCTURE_UNAPPROVED";

export type RelationshipTypedAvailability = "NO_TYPED_SOURCE" | "STRUCTURE_UNAPPROVED" | "TYPED_SOURCE_PRESENT";

export type RelationshipEvidenceRevision = {
  extractionDigest: string;
  binderDigest: string;
  evidenceDigest: string;
};

export type RelationshipVerificationContext = {
  schema: typeof RELATIONSHIP_VERIFICATION_CONTEXT_SCHEMA;
  hiveId: string;
  actorId: string;
  permission: "HIVE_OWNER";
  evidenceRevision: RelationshipEvidenceRevision;
  candidate: { candidateId: string; contentDigest: string };
  packDigest: string;
  planDigest: string;
};

export type RelationshipVerificationRequest = {
  requestId: string;
  expectedHead: string | null;
  candidateId: string;
  decision: "ACCEPT" | "REJECT" | "REVOKE";
  targetRecordId?: string;
};

export type RelationshipQuotation = {
  documentId: string;
  page: number;
  quote: string;
  excerptId: string;
};

export type RelationshipEndpoint = { entityId: string; instanceId: string };

export type RelationshipVerificationRecord = {
  schema: typeof RELATIONSHIP_VERIFICATION_SCHEMA;
  recordId: string;
  requestId: string;
  sequence: number;
  causalParentId: string | null;
  candidateId: string;
  candidateContentDigest: string;
  relationshipId: string;
  endpoints: [RelationshipEndpoint, RelationshipEndpoint];
  quotations: RelationshipQuotation[];
  method: "TYPED_SOURCE" | "AUTHORIZED_HUMAN";
  effect: "SUPPORTS" | "WITHHOLDS" | "OPPOSES" | "REVOKES";
  actorId: string;
  permission: "HIVE_OWNER";
  decision: "ACCEPT" | "REJECT" | "REVOKE";
  targetRecordId?: string;
  structureDigest?: string;
  polarity?: "HOLDS" | "DOES_NOT_HOLD";
  decidedAt: string;
  evidenceRevision: RelationshipEvidenceRevision;
  packDigest: string;
  planDigest: string;
};

export type RelationshipSourceSlot = {
  role: "FROM_IDENTITY" | "TO_IDENTITY" | "POLARITY" | "DIRECTION";
  value: string;
};

export type RelationshipSourceStructure = {
  schema: typeof RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA;
  relationshipId: string;
  structureDigest: string;
  direction: "AUTHORED_FROM_TO";
  polarity: "HOLDS" | "DOES_NOT_HOLD";
  slots: RelationshipSourceSlot[];
};

export type RelationshipIdentityDisposition = {
  relationshipId: string;
  fromInstanceId: string;
  toInstanceId: string;
  disposition: "HELD" | "NOT_HELD" | "CONTRADICTORY_RELATIONSHIP" | "UNRESOLVED";
};

export type RelationshipVerificationInput = {
  pack: CompiledDomainPack;
  plan: DomainInvestigationPlan;
  /** Binder output for this evidence revision. Its relationship array is empty. */
  verified: VerifiedCaseFacts;
  unresolved: UnresolvedCandidates;
  /** Digest returned with that binder result. */
  binderDigest: string;
  documents: readonly AuthorizedDocument[];
  extractions: readonly DocExtraction[];
  /** Server-established context. This function does not authenticate the actor. */
  context: unknown;
  records: readonly RelationshipVerificationRecord[];
  /** Server time for a new append. Replay keeps the historical timestamp. */
  decidedAt?: string;
  request?: unknown;
  /** Digest-pinned typed companions. Omitted when the case has no typed source. */
  structures?: readonly unknown[];
};

export type RelationshipVerificationDecision = {
  ok: boolean;
  code: "APPENDED" | "REPLAYED" | "NO_RECORD" | RelationshipVerificationFailureCode;
  message?: string;
  typedResult: RelationshipTypedResult;
  record: RelationshipVerificationRecord | null;
  records: readonly RelationshipVerificationRecord[];
  verified: VerifiedCaseFacts;
  unresolved: UnresolvedCandidates;
  dispositions: readonly RelationshipIdentityDisposition[];
};

type ObjectMap = Record<string, unknown>;
type ReadyContext = RelationshipVerificationContext;
type ReadyCandidate = UnresolvedCandidate;
type FailureCode = RelationshipVerificationFailureCode;

const CONTEXT_KEYS = ["schema", "hiveId", "actorId", "permission", "evidenceRevision", "candidate", "packDigest", "planDigest"];
const REVISION_KEYS = ["extractionDigest", "binderDigest", "evidenceDigest"];
const CANDIDATE_POINTER_KEYS = ["candidateId", "contentDigest"];
const REQUEST_KEYS = ["requestId", "expectedHead", "candidateId", "decision", "targetRecordId"];
const CANDIDATE_KEYS = [
  "candidateId", "kind", "trust", "reasons", "entityId", "instanceId", "fieldId", "documentId",
  "documentKindId", "extractionFactId", "relationshipId", "fromEntityId", "toEntityId",
  "fromInstanceId", "toInstanceId", "sourceRefs", "evidence",
];
const STRUCTURE_KEYS = ["schema", "relationshipId", "structureDigest", "direction", "polarity", "slots"];
const SLOT_ROLES = ["FROM_IDENTITY", "TO_IDENTITY", "POLARITY", "DIRECTION"] as const;
const DECISIONS = ["ACCEPT", "REJECT", "REVOKE"] as const;

const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);

function exactKeys(value: ObjectMap, allowed: readonly string[]): boolean {
  const ok = new Set(allowed);
  return Object.keys(value).every((key) => ok.has(key));
}

function plainText(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) freezeDeep(child);
  }
  return value;
}

function publish<T>(value: T): T {
  return freezeDeep(structuredClone(value));
}

/** Excerpt identity: document id, page, and the quote text checkQuote normalizes. */
export function relationshipExcerptId(documentId: string, page: number, quote: string): string {
  return packDigest({ documentId, page, quote: normalizeQuoteText(quote) });
}

/**
 * Server digest of one pinned unresolved candidate.
 * The material is the relationship id, authored entity ids, ordered instance ids,
 * and the excerpt ids of its evidence in stored order.
 */
export function relationshipCandidateContentDigest(candidate: {
  relationshipId: string;
  fromEntityId: string;
  toEntityId: string;
  fromInstanceId: string;
  toInstanceId: string;
  evidence: readonly { sourceDocumentId: string; page: number; quote: string }[];
}): string {
  return packDigest({
    relationshipId: candidate.relationshipId,
    fromEntityId: candidate.fromEntityId,
    toEntityId: candidate.toEntityId,
    fromInstanceId: candidate.fromInstanceId,
    toInstanceId: candidate.toInstanceId,
    excerptIds: candidate.evidence.map((item) => relationshipExcerptId(item.sourceDocumentId, item.page, item.quote)),
  });
}

/** Canonical fact identity for one relationship and one ordered endpoint pair at one evidence revision. */
export function relationshipVerificationFactId(
  relationshipId: string,
  fromInstanceId: string,
  toInstanceId: string,
  evidenceRevision: RelationshipEvidenceRevision,
): string {
  return packDigest({ relationshipId, fromInstanceId, toInstanceId, evidenceRevision });
}

/** The direction slot equals this authored from-instance to to-instance order. */
export function authoredRelationshipDirection(fromInstanceId: string, toInstanceId: string): string {
  return fromInstanceId + "->" + toInstanceId;
}

export function relationshipStructureDigest(body: {
  schema: typeof RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA;
  relationshipId: string;
  direction: "AUTHORED_FROM_TO";
  polarity: "HOLDS" | "DOES_NOT_HOLD";
  slots: readonly RelationshipSourceSlot[];
}): string {
  return packDigest(body);
}

function containsPhrase(text: string, phrase: string): boolean {
  const needle = normalizeQuoteText(phrase);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?<![A-Za-z0-9])" + escaped + "(?![A-Za-z0-9])").test(text);
}

function serverTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  return new Date(value).toISOString() === value;
}

function identityKey(relationshipId: string, fromInstanceId: string, toInstanceId: string): string {
  return relationshipId + "\0" + fromInstanceId + "\0" + toInstanceId;
}

function recordIdentity(record: RelationshipVerificationRecord): string {
  return identityKey(record.relationshipId, record.endpoints[0].instanceId, record.endpoints[1].instanceId);
}

function quotationsOf(candidate: ReadyCandidate): RelationshipQuotation[] {
  return candidate.evidence.map((item) => ({
    documentId: item.sourceDocumentId,
    page: item.page,
    quote: item.quote,
    excerptId: relationshipExcerptId(item.sourceDocumentId, item.page, item.quote),
  }));
}

function contentDigestOf(candidate: {
  relationshipId?: string;
  fromEntityId?: string;
  toEntityId?: string;
  fromInstanceId?: string;
  toInstanceId?: string;
  evidence: readonly { sourceDocumentId: string; page: number; quote: string }[];
}): string | null {
  if (!candidate.relationshipId || !candidate.fromEntityId || !candidate.toEntityId || !candidate.fromInstanceId || !candidate.toInstanceId) {
    return null;
  }
  return relationshipCandidateContentDigest({
    relationshipId: candidate.relationshipId,
    fromEntityId: candidate.fromEntityId,
    toEntityId: candidate.toEntityId,
    fromInstanceId: candidate.fromInstanceId,
    toInstanceId: candidate.toInstanceId,
    evidence: candidate.evidence,
  });
}

function baseline(input: RelationshipVerificationInput, records: readonly RelationshipVerificationRecord[] = []): RelationshipVerificationDecision {
  const verified: VerifiedCaseFacts = {
    schema: input.verified?.schema === VERIFIED_CASE_FACTS_SCHEMA ? input.verified.schema : VERIFIED_CASE_FACTS_SCHEMA,
    coverage: input.verified?.coverage === "COMPLETE" ? "COMPLETE" : "INCOMPLETE",
    facts: Array.isArray(input.verified?.facts) ? input.verified.facts : [],
    documents: Array.isArray(input.verified?.documents) ? input.verified.documents : [],
    relationships: [],
    conflicts: Array.isArray(input.verified?.conflicts) ? input.verified.conflicts : [],
  };
  const unresolved: UnresolvedCandidates = {
    schema: UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
    candidates: Array.isArray(input.unresolved?.candidates) ? input.unresolved.candidates : [],
  };
  return publish({
    ok: false,
    code: "CONTEXT_INVALID",
    typedResult: "NO_TYPED_SOURCE",
    record: null,
    records,
    verified,
    unresolved,
    dispositions: [],
  });
}

function refuse(
  code: FailureCode,
  message: string,
  typedResult: RelationshipTypedResult,
  records: readonly RelationshipVerificationRecord[],
  verified: VerifiedCaseFacts,
  unresolved: UnresolvedCandidates,
  dispositions: readonly RelationshipIdentityDisposition[] = [],
): RelationshipVerificationDecision {
  return publish({ ok: false, code, message, typedResult, record: null, records, verified, unresolved, dispositions });
}

function succeed(
  code: "APPENDED" | "REPLAYED" | "NO_RECORD",
  typedResult: RelationshipTypedResult,
  record: RelationshipVerificationRecord | null,
  records: readonly RelationshipVerificationRecord[],
  verified: VerifiedCaseFacts,
  unresolved: UnresolvedCandidates,
  dispositions: readonly RelationshipIdentityDisposition[],
): RelationshipVerificationDecision {
  return publish({ ok: true, code, typedResult, record, records, verified, unresolved, dispositions });
}

function parseContext(value: unknown): { ok: true; value: ReadyContext } | { ok: false; code: FailureCode; message: string } {
  if (!isObject(value) || !exactKeys(value, CONTEXT_KEYS)) {
    return { ok: false, code: "CONTEXT_INVALID", message: "The server context is missing a required field or carries an authorization field the request cannot supply." };
  }
  if (value.schema !== RELATIONSHIP_VERIFICATION_CONTEXT_SCHEMA) {
    return { ok: false, code: "CONTEXT_INVALID", message: "Unsupported relationship-verification context schema." };
  }
  if (!plainText(value.hiveId) || !plainText(value.actorId) || !plainText(value.packDigest, 128) || !plainText(value.planDigest, 128)) {
    return { ok: false, code: "CONTEXT_INVALID", message: "The server context needs a hive, an actor, and pinned pack and plan digests." };
  }
  if (value.permission !== "HIVE_OWNER") {
    return { ok: false, code: "PERMISSION_DENIED", message: "Relationship verification requires the server-established HIVE_OWNER permission." };
  }
  if (!isObject(value.evidenceRevision) || !exactKeys(value.evidenceRevision, REVISION_KEYS)) {
    return { ok: false, code: "CONTEXT_INVALID", message: "The evidence revision must pin the extraction, binder, and evidence digests." };
  }
  const revision = value.evidenceRevision;
  if (!plainText(revision.extractionDigest, 128) || !plainText(revision.binderDigest, 128) || !plainText(revision.evidenceDigest, 128)) {
    return { ok: false, code: "CONTEXT_INVALID", message: "Evidence revision digests must be present." };
  }
  if (!isObject(value.candidate) || !exactKeys(value.candidate, CANDIDATE_POINTER_KEYS)) {
    return { ok: false, code: "CONTEXT_INVALID", message: "The server context must name the candidate and its content digest." };
  }
  if (!plainText(value.candidate.candidateId) || !plainText(value.candidate.contentDigest, 128)) {
    return { ok: false, code: "CONTEXT_INVALID", message: "The server context must name the candidate and its content digest." };
  }
  return {
    ok: true,
    value: {
      schema: RELATIONSHIP_VERIFICATION_CONTEXT_SCHEMA,
      hiveId: value.hiveId,
      actorId: value.actorId,
      permission: "HIVE_OWNER",
      evidenceRevision: {
        extractionDigest: revision.extractionDigest,
        binderDigest: revision.binderDigest,
        evidenceDigest: revision.evidenceDigest,
      },
      candidate: { candidateId: value.candidate.candidateId, contentDigest: value.candidate.contentDigest },
      packDigest: value.packDigest,
      planDigest: value.planDigest,
    },
  };
}

function parseRequest(value: unknown): { ok: true; value: RelationshipVerificationRequest } | { ok: false; message: string } {
  if (!isObject(value) || !exactKeys(value, REQUEST_KEYS)) {
    return { ok: false, message: "A verification request may name only its id, the expected head, the candidate, the decision, and a revoke target." };
  }
  if (!plainText(value.requestId) || !plainText(value.candidateId) || !DECISIONS.includes(value.decision as "ACCEPT")) {
    return { ok: false, message: "The request needs a request id, a candidate id, and one decision." };
  }
  if (value.expectedHead !== null && !plainText(value.expectedHead, 128)) {
    return { ok: false, message: "The expected head must be the current record id, or null when the chain is empty." };
  }
  const decision = value.decision as RelationshipVerificationRequest["decision"];
  if (decision === "REVOKE") {
    if (!plainText(value.targetRecordId, 128)) return { ok: false, message: "Revocation must name the acceptance it withdraws." };
    return {
      ok: true,
      value: { requestId: value.requestId, expectedHead: value.expectedHead as string | null, candidateId: value.candidateId, decision, targetRecordId: value.targetRecordId },
    };
  }
  if (value.targetRecordId !== undefined) return { ok: false, message: "Only revocation names a target record." };
  return {
    ok: true,
    value: { requestId: value.requestId, expectedHead: value.expectedHead as string | null, candidateId: value.candidateId, decision },
  };
}

function parseCandidate(value: unknown): ReadyCandidate | null {
  if (!isObject(value) || !exactKeys(value, CANDIDATE_KEYS)) return null;
  if (!plainText(value.candidateId) || (value.kind !== "FIELD" && value.kind !== "DOCUMENT" && value.kind !== "RELATIONSHIP" && value.kind !== "UNKNOWN")) return null;
  if (value.trust !== "UNRESOLVED" && value.trust !== "REVIEW_REQUIRED") return null;
  if (!Array.isArray(value.reasons) || !value.reasons.every((reason) => typeof reason === "string")) return null;
  if (!Array.isArray(value.sourceRefs) || !Array.isArray(value.evidence)) return null;
  for (const ref of value.sourceRefs) {
    if (!isObject(ref) || !exactKeys(ref, ["documentId", "page", "excerptId"]) || typeof ref.documentId !== "string") return null;
  }
  for (const item of value.evidence) {
    if (!isObject(item) || !exactKeys(item, ["sourceDocumentId", "page", "quote"])) return null;
    if (typeof item.sourceDocumentId !== "string" || typeof item.quote !== "string" || typeof item.page !== "number") return null;
  }
  return value as unknown as ReadyCandidate;
}

function parseStructure(value: unknown): RelationshipSourceStructure | null {
  if (!isObject(value) || !exactKeys(value, STRUCTURE_KEYS)) return null;
  if (value.schema !== RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA || !plainText(value.relationshipId)) return null;
  if (value.direction !== "AUTHORED_FROM_TO" || (value.polarity !== "HOLDS" && value.polarity !== "DOES_NOT_HOLD")) return null;
  if (!plainText(value.structureDigest, 128) || !Array.isArray(value.slots) || value.slots.length !== SLOT_ROLES.length) return null;
  const slots: RelationshipSourceSlot[] = [];
  for (const slot of value.slots) {
    if (!isObject(slot) || !exactKeys(slot, ["role", "value"])) return null;
    if (!SLOT_ROLES.includes(slot.role as RelationshipSourceSlot["role"]) || typeof slot.value !== "string" || slot.value.trim() === "") return null;
    slots.push({ role: slot.role as RelationshipSourceSlot["role"], value: slot.value });
  }
  if (new Set(slots.map((slot) => slot.role)).size !== SLOT_ROLES.length) return null;
  const polarity: "HOLDS" | "DOES_NOT_HOLD" = value.polarity === "HOLDS" ? "HOLDS" : "DOES_NOT_HOLD";
  const body = {
    schema: RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA,
    relationshipId: value.relationshipId,
    direction: "AUTHORED_FROM_TO" as const,
    polarity,
    slots,
  };
  if (relationshipStructureDigest(body) !== value.structureDigest) return null;
  return { ...body, structureDigest: value.structureDigest };
}

/**
 * Typed-source availability for one relationship id.
 * An empty companion is NO_TYPED_SOURCE. A malformed companion is STRUCTURE_UNAPPROVED.
 * TYPED_SOURCE_PRESENT means a digest-pinned structure was supplied. It is not admission.
 * This function does not read case text.
 */
export function assessRelationshipTypedSource(
  relationshipId: string,
  structures: readonly unknown[] | undefined,
): RelationshipTypedAvailability {
  if (structures === undefined || structures.length === 0) return "NO_TYPED_SOURCE";
  if (!Array.isArray(structures)) return "STRUCTURE_UNAPPROVED";
  const parsed: RelationshipSourceStructure[] = [];
  for (const item of structures) {
    const structure = parseStructure(item);
    if (!structure) return "STRUCTURE_UNAPPROVED";
    parsed.push(structure);
  }
  const matches = parsed.filter((structure) => structure.relationshipId === relationshipId);
  if (matches.length === 0) return "NO_TYPED_SOURCE";
  if (matches.length > 1) return "STRUCTURE_UNAPPROVED";
  return "TYPED_SOURCE_PRESENT";
}

function pageCorpus(documents: readonly AuthorizedDocument[]): Map<string, Map<number, string>> | null {
  const corpus = new Map<string, Map<number, string>>();
  for (const document of documents ?? []) {
    if (!plainText(document?.documentId) || corpus.has(document.documentId)) return null;
    const pages = new Map<number, string>();
    for (const page of document.pages ?? []) {
      if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1 || typeof page.text !== "string" || pages.has(page.pageNumber)) return null;
      pages.set(page.pageNumber, normalizeQuoteText(page.text));
    }
    corpus.set(document.documentId, pages);
  }
  return corpus;
}

function quotesPass(candidate: ReadyCandidate, documents: readonly AuthorizedDocument[]): boolean {
  const corpus = pageCorpus(documents);
  if (!corpus || candidate.evidence.length === 0) return false;
  return candidate.evidence.every((item) => {
    const pages = corpus.get(item.sourceDocumentId);
    if (!pages) return false;
    return checkQuote({ page: item.page, quote: item.quote }, pages) === null;
  });
}

function identityValues(plan: DomainInvestigationPlan, verified: VerifiedCaseFacts, entityId: string, instanceId: string): string[] | null {
  const task = plan.tasks.find((item) => item.definitionId === entityId && item.taskKind === "BIND_ENTITY");
  const keys = task?.identityKeys;
  if (!keys || keys.length === 0) return null;
  const values: string[] = [];
  for (const fieldId of keys) {
    const matches = verified.facts.filter((fact) => fact.entityId === entityId && fact.instanceId === instanceId && fact.fieldId === fieldId && fact.status === "VERIFIED" && fact.sourceRefs.some((ref) => !!ref.documentId));
    const distinct = [...new Set(matches.map((fact) => fact.value.value))];
    if (distinct.length !== 1) return null;
    values.push(distinct[0]);
  }
  return values;
}

function relationshipDefinition(pack: CompiledDomainPack, relationshipId: string): Extract<EffectiveDefinition, { kind: "relationship" }> | null {
  const definition = pack.definitions.find((item) => item.id === relationshipId);
  return definition?.kind === "relationship" ? definition : null;
}

function eligible(candidate: ReadyCandidate, input: RelationshipVerificationInput): { ok: true } | { ok: false; message: string } {
  if (candidate.kind !== "RELATIONSHIP" || candidate.trust !== "REVIEW_REQUIRED") {
    return { ok: false, message: "Only a relationship candidate left in review can be decided." };
  }
  if (candidate.reasons.length !== 1 || candidate.reasons[0] !== "RELATIONSHIP_SEMANTICS_UNVERIFIED") {
    return { ok: false, message: "The candidate is not an unverified relationship proposal." };
  }
  const relationshipId = candidate.relationshipId ?? "";
  const relationship = relationshipDefinition(input.pack, relationshipId);
  if (!relationship || !candidate.fromInstanceId || !candidate.toInstanceId || !candidate.fromEntityId || !candidate.toEntityId) {
    return { ok: false, message: "The candidate does not name an authored relationship and its ordered endpoints." };
  }
  if (candidate.fromEntityId !== relationship.fromEntityId || candidate.toEntityId !== relationship.toEntityId) {
    return { ok: false, message: "The candidate endpoints are not the authored direction." };
  }
  const from = identityValues(input.plan, input.verified, relationship.fromEntityId, candidate.fromInstanceId);
  const to = identityValues(input.plan, input.verified, relationship.toEntityId, candidate.toInstanceId);
  if (!from || !to) return { ok: false, message: "Both endpoints must be verified instances in the authored order." };
  const swappedFrom = identityValues(input.plan, input.verified, relationship.fromEntityId, candidate.toInstanceId);
  const swappedTo = identityValues(input.plan, input.verified, relationship.toEntityId, candidate.fromInstanceId);
  if (swappedFrom || swappedTo) return { ok: false, message: "Swapped endpoints are a different relationship claim." };
  if (!quotesPass(candidate, input.documents)) return { ok: false, message: "Every stored quotation must pass the authorized quote check." };
  const quotes = candidate.evidence.map((item) => normalizeQuoteText(item.quote));
  const named = [...from, ...to].every((value) => quotes.some((quote) => containsPhrase(quote, value)));
  if (!named) return { ok: false, message: "Both verified identity values must occur in the stored quotations." };
  return { ok: true };
}

function slotValue(structure: RelationshipSourceStructure, role: RelationshipSourceSlot["role"]): string {
  return structure.slots.find((slot) => slot.role === role)?.value ?? "";
}

function classifyTyped(
  candidate: ReadyCandidate,
  structure: RelationshipSourceStructure | null,
  input: RelationshipVerificationInput,
): Exclude<RelationshipTypedResult, "NO_TYPED_SOURCE" | "STRUCTURE_UNAPPROVED"> {
  if (!structure) return "TYPED_INAPPLICABLE";
  if (!quotesPass(candidate, input.documents)) return "TYPED_INAPPLICABLE";
  const relationship = candidate.relationshipId ? relationshipDefinition(input.pack, candidate.relationshipId) : null;
  if (!relationship || !candidate.fromInstanceId || !candidate.toInstanceId) return "TYPED_INAPPLICABLE";
  const from = identityValues(input.plan, input.verified, relationship.fromEntityId, candidate.fromInstanceId);
  const to = identityValues(input.plan, input.verified, relationship.toEntityId, candidate.toInstanceId);
  if (!from || !to) return "TYPED_INAPPLICABLE";
  const quotes = candidate.evidence.map((item) => normalizeQuoteText(item.quote));
  const presented = (value: string) => quotes.some((quote) => containsPhrase(quote, value));
  const polaritySlot = slotValue(structure, "POLARITY");
  const directionSlot = slotValue(structure, "DIRECTION");
  if (!presented(polaritySlot) || !presented(directionSlot)) return "TYPED_INAPPLICABLE";
  const scalars = new Set(input.verified.facts.filter((fact) => fact.status === "VERIFIED" && fact.sourceRefs.some((ref) => !!ref.documentId)).map((fact) => normalizeQuoteText(fact.value.value)));
  const fromSlot = slotValue(structure, "FROM_IDENTITY");
  const toSlot = slotValue(structure, "TO_IDENTITY");
  const fromToken = from.map((value) => normalizeQuoteText(value)).join("\u001f");
  const toToken = to.map((value) => normalizeQuoteText(value)).join("\u001f");
  const matched = presented(fromSlot)
    && presented(toSlot)
    && normalizeQuoteText(fromSlot) === fromToken
    && normalizeQuoteText(toSlot) === toToken
    && scalars.has(normalizeQuoteText(polaritySlot))
    && normalizeQuoteText(directionSlot) === normalizeQuoteText(authoredRelationshipDirection(candidate.fromInstanceId, candidate.toInstanceId));
  if (!matched) return "TYPED_MISMATCH";
  return structure.polarity === "HOLDS" ? "TYPED_ACCEPT" : "TYPED_OPPOSE";
}

function recordBodyDigest(record: Omit<RelationshipVerificationRecord, "recordId">): string {
  return packDigest(record);
}

function quotationIntact(quotation: RelationshipQuotation): boolean {
  return plainText(quotation.documentId)
    && Number.isInteger(quotation.page)
    && quotation.page >= 1
    && typeof quotation.quote === "string"
    && quotation.quote.trim() !== ""
    && quotation.excerptId === relationshipExcerptId(quotation.documentId, quotation.page, quotation.quote);
}

function effectIntact(record: RelationshipVerificationRecord): boolean {
  if (record.permission !== "HIVE_OWNER" || record.schema !== RELATIONSHIP_VERIFICATION_SCHEMA) return false;
  if (record.method === "AUTHORIZED_HUMAN" && record.decision === "ACCEPT") {
    return record.effect === "SUPPORTS" && record.structureDigest === undefined && record.polarity === undefined && record.targetRecordId === undefined;
  }
  if (record.method === "AUTHORIZED_HUMAN" && record.decision === "REJECT") {
    return record.effect === "WITHHOLDS" && record.structureDigest === undefined && record.polarity === undefined && record.targetRecordId === undefined;
  }
  if (record.method === "AUTHORIZED_HUMAN" && record.decision === "REVOKE") {
    return record.effect === "REVOKES" && plainText(record.targetRecordId, 128) && record.structureDigest === undefined && record.polarity === undefined;
  }
  if (record.method === "TYPED_SOURCE" && record.decision === "ACCEPT") {
    return record.effect === "SUPPORTS" && plainText(record.structureDigest, 128) && record.polarity === "HOLDS" && record.targetRecordId === undefined;
  }
  if (record.method === "TYPED_SOURCE" && record.decision === "REJECT" && record.effect === "OPPOSES") {
    return plainText(record.structureDigest, 128) && record.polarity === "DOES_NOT_HOLD" && record.targetRecordId === undefined;
  }
  if (record.method === "TYPED_SOURCE" && record.decision === "REJECT" && record.effect === "WITHHOLDS") {
    return plainText(record.structureDigest, 128) && (record.polarity === "HOLDS" || record.polarity === "DOES_NOT_HOLD") && record.targetRecordId === undefined;
  }
  return false;
}

function sameRevision(record: RelationshipVerificationRecord, context: ReadyContext): boolean {
  const revision = record.evidenceRevision;
  return !!revision
    && revision.extractionDigest === context.evidenceRevision.extractionDigest
    && revision.binderDigest === context.evidenceRevision.binderDigest
    && revision.evidenceDigest === context.evidenceRevision.evidenceDigest
    && record.packDigest === context.packDigest
    && record.planDigest === context.planDigest;
}

function parseChain(records: readonly RelationshipVerificationRecord[], context: ReadyContext): { ok: true; records: RelationshipVerificationRecord[] } | { ok: false; message: string } {
  if (!Array.isArray(records)) return { ok: false, message: "The verification chain must be a list." };
  const ordered = [...records].sort((left, right) => left.sequence - right.sequence);
  const requestIds = new Set<string>();
  const revokeTargets = new Set<string>();
  for (let index = 0; index < ordered.length; index += 1) {
    const record: RelationshipVerificationRecord | undefined = ordered[index];
    if (!record || record.sequence !== index + 1) return { ok: false, message: "Verification records must form one contiguous chain." };
    if (!effectIntact(record) || !sameRevision(record, context) || !serverTime(record.decidedAt) || !plainText(record.actorId) || !plainText(record.requestId)) {
      return { ok: false, message: "A verification record does not match the pinned revision or its decision." };
    }
    if ((index === 0 && record.causalParentId !== null) || (index > 0 && record.causalParentId !== ordered[index - 1]?.recordId)) {
      return { ok: false, message: "Verification records must keep their causal parents." };
    }
    const [fromEndpoint, toEndpoint] = record.endpoints;
    if (!fromEndpoint || !toEndpoint || !plainText(fromEndpoint.entityId) || !plainText(fromEndpoint.instanceId) || !plainText(toEndpoint.entityId) || !plainText(toEndpoint.instanceId)) {
      return { ok: false, message: "A verification record must keep its ordered endpoints." };
    }
    const quotations: readonly RelationshipQuotation[] = record.quotations;
    if (quotations.length === 0 || quotations.some((quotation) => !quotationIntact(quotation))) {
      return { ok: false, message: "A verification record must keep the quotations that were decided." };
    }
    const digest = contentDigestOf({
      relationshipId: record.relationshipId,
      fromEntityId: fromEndpoint.entityId,
      toEntityId: toEndpoint.entityId,
      fromInstanceId: fromEndpoint.instanceId,
      toInstanceId: toEndpoint.instanceId,
      evidence: quotations.map((quotation) => ({
        sourceDocumentId: quotation.documentId,
        page: quotation.page,
        quote: quotation.quote,
      })),
    });
    if (!plainText(record.relationshipId) || digest !== record.candidateContentDigest) {
      return { ok: false, message: "A verification record does not match its candidate content digest." };
    }
    const { recordId, ...body } = record;
    if (!plainText(recordId, 128) || recordBodyDigest(body) !== recordId) return { ok: false, message: "A verification record id does not match its body." };
    if (requestIds.has(record.requestId)) return { ok: false, message: "Verification request ids must be unique on one chain." };
    requestIds.add(record.requestId);
    if (record.decision === "REVOKE" && record.targetRecordId) {
      if (revokeTargets.has(record.targetRecordId)) return { ok: false, message: "An acceptance can be revoked once." };
      revokeTargets.add(record.targetRecordId);
      const target = ordered.find((item) => item.recordId === record.targetRecordId);
      if (!target || target.method !== "AUTHORIZED_HUMAN" || target.decision !== "ACCEPT" || target.effect !== "SUPPORTS") {
        return { ok: false, message: "Revocation must name an earlier human acceptance." };
      }
    }
  }
  return { ok: true, records: ordered };
}

function unrevokedSupports(records: readonly RelationshipVerificationRecord[]): RelationshipVerificationRecord[] {
  const revoked = new Set(records.filter((record) => record.effect === "REVOKES" && record.targetRecordId).map((record) => record.targetRecordId));
  return records.filter((record) => record.effect === "SUPPORTS" && !revoked.has(record.recordId));
}

function copyRef(ref: VerifiedSourceRef): VerifiedSourceRef {
  return {
    documentId: ref.documentId,
    ...(ref.page !== undefined ? { page: ref.page } : {}),
    ...(ref.excerptId !== undefined ? { excerptId: ref.excerptId } : {}),
  };
}

/**
 * Admitted source refs are the supporting candidates' own source refs.
 * The coverage ledger treats a verified relationship as a copy of an unresolved
 * candidate when every admitted source ref is also one of that candidate's source refs.
 * Excerpt identity stays on the verification quotations.
 */
function sourceRefsFor(record: RelationshipVerificationRecord, candidates: readonly UnresolvedCandidate[]): VerifiedSourceRef[] {
  const candidate = candidates.find((item) => item.candidateId === record.candidateId);
  const wanted = new Set(record.quotations.map((quotation) => quotation.documentId + "\0" + String(quotation.page)));
  const matched = (candidate?.sourceRefs ?? []).filter((ref) => wanted.has(ref.documentId + "\0" + (ref.page ?? "")));
  const refs: VerifiedSourceRef[] = matched.length > 0
    ? matched.map(copyRef)
    : record.quotations.map((quotation) => ({ documentId: quotation.documentId, page: String(quotation.page) }));
  const seen = new Set<string>();
  const unique: VerifiedSourceRef[] = [];
  for (const ref of refs) {
    const key = ref.documentId + "\0" + (ref.page ?? "") + "\0" + (ref.excerptId ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique.sort((left, right) => (left.documentId + "\0" + (left.page ?? "") + "\0" + (left.excerptId ?? "")).localeCompare(right.documentId + "\0" + (right.page ?? "") + "\0" + (right.excerptId ?? "")));
}

function fold(
  input: RelationshipVerificationInput,
  records: readonly RelationshipVerificationRecord[],
  context: ReadyContext,
): { verified: VerifiedCaseFacts; unresolved: UnresolvedCandidates; dispositions: RelationshipIdentityDisposition[] } {
  const supports = unrevokedSupports(records);
  const identities = [...new Set(records.map(recordIdentity))].sort((left, right) => left.localeCompare(right));
  const dispositions: RelationshipIdentityDisposition[] = [];
  const relationships: VerifiedCaseFacts["relationships"] = [];
  for (const key of identities) {
    const [relationshipId, fromInstanceId, toInstanceId] = key.split("\0");
    const groupSupports = supports.filter((record) => recordIdentity(record) === key);
    const opposes = records.some((record) => record.effect === "OPPOSES" && recordIdentity(record) === key);
    const disposition = groupSupports.length > 0 && opposes
      ? "CONTRADICTORY_RELATIONSHIP"
      : groupSupports.length > 0
        ? "HELD"
        : opposes
          ? "NOT_HELD"
          : "UNRESOLVED";
    dispositions.push({ relationshipId, fromInstanceId, toInstanceId, disposition });
    if (disposition !== "HELD") continue;
    const refs = groupSupports.flatMap((record) => sourceRefsFor(record, input.unresolved.candidates));
    const seen = new Set<string>();
    const sourceRefs: VerifiedSourceRef[] = [];
    for (const ref of refs) {
      const refKey = ref.documentId + "\0" + (ref.page ?? "") + "\0" + (ref.excerptId ?? "");
      if (seen.has(refKey)) continue;
      seen.add(refKey);
      sourceRefs.push(ref);
    }
    sourceRefs.sort((left, right) => (left.documentId + "\0" + (left.page ?? "") + "\0" + (left.excerptId ?? "")).localeCompare(right.documentId + "\0" + (right.page ?? "") + "\0" + (right.excerptId ?? "")));
    relationships.push({
      id: relationshipVerificationFactId(relationshipId, fromInstanceId, toInstanceId, context.evidenceRevision),
      status: "VERIFIED",
      relationshipId,
      fromInstanceId,
      toInstanceId,
      sourceRefs,
    });
  }
  relationships.sort((left, right) => left.id.localeCompare(right.id));
  const admitted = new Set(supports.map((record) => record.candidateId));
  return {
    verified: {
      schema: input.verified.schema,
      coverage: input.verified.coverage,
      facts: input.verified.facts,
      documents: input.verified.documents,
      relationships,
      conflicts: input.verified.conflicts,
    },
    unresolved: {
      schema: input.unresolved.schema,
      candidates: input.unresolved.candidates.filter((candidate) => !admitted.has(candidate.candidateId)),
    },
    dispositions,
  };
}

function headId(records: readonly RelationshipVerificationRecord[]): string | null {
  return records.length === 0 ? null : records[records.length - 1]?.recordId ?? null;
}

function typedRequestId(contentDigest: string, structureDigest: string, revision: RelationshipEvidenceRevision, effect: "SUPPORTS" | "WITHHOLDS" | "OPPOSES"): string {
  return packDigest({ candidateContentDigest: contentDigest, structureDigest, evidenceRevision: revision, effect });
}

function appendRecord(
  records: readonly RelationshipVerificationRecord[],
  body: Omit<RelationshipVerificationRecord, "recordId" | "sequence" | "causalParentId">,
): { records: RelationshipVerificationRecord[]; record: RelationshipVerificationRecord } {
  const sequence = records.length + 1;
  const causalParentId = headId(records);
  const material = { ...body, sequence, causalParentId };
  const record: RelationshipVerificationRecord = { ...material, recordId: recordBodyDigest(material) };
  return { records: [...records, record], record };
}

function oppositionStands(records: readonly RelationshipVerificationRecord[], candidate: ReadyCandidate): boolean {
  if (!candidate.relationshipId || !candidate.fromInstanceId || !candidate.toInstanceId) return false;
  const key = identityKey(candidate.relationshipId, candidate.fromInstanceId, candidate.toInstanceId);
  return records.some((record) => record.effect === "OPPOSES" && recordIdentity(record) === key);
}

/**
 * Validates the supplied context and appends at most one decision.
 * The fold of the chain is the only relationship admission. Replaying a request
 * returns the historical record and does not apply its effect again.
 */
export function decideRelationshipVerification(input: RelationshipVerificationInput): RelationshipVerificationDecision {
  const empty = baseline(input);
  if (!isObject(input?.pack) || input.pack.schema !== DOMAIN_PACK_RUNTIME_SCHEMA || !plainText(input.pack.identity?.digest, 128)) {
    return { ...empty, message: "Verification starts from a compiled domain-pack snapshot." };
  }
  if (!isObject(input?.plan) || input.plan.schema !== DOMAIN_INVESTIGATION_PLAN_SCHEMA || !plainText(input.plan.digest, 128)) {
    return { ...empty, message: "Verification starts from a compiled investigation plan." };
  }
  if (!isObject(input.verified) || input.verified.schema !== VERIFIED_CASE_FACTS_SCHEMA || !Array.isArray(input.verified.relationships)) {
    return { ...empty, message: "Verification reads the binder's verified case facts." };
  }
  if (input.verified.relationships.length > 0) {
    return { ...empty, message: "Relationship facts are admitted only by folding verification records." };
  }
  if (!isObject(input.unresolved) || input.unresolved.schema !== UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA || !Array.isArray(input.unresolved.candidates)) {
    return { ...empty, message: "Verification reads the binder's unresolved candidates." };
  }
  const context = parseContext(input.context);
  if (!context.ok) return { ...empty, code: context.code, message: context.message };
  const pinned = context.value;
  if (input.plan.pack.digest !== input.pack.identity.digest || input.plan.digest !== pinned.planDigest || input.pack.identity.digest !== pinned.packDigest) {
    return { ...empty, code: "DIGEST_MISMATCH", message: "The pack or plan digest is not the pinned revision." };
  }
  if (pinned.evidenceRevision.extractionDigest !== authorizedExtractionDigest(input.extractions ?? [])) {
    return { ...empty, code: "DIGEST_MISMATCH", message: "The extraction digest is not the authorized extraction." };
  }
  if (pinned.evidenceRevision.binderDigest !== input.binderDigest || input.binderDigest !== packDigest({ verified: input.verified, unresolved: input.unresolved })) {
    return { ...empty, code: "DIGEST_MISMATCH", message: "The binder digest is not the binder result for this evidence." };
  }
  if (pinned.evidenceRevision.evidenceDigest !== investigationEvidenceDigest(input.verified, input.unresolved)) {
    return { ...empty, code: "DIGEST_MISMATCH", message: "The evidence digest is not the verified facts and unresolved candidates." };
  }
  const chain = parseChain(input.records ?? [], pinned);
  if (!chain.ok) return { ...empty, code: "CHAIN_INVALID", message: chain.message };
  const current = fold(input, chain.records, pinned);
  const rawCandidate = input.unresolved.candidates.find((item) => isObject(item) && item.candidateId === pinned.candidate.candidateId);
  if (!rawCandidate) {
    return refuse("CANDIDATE_INVALID", "The context candidate is not in the pinned unresolved set.", "NO_TYPED_SOURCE", chain.records, current.verified, current.unresolved, current.dispositions);
  }
  const candidate = parseCandidate(rawCandidate);
  if (!candidate) {
    return refuse("CANDIDATE_INVALID", "The candidate carries a decision, method, actor, verifier, status, or another field a proposal cannot supply.", "NO_TYPED_SOURCE", chain.records, current.verified, current.unresolved, current.dispositions);
  }
  const digest = contentDigestOf(candidate);
  if (!digest || digest !== pinned.candidate.contentDigest) {
    return refuse("DIGEST_MISMATCH", "The candidate content digest does not match the pinned unresolved candidate.", "NO_TYPED_SOURCE", chain.records, current.verified, current.unresolved, current.dispositions);
  }
  const availability = assessRelationshipTypedSource(candidate.relationshipId ?? "", input.structures);
  if (availability === "STRUCTURE_UNAPPROVED") {
    return refuse("STRUCTURE_UNAPPROVED", "The typed-source companion is not an approved structure for this relationship.", "STRUCTURE_UNAPPROVED", chain.records, current.verified, current.unresolved, current.dispositions);
  }
  const structure = availability === "TYPED_SOURCE_PRESENT"
    ? (input.structures ?? []).map(parseStructure).find((item) => item?.relationshipId === candidate.relationshipId) ?? null
    : null;
  const typed: RelationshipTypedResult = availability === "NO_TYPED_SOURCE" ? "NO_TYPED_SOURCE" : classifyTyped(candidate, structure, input);
  const request = input.request === undefined ? null : parseRequest(input.request);
  if (input.request !== undefined && request && !request.ok) {
    return refuse("REQUEST_INVALID", request.message, typed, chain.records, current.verified, current.unresolved, current.dispositions);
  }
  const human = request && request.ok ? request.value : null;
  if (human && human.candidateId !== pinned.candidate.candidateId) {
    return refuse("REQUEST_INVALID", "The request candidate does not match the server context.", typed, chain.records, current.verified, current.unresolved, current.dispositions);
  }
  if (human) {
    const existing = chain.records.find((record) => record.requestId === human.requestId);
    if (existing) return succeed("REPLAYED", typed, existing, chain.records, current.verified, current.unresolved, current.dispositions);
  }
  const decisive = typed === "TYPED_ACCEPT" || typed === "TYPED_OPPOSE" || typed === "TYPED_MISMATCH";
  if (!human && !decisive) return succeed("NO_RECORD", typed, null, chain.records, current.verified, current.unresolved, current.dispositions);
  const gate = eligible(candidate, input);
  if (!gate.ok) return refuse("NOT_ELIGIBLE", gate.message, typed, chain.records, current.verified, current.unresolved, current.dispositions);
  if (!serverTime(input.decidedAt)) {
    return refuse("CONTEXT_INVALID", "A new verification record needs the server time of the append.", typed, chain.records, current.verified, current.unresolved, current.dispositions);
  }
  if (decisive && structure) {
    const effect = typed === "TYPED_ACCEPT" ? "SUPPORTS" : typed === "TYPED_OPPOSE" ? "OPPOSES" : "WITHHOLDS";
    const requestId = typedRequestId(pinned.candidate.contentDigest, structure.structureDigest, pinned.evidenceRevision, effect);
    const existing = chain.records.find((record) => record.requestId === requestId);
    if (existing) {
      if (human) return refuse("HUMAN_WITHHELD", "A typed result already decides this evidence. A human action cannot replace it.", typed, chain.records, current.verified, current.unresolved, current.dispositions);
      return succeed("REPLAYED", typed, existing, chain.records, current.verified, current.unresolved, current.dispositions);
    }
    const appended = appendRecord(chain.records, {
      schema: RELATIONSHIP_VERIFICATION_SCHEMA,
      requestId,
      candidateId: candidate.candidateId,
      candidateContentDigest: pinned.candidate.contentDigest,
      relationshipId: candidate.relationshipId ?? "",
      endpoints: [
        { entityId: candidate.fromEntityId ?? "", instanceId: candidate.fromInstanceId ?? "" },
        { entityId: candidate.toEntityId ?? "", instanceId: candidate.toInstanceId ?? "" },
      ],
      quotations: quotationsOf(candidate),
      method: "TYPED_SOURCE",
      effect,
      actorId: pinned.actorId,
      permission: "HIVE_OWNER",
      decision: typed === "TYPED_ACCEPT" ? "ACCEPT" : "REJECT",
      structureDigest: structure.structureDigest,
      polarity: structure.polarity,
      decidedAt: input.decidedAt,
      evidenceRevision: pinned.evidenceRevision,
      packDigest: pinned.packDigest,
      planDigest: pinned.planDigest,
    });
    const next = fold(input, appended.records, pinned);
    return succeed("APPENDED", typed, appended.record, appended.records, next.verified, next.unresolved, next.dispositions);
  }
  if (!human) return succeed("NO_RECORD", typed, null, chain.records, current.verified, current.unresolved, current.dispositions);
  if (human.expectedHead !== headId(chain.records)) {
    return refuse("CAUSAL_CONFLICT", "The expected head is not the current verification record.", typed, chain.records, current.verified, current.unresolved, current.dispositions);
  }
  if (human.decision === "ACCEPT" && oppositionStands(chain.records, candidate)) {
    return refuse("HUMAN_WITHHELD", "Typed opposition stands for this evidence revision. A later human acceptance cannot clear it.", typed, chain.records, current.verified, current.unresolved, current.dispositions);
  }
  const openSupport = unrevokedSupports(chain.records).some((record) => record.candidateId === candidate.candidateId);
  if ((human.decision === "ACCEPT" || human.decision === "REJECT") && openSupport) {
    return refuse("NOT_ELIGIBLE", "This candidate already has an unrevoked acceptance. Withdrawal is revocation.", typed, chain.records, current.verified, current.unresolved, current.dispositions);
  }
  if (human.decision === "REVOKE") {
    const target = chain.records.find((record) => record.recordId === human.targetRecordId);
    if (!target || target.method !== "AUTHORIZED_HUMAN" || target.decision !== "ACCEPT" || target.effect !== "SUPPORTS") {
      return refuse("NOT_ELIGIBLE", "Revocation applies only to an earlier human acceptance.", typed, chain.records, current.verified, current.unresolved, current.dispositions);
    }
    if (target.candidateId !== candidate.candidateId || target.candidateContentDigest !== pinned.candidate.contentDigest) {
      return refuse("CANDIDATE_INVALID", "Revocation must name the acceptance of this pinned candidate.", typed, chain.records, current.verified, current.unresolved, current.dispositions);
    }
    if (chain.records.some((record) => record.effect === "REVOKES" && record.targetRecordId === target.recordId)) {
      return refuse("CAUSAL_CONFLICT", "That acceptance is already revoked.", typed, chain.records, current.verified, current.unresolved, current.dispositions);
    }
    const appended = appendRecord(chain.records, {
      schema: RELATIONSHIP_VERIFICATION_SCHEMA,
      requestId: human.requestId,
      candidateId: target.candidateId,
      candidateContentDigest: target.candidateContentDigest,
      relationshipId: target.relationshipId,
      endpoints: [
        { entityId: target.endpoints[0].entityId, instanceId: target.endpoints[0].instanceId },
        { entityId: target.endpoints[1].entityId, instanceId: target.endpoints[1].instanceId },
      ],
      quotations: target.quotations.map((quotation) => ({ ...quotation })),
      method: "AUTHORIZED_HUMAN",
      effect: "REVOKES",
      actorId: pinned.actorId,
      permission: "HIVE_OWNER",
      decision: "REVOKE",
      targetRecordId: target.recordId,
      decidedAt: input.decidedAt,
      evidenceRevision: pinned.evidenceRevision,
      packDigest: pinned.packDigest,
      planDigest: pinned.planDigest,
    });
    const next = fold(input, appended.records, pinned);
    return succeed("APPENDED", typed, appended.record, appended.records, next.verified, next.unresolved, next.dispositions);
  }
  const appended = appendRecord(chain.records, {
    schema: RELATIONSHIP_VERIFICATION_SCHEMA,
    requestId: human.requestId,
    candidateId: candidate.candidateId,
    candidateContentDigest: pinned.candidate.contentDigest,
    relationshipId: candidate.relationshipId ?? "",
    endpoints: [
      { entityId: candidate.fromEntityId ?? "", instanceId: candidate.fromInstanceId ?? "" },
      { entityId: candidate.toEntityId ?? "", instanceId: candidate.toInstanceId ?? "" },
    ],
    quotations: quotationsOf(candidate),
    method: "AUTHORIZED_HUMAN",
    effect: human.decision === "ACCEPT" ? "SUPPORTS" : "WITHHOLDS",
    actorId: pinned.actorId,
    permission: "HIVE_OWNER",
    decision: human.decision,
    decidedAt: input.decidedAt,
    evidenceRevision: pinned.evidenceRevision,
    packDigest: pinned.packDigest,
    planDigest: pinned.planDigest,
  });
  const next = fold(input, appended.records, pinned);
  return succeed("APPENDED", typed, appended.record, appended.records, next.verified, next.unresolved, next.dispositions);
}
