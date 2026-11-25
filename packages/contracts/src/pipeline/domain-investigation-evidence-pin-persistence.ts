/**
 * Persistence contract for hive.investigation-evidence-pin/1.
 *
 * investigationEvidencePinWrite is the payload the pin-creation RPC stores.
 * It rechecks the preparer's canonical preimages and digests. Matching hashes
 * are not admission: the RPC is service_role only, revalidates Hive ownership,
 * and accepts a verified fact only when it is a stored extraction fact whose
 * quote is on the authorized page. This module does not bind candidates,
 * authorize a session, append a decision, or call a model.
 *
 * The stored relationship-verification chain starts at sequence 0. That head
 * is not a decision. Decision records begin at sequence 1 in a later gate.
 * This module does not call the verifier.
 */
import { createHash } from "node:crypto";
import { canonicalPackJson, packDigest } from "./domain-pack-compiler";
import { UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA } from "./domain-investigation-binder";
import {
  EVIDENCE_PIN_ARTIFACT_RETRIEVAL,
  INVESTIGATION_EVIDENCE_PIN_SCHEMA,
  type InvestigationEvidencePin,
} from "./domain-investigation-evidence-pin";
import { investigationEvidenceDigest } from "./domain-investigation-ledger";
import { DOMAIN_INVESTIGATION_PLAN_SCHEMA } from "./domain-investigation-plan";
import { VERIFIED_CASE_FACTS_SCHEMA } from "./domain-pack-rules";
import { DOMAIN_PACK_RUNTIME_SCHEMA } from "./domain-pack-source";

export const INVESTIGATION_EVIDENCE_PIN_RECEIPT_SCHEMA = "hive.investigation-evidence-pin-receipt/1" as const;
export const RELATIONSHIP_VERIFICATION_CHAIN_HEAD_SCHEMA = "hive.relationship-verification-head/1" as const;

export const EVIDENCE_PIN_PERSISTENCE_OUTCOMES = ["created", "replayed", "aliased"] as const;
export type EvidencePinPersistenceOutcome = (typeof EVIDENCE_PIN_PERSISTENCE_OUTCOMES)[number];

export const EVIDENCE_PIN_PERSISTENCE_FAILURES = [
  "auth_required",
  "hive_not_found",
  "access_denied",
  "invalid_request",
  "artifact_preimage_invalid",
  "artifact_preimage_mismatch",
  "pin_digest_mismatch",
  "source_generation_mismatch",
  "incomplete_evidence",
  "unauthorized_source",
  "untrusted_verified_fact",
  "idempotency_conflict",
  "evidence_pin_immutable",
  "pinned_page_generation_retained",
] as const;
export type EvidencePinPersistenceFailure = (typeof EVIDENCE_PIN_PERSISTENCE_FAILURES)[number];

/** Audit metadata may carry only these keys. Values are ids and digests. */
export const EVIDENCE_PIN_AUDIT_METADATA_KEYS = [
  "outcome",
  "pinId",
  "requestId",
  "hiveId",
  "packDigest",
  "planDigest",
  "extractionDigest",
  "binderDigest",
  "evidenceDigest",
  "sourceGenerationsDigest",
  "chainHeadId",
  "sequence",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;
const RECEIPT_KEYS = [
  "schema",
  "outcome",
  "hiveId",
  "requestId",
  "pinId",
  "packDigest",
  "planDigest",
  "extractionDigest",
  "binderDigest",
  "evidenceDigest",
  "sourceGenerationsDigest",
  "chainHead",
] as const;
const PRIVATE_RECEIPT_KEYS = [
  "verified",
  "unresolved",
  "quote",
  "quotes",
  "quotation",
  "quotations",
  "pageText",
  "page_text",
  "text",
  "canonicalJson",
  "canonical_json",
  "sourceGenerations",
  "preimage",
] as const;

export type RelationshipVerificationChainHead = {
  readonly schema: typeof RELATIONSHIP_VERIFICATION_CHAIN_HEAD_SCHEMA;
  readonly sequence: 0;
  readonly causalParentId: null;
  readonly hiveId: string;
  readonly pinId: string;
  readonly packDigest: string;
  readonly planDigest: string;
  readonly evidenceRevision: {
    readonly extractionDigest: string;
    readonly binderDigest: string;
    readonly evidenceDigest: string;
  };
};

export type InvestigationEvidencePinWrite = {
  readonly hiveId: string;
  readonly requestId: string;
  readonly pinCanonicalJson: string;
  readonly packCanonicalJson: string;
  readonly planCanonicalJson: string;
};

export type InvestigationEvidencePinReceipt = {
  readonly schema: typeof INVESTIGATION_EVIDENCE_PIN_RECEIPT_SCHEMA;
  readonly outcome: EvidencePinPersistenceOutcome;
  readonly hiveId: string;
  readonly requestId: string;
  readonly pinId: string;
  readonly packDigest: string;
  readonly planDigest: string;
  readonly extractionDigest: string;
  readonly binderDigest: string;
  readonly evidenceDigest: string;
  readonly sourceGenerationsDigest: string;
  readonly chainHead: {
    readonly sequence: 0;
    readonly recordId: string;
    readonly causalParentId: null;
  };
};

export type InvestigationEvidencePinWriteResult =
  | {
      ok: true;
      write: InvestigationEvidencePinWrite;
      chainHead: RelationshipVerificationChainHead;
      chainHeadId: string;
    }
  | { ok: false; code: EvidencePinPersistenceFailure };

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fail(code: EvidencePinPersistenceFailure): InvestigationEvidencePinWriteResult {
  return { ok: false, code };
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  const present = Object.keys(value);
  return present.length === allowed.size && present.every((key) => allowed.has(key));
}

/** Canonical preimage of one pin, excluding pinId. The pin id is the digest of this text. */
export function investigationEvidencePinCanonicalJson(pin: InvestigationEvidencePin): string {
  const body = {
    schema: pin.schema,
    artifacts: pin.artifacts,
    extractionDigest: pin.extractionDigest,
    binderDigest: pin.binderDigest,
    evidenceDigest: pin.evidenceDigest,
    sourceGenerationsDigest: pin.sourceGenerationsDigest,
    verified: pin.verified,
    unresolved: pin.unresolved,
    sourceGenerations: pin.sourceGenerations,
  };
  return canonicalPackJson(body);
}

/**
 * Sequence-zero chain head for one stored pin.
 * recordId is the digest of this body. The body has no quotations and no decision.
 */
export function relationshipVerificationChainHead(input: {
  hiveId: string;
  pinId: string;
  packDigest: string;
  planDigest: string;
  extractionDigest: string;
  binderDigest: string;
  evidenceDigest: string;
}): RelationshipVerificationChainHead {
  return {
    schema: RELATIONSHIP_VERIFICATION_CHAIN_HEAD_SCHEMA,
    sequence: 0,
    causalParentId: null,
    hiveId: input.hiveId,
    pinId: input.pinId,
    packDigest: input.packDigest,
    planDigest: input.planDigest,
    evidenceRevision: {
      extractionDigest: input.extractionDigest,
      binderDigest: input.binderDigest,
      evidenceDigest: input.evidenceDigest,
    },
  };
}

export function relationshipVerificationChainHeadCanonicalJson(head: RelationshipVerificationChainHead): string {
  return canonicalPackJson(head);
}

export function relationshipVerificationChainHeadId(head: RelationshipVerificationChainHead): string {
  return packDigest(head);
}

/**
 * Safe audit metadata for a pin write. Page text, quotations, verified facts,
 * and unresolved candidates are not copied.
 */
export function investigationEvidencePinAuditMetadata(input: {
  outcome: EvidencePinPersistenceOutcome;
  hiveId: string;
  requestId: string;
  pin: Pick<
    InvestigationEvidencePin,
    "pinId" | "artifacts" | "extractionDigest" | "binderDigest" | "evidenceDigest" | "sourceGenerationsDigest"
  >;
  chainHeadId: string;
}): Record<(typeof EVIDENCE_PIN_AUDIT_METADATA_KEYS)[number], string | number> {
  return {
    outcome: input.outcome,
    pinId: input.pin.pinId,
    requestId: input.requestId,
    hiveId: input.hiveId,
    packDigest: input.pin.artifacts.pack.digest,
    planDigest: input.pin.artifacts.plan.digest,
    extractionDigest: input.pin.extractionDigest,
    binderDigest: input.pin.binderDigest,
    evidenceDigest: input.pin.evidenceDigest,
    sourceGenerationsDigest: input.pin.sourceGenerationsDigest,
    chainHeadId: input.chainHeadId,
    sequence: 0,
  };
}

function preimageDigest(canonicalJson: string, schema: string, refuseDigestKey: (parsed: Record<string, unknown>) => boolean): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalJson) as unknown;
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.schema !== schema) return null;
  if (canonicalPackJson(parsed) !== canonicalJson) return null;
  if (refuseDigestKey(parsed)) return null;
  return sha256Utf8(canonicalJson);
}

/**
 * Build the RPC payload for a pin the preparer already accepted.
 * A digest that does not match its canonical preimage produces no payload.
 */
export function investigationEvidencePinWrite(input: {
  hiveId: string;
  requestId: string;
  pin: InvestigationEvidencePin;
  packCanonicalJson: string;
  planCanonicalJson: string;
}): InvestigationEvidencePinWriteResult {
  if (!UUID_RE.test(input.hiveId) || !UUID_RE.test(input.requestId)) return fail("invalid_request");
  const hiveId = input.hiveId.toLowerCase();
  const requestId = input.requestId.toLowerCase();
  const pin = input.pin;
  if (!pin || pin.schema !== INVESTIGATION_EVIDENCE_PIN_SCHEMA) return fail("invalid_request");
  if (pin.verified.schema !== VERIFIED_CASE_FACTS_SCHEMA || pin.unresolved.schema !== UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA) {
    return fail("invalid_request");
  }
  if (pin.verified.relationships.length !== 0) return fail("invalid_request");
  if (!HEX_64.test(pin.pinId) || !HEX_64.test(pin.extractionDigest) || !HEX_64.test(pin.binderDigest) || !HEX_64.test(pin.evidenceDigest)) {
    return fail("pin_digest_mismatch");
  }
  if (!HEX_64.test(pin.sourceGenerationsDigest)) return fail("source_generation_mismatch");

  const packDigestHex = preimageDigest(input.packCanonicalJson, DOMAIN_PACK_RUNTIME_SCHEMA, (parsed) => {
    const identity = parsed.identity;
    return !isObject(identity) || Object.prototype.hasOwnProperty.call(identity, "digest");
  });
  if (!packDigestHex) return fail("artifact_preimage_invalid");
  const planDigestHex = preimageDigest(input.planCanonicalJson, DOMAIN_INVESTIGATION_PLAN_SCHEMA, (parsed) =>
    Object.prototype.hasOwnProperty.call(parsed, "digest"),
  );
  if (!planDigestHex) return fail("artifact_preimage_invalid");

  const pack = pin.artifacts.pack;
  const plan = pin.artifacts.plan;
  if (pack.retrieval !== EVIDENCE_PIN_ARTIFACT_RETRIEVAL || plan.retrieval !== EVIDENCE_PIN_ARTIFACT_RETRIEVAL) {
    return fail("artifact_preimage_invalid");
  }
  if (pack.schema !== DOMAIN_PACK_RUNTIME_SCHEMA || plan.schema !== DOMAIN_INVESTIGATION_PLAN_SCHEMA) {
    return fail("artifact_preimage_invalid");
  }
  if (pack.digest !== packDigestHex || plan.digest !== planDigestHex) return fail("artifact_preimage_mismatch");

  const pinCanonicalJson = investigationEvidencePinCanonicalJson(pin);
  if (sha256Utf8(pinCanonicalJson) !== pin.pinId) return fail("pin_digest_mismatch");
  if (packDigest(pin.sourceGenerations) !== pin.sourceGenerationsDigest) return fail("source_generation_mismatch");
  if (packDigest({ verified: pin.verified, unresolved: pin.unresolved }) !== pin.binderDigest) return fail("pin_digest_mismatch");
  if (investigationEvidenceDigest(pin.verified, pin.unresolved) !== pin.evidenceDigest) return fail("pin_digest_mismatch");

  const chainHead = relationshipVerificationChainHead({
    hiveId,
    pinId: pin.pinId,
    packDigest: pack.digest,
    planDigest: plan.digest,
    extractionDigest: pin.extractionDigest,
    binderDigest: pin.binderDigest,
    evidenceDigest: pin.evidenceDigest,
  });
  return {
    ok: true,
    write: {
      hiveId,
      requestId,
      pinCanonicalJson,
      packCanonicalJson: input.packCanonicalJson,
      planCanonicalJson: input.planCanonicalJson,
    },
    chainHead,
    chainHeadId: relationshipVerificationChainHeadId(chainHead),
  };
}

/** Parse a pin-creation receipt. Extra fields and private evidence keys are rejected. */
export function parseInvestigationEvidencePinReceipt(value: unknown): InvestigationEvidencePinReceipt | null {
  if (!isObject(value) || !exactKeys(value, RECEIPT_KEYS)) return null;
  if (PRIVATE_RECEIPT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return null;
  if (value.schema !== INVESTIGATION_EVIDENCE_PIN_RECEIPT_SCHEMA) return null;
  if (!EVIDENCE_PIN_PERSISTENCE_OUTCOMES.includes(value.outcome as EvidencePinPersistenceOutcome)) return null;
  if (typeof value.hiveId !== "string" || !UUID_RE.test(value.hiveId)) return null;
  if (typeof value.requestId !== "string" || !UUID_RE.test(value.requestId)) return null;
  const digests = [
    value.pinId,
    value.packDigest,
    value.planDigest,
    value.extractionDigest,
    value.binderDigest,
    value.evidenceDigest,
    value.sourceGenerationsDigest,
  ];
  if (!digests.every((item) => typeof item === "string" && HEX_64.test(item))) return null;
  if (!isObject(value.chainHead)) return null;
  const head = value.chainHead;
  if (!exactKeys(head, ["sequence", "recordId", "causalParentId"])) return null;
  if (head.sequence !== 0 || head.causalParentId !== null) return null;
  if (typeof head.recordId !== "string" || !HEX_64.test(head.recordId)) return null;
  return {
    schema: INVESTIGATION_EVIDENCE_PIN_RECEIPT_SCHEMA,
    outcome: value.outcome as EvidencePinPersistenceOutcome,
    hiveId: value.hiveId.toLowerCase(),
    requestId: value.requestId.toLowerCase(),
    pinId: value.pinId as string,
    packDigest: value.packDigest as string,
    planDigest: value.planDigest as string,
    extractionDigest: value.extractionDigest as string,
    binderDigest: value.binderDigest as string,
    evidenceDigest: value.evidenceDigest as string,
    sourceGenerationsDigest: value.sourceGenerationsDigest as string,
    chainHead: { sequence: 0, recordId: head.recordId as string, causalParentId: null },
  };
}
