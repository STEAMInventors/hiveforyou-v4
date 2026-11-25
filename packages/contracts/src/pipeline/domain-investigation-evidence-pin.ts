/**
 * Offline preparation of hive.investigation-evidence-pin/1.
 *
 * prepareInvestigationEvidencePin is the pure function a future
 * writeInvestigationEvidencePin service must call before any insert.
 * It runs the existing evidence binder and accepts only that binder's
 * validated verified facts and unresolved candidates. It does not persist,
 * authorize, call a model, or decide a relationship.
 *
 * Pack and plan addresses are content digests of the canonical compiler
 * preimage. Retrieval is that digest. A filesystem path is not an address.
 * The success result carries those preimage bytes so the future writer can
 * store them under the digest. The pin itself stores the reference only.
 */
import { canonicalPackJson, packDigest } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  bindInvestigationCandidates,
  INVESTIGATION_CANDIDATES_SCHEMA,
  UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
  type CandidateEvidence,
  type UnresolvedCandidates,
} from "./domain-investigation-binder";
import {
  DOMAIN_INVESTIGATION_PLAN_SCHEMA,
  type DomainInvestigationPlan,
} from "./domain-investigation-plan";
import { investigationEvidenceDigest } from "./domain-investigation-ledger";
import {
  VERIFIED_CASE_FACTS_SCHEMA,
  type VerifiedCaseFacts,
  type VerifiedSourceRef,
} from "./domain-pack-rules";
import {
  DOMAIN_PACK_RUNTIME_SCHEMA,
  type CompiledDomainPack,
} from "./domain-pack-source";
import { DOC_EXTRACTION_SCHEMA, type DocExtraction } from "./extraction-contracts";
import {
  computePageSetDigest,
  computeReadFingerprint,
  computeSha256Digest,
  normalizeContentDigest,
  normalizeFileSha256,
} from "../source-documents/document-read-contracts";

export const INVESTIGATION_EVIDENCE_PIN_SCHEMA = "hive.investigation-evidence-pin/1" as const;
export const EVIDENCE_PIN_ARTIFACT_RETRIEVAL = "CONTENT_DIGEST" as const;

export const EVIDENCE_PIN_FAILURES = [
  "MISSING_INVESTIGATION",
  "INVALID_INVESTIGATION",
  "INVESTIGATION_FAILED",
  "PACK_DIGEST_MISMATCH",
  "PLAN_DIGEST_MISMATCH",
  "PACK_PLAN_MISMATCH",
  "EXTRACTION_DIGEST_MISMATCH",
  "BINDER_DIGEST_MISMATCH",
  "EVIDENCE_DIGEST_MISMATCH",
  "SOURCE_GENERATION_MISMATCH",
  "PAGE_GENERATION_MISMATCH",
  "UNAUTHORIZED_SOURCE",
  "MISSING_REFERENCED_EVIDENCE",
  "INVALID_BINDING",
] as const;
export type EvidencePinFailureCode = (typeof EVIDENCE_PIN_FAILURES)[number];

const ENVELOPE_KEYS = ["schema", "planDigest", "packDigest", "extractionDigest", "candidates"] as const;
const REFUSED_ADDRESS_KEYS = ["path", "storagePath", "filePath", "filesystemPath", "uri", "location"] as const;
const HEX_64 = /^[0-9a-f]{64}$/;

export type SourceGenerationPage = {
  pageNumber: number;
  text: string;
  pageTextSha256: string;
};

/**
 * One authorized read generation. Page text is an input so the pin can bind
 * each page hash to those exact bytes. Page text is not copied into the pin.
 * readOptions and readerContractVersion are used only to recompute readFingerprint.
 */
export type SourcePageGeneration = {
  sourceDocumentId: string;
  sourceSha256: string;
  readFingerprint: string;
  pageSetDigest: string;
  readOptions?: Readonly<Record<string, unknown>> | null;
  readerContractVersion?: string;
  pages: readonly SourceGenerationPage[];
};

export type EvidencePinPackRef = {
  readonly retrieval: typeof EVIDENCE_PIN_ARTIFACT_RETRIEVAL;
  readonly schema: typeof DOMAIN_PACK_RUNTIME_SCHEMA;
  readonly packId: string;
  readonly version: string;
  readonly digest: string;
};

export type EvidencePinPlanRef = {
  readonly retrieval: typeof EVIDENCE_PIN_ARTIFACT_RETRIEVAL;
  readonly schema: typeof DOMAIN_INVESTIGATION_PLAN_SCHEMA;
  readonly digest: string;
};

export type EvidencePinSourcePage = {
  readonly pageNumber: number;
  readonly pageTextSha256: string;
};

export type EvidencePinSourceGeneration = {
  readonly sourceDocumentId: string;
  readonly sourceSha256: string;
  readonly readFingerprint: string;
  readonly pageSetDigest: string;
  readonly pageCount: number;
  readonly pages: readonly EvidencePinSourcePage[];
};

export type InvestigationEvidencePin = {
  readonly schema: typeof INVESTIGATION_EVIDENCE_PIN_SCHEMA;
  readonly pinId: string;
  readonly artifacts: {
    readonly pack: EvidencePinPackRef;
    readonly plan: EvidencePinPlanRef;
  };
  readonly extractionDigest: string;
  readonly binderDigest: string;
  readonly evidenceDigest: string;
  readonly sourceGenerationsDigest: string;
  readonly verified: VerifiedCaseFacts;
  readonly unresolved: UnresolvedCandidates;
  readonly sourceGenerations: readonly EvidencePinSourceGeneration[];
};

/** Canonical preimage that hashes to digest. The future store retrieves it by that digest. */
export type ContentAddressedArtifact = {
  readonly retrieval: typeof EVIDENCE_PIN_ARTIFACT_RETRIEVAL;
  readonly digest: string;
  readonly canonicalJson: string;
};

export type PreparedPackArtifact = ContentAddressedArtifact & {
  readonly schema: typeof DOMAIN_PACK_RUNTIME_SCHEMA;
  readonly packId: string;
  readonly version: string;
};

export type PreparedPlanArtifact = ContentAddressedArtifact & {
  readonly schema: typeof DOMAIN_INVESTIGATION_PLAN_SCHEMA;
};

export type PrepareInvestigationEvidencePinInput = {
  pack: CompiledDomainPack;
  plan: DomainInvestigationPlan;
  extractions: readonly DocExtraction[];
  sourceGenerations: readonly SourcePageGeneration[];
  /** hive.investigation-candidates/1. Null or omitted is a missing investigation. */
  candidates: unknown;
};

export type PrepareInvestigationEvidencePinResult =
  | {
      ok: true;
      pin: InvestigationEvidencePin;
      retrieval: {
        pack: PreparedPackArtifact;
        plan: PreparedPlanArtifact;
      };
    }
  | { ok: false; code: EvidencePinFailureCode; path: string };

type ObjectMap = Record<string, unknown>;
type PinFailure = { ok: false; code: EvidencePinFailureCode; path: string };
type BoundGeneration = {
  sourceDocumentId: string;
  sourceSha256: string;
  readFingerprint: string;
  pageSetDigest: string;
  pages: readonly { pageNumber: number; text: string; pageTextSha256: string }[];
};

const isObject = (value: unknown): boolean => !!value && typeof value === "object" && !Array.isArray(value);

function fail(code: EvidencePinFailureCode, path: string): PinFailure {
  return { ok: false, code, path };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as object)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function mutableAddressKey(value: object): string | null {
  for (const key of REFUSED_ADDRESS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return key;
  }
  return null;
}

/** Digest preimage of a compiled pack: the compiler snapshot with identity.digest removed. */
export function compiledPackArtifact(pack: CompiledDomainPack): { digest: string; canonicalJson: string } {
  const { digest: _storedDigest, ...identity } = pack.identity;
  void _storedDigest;
  const material = { ...pack, identity };
  return { digest: packDigest(material), canonicalJson: canonicalPackJson(material) };
}

/** Digest preimage of a compiled plan: the plan with its digest field removed. */
export function investigationPlanArtifact(plan: DomainInvestigationPlan): { digest: string; canonicalJson: string } {
  const { digest: _storedDigest, ...material } = plan;
  void _storedDigest;
  return { digest: packDigest(material), canonicalJson: canonicalPackJson(material) };
}

function pageNumberOf(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : null;
}

function validatePack(pack: CompiledDomainPack): { ok: true; pack: CompiledDomainPack; artifact: PreparedPackArtifact } | PinFailure {
  if (!isObject(pack) || pack.schema !== DOMAIN_PACK_RUNTIME_SCHEMA || !isObject(pack.identity)) {
    return fail("INVALID_BINDING", "$.pack");
  }
  const identity = pack.identity;
  if (typeof identity.packId !== "string" || identity.packId.length === 0 || typeof identity.version !== "string" || identity.version.length === 0) {
    return fail("INVALID_BINDING", "$.pack.identity");
  }
  if (typeof identity.digest !== "string" || !HEX_64.test(identity.digest)) {
    return fail("INVALID_BINDING", "$.pack.identity.digest");
  }
  const artifact = compiledPackArtifact(pack);
  if (artifact.digest !== identity.digest) return fail("PACK_DIGEST_MISMATCH", "$.pack.identity.digest");
  return {
    ok: true,
    pack,
    artifact: {
      retrieval: EVIDENCE_PIN_ARTIFACT_RETRIEVAL,
      schema: DOMAIN_PACK_RUNTIME_SCHEMA,
      packId: identity.packId,
      version: identity.version,
      digest: artifact.digest,
      canonicalJson: artifact.canonicalJson,
    },
  };
}

function validatePlan(
  plan: DomainInvestigationPlan,
  pack: CompiledDomainPack,
): { ok: true; plan: DomainInvestigationPlan; artifact: PreparedPlanArtifact } | PinFailure {
  if (!isObject(plan) || plan.schema !== DOMAIN_INVESTIGATION_PLAN_SCHEMA) return fail("INVALID_BINDING", "$.plan");
  if (typeof plan.digest !== "string" || !HEX_64.test(plan.digest)) return fail("INVALID_BINDING", "$.plan.digest");
  const artifact = investigationPlanArtifact(plan);
  if (artifact.digest !== plan.digest) return fail("PLAN_DIGEST_MISMATCH", "$.plan.digest");
  const pinned = plan.pack;
  if (!isObject(pinned)) return fail("INVALID_BINDING", "$.plan.pack");
  if (pinned.digest !== pack.identity.digest || pinned.packId !== pack.identity.packId || pinned.version !== pack.identity.version) {
    return fail("PACK_PLAN_MISMATCH", "$.plan.pack");
  }
  return {
    ok: true,
    plan,
    artifact: {
      retrieval: EVIDENCE_PIN_ARTIFACT_RETRIEVAL,
      schema: DOMAIN_INVESTIGATION_PLAN_SCHEMA,
      digest: artifact.digest,
      canonicalJson: artifact.canonicalJson,
    },
  };
}

function validateGenerations(
  generations: readonly SourcePageGeneration[],
): { ok: true; generations: readonly BoundGeneration[] } | PinFailure {
  if (!Array.isArray(generations)) return fail("INVALID_BINDING", "$.sourceGenerations");
  const seen = new Set<string>();
  const bound: BoundGeneration[] = [];
  for (let index = 0; index < generations.length; index += 1) {
    const path = "$.sourceGenerations[" + index + "]";
    const generation = generations[index];
    if (!isObject(generation)) return fail("INVALID_BINDING", path);
    const addressKey = mutableAddressKey(generation);
    if (addressKey) return fail("INVALID_BINDING", path + "." + addressKey);
    if (typeof generation.sourceDocumentId !== "string" || generation.sourceDocumentId.length === 0) {
      return fail("INVALID_BINDING", path + ".sourceDocumentId");
    }
    if (seen.has(generation.sourceDocumentId)) return fail("INVALID_BINDING", path + ".sourceDocumentId");
    seen.add(generation.sourceDocumentId);
    const sourceSha256 = normalizeFileSha256(generation.sourceSha256);
    if (!sourceSha256) return fail("INVALID_BINDING", path + ".sourceSha256");
    if (!Array.isArray(generation.pages) || generation.pages.length === 0) return fail("INVALID_BINDING", path + ".pages");
    const pages: { pageNumber: number; text: string; pageTextSha256: string }[] = [];
    const pageNumbers = new Set<number>();
    for (let pageIndex = 0; pageIndex < generation.pages.length; pageIndex += 1) {
      const pagePath = path + ".pages[" + pageIndex + "]";
      const page = generation.pages[pageIndex];
      if (!isObject(page)) return fail("INVALID_BINDING", pagePath);
      const pageAddress = mutableAddressKey(page);
      if (pageAddress) return fail("INVALID_BINDING", pagePath + "." + pageAddress);
      if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1 || typeof page.text !== "string") {
        return fail("INVALID_BINDING", pagePath);
      }
      if (pageNumbers.has(page.pageNumber)) return fail("INVALID_BINDING", pagePath + ".pageNumber");
      pageNumbers.add(page.pageNumber);
      const declaredPageHash = normalizeContentDigest(page.pageTextSha256);
      const actualPageHash = computeSha256Digest(page.text);
      if (!declaredPageHash) return fail("INVALID_BINDING", pagePath + ".pageTextSha256");
      if (declaredPageHash !== actualPageHash) return fail("PAGE_GENERATION_MISMATCH", pagePath + ".pageTextSha256");
      pages.push({ pageNumber: page.pageNumber, text: page.text, pageTextSha256: actualPageHash });
    }
    const pageSetDigest = computePageSetDigest({
      sourceSha256,
      pageCount: pages.length,
      pages: pages.map((page) => ({ pageNumber: page.pageNumber, textSha256: page.pageTextSha256 })),
    });
    const declaredPageSet = normalizeContentDigest(generation.pageSetDigest);
    if (!declaredPageSet) return fail("INVALID_BINDING", path + ".pageSetDigest");
    if (declaredPageSet !== pageSetDigest) return fail("SOURCE_GENERATION_MISMATCH", path + ".pageSetDigest");
    let readFingerprint: string;
    try {
      readFingerprint = computeReadFingerprint({
        sourceSha256,
        options: generation.readOptions ?? null,
        contractVersion: generation.readerContractVersion,
      });
    } catch {
      return fail("INVALID_BINDING", path + ".readOptions");
    }
    if (typeof generation.readFingerprint !== "string" || generation.readFingerprint.trim().toLowerCase() !== readFingerprint) {
      return fail("SOURCE_GENERATION_MISMATCH", path + ".readFingerprint");
    }
    bound.push({
      sourceDocumentId: generation.sourceDocumentId,
      sourceSha256,
      readFingerprint,
      pageSetDigest,
      pages: [...pages].sort((left, right) => left.pageNumber - right.pageNumber),
    });
  }
  bound.sort((left, right) => left.sourceDocumentId.localeCompare(right.sourceDocumentId));
  return { ok: true, generations: bound };
}

function validateExtractions(
  extractions: readonly DocExtraction[],
  generations: readonly BoundGeneration[],
): { ok: true; extractions: readonly DocExtraction[] } | PinFailure {
  if (!Array.isArray(extractions)) return fail("INVALID_BINDING", "$.extractions");
  const pagesOf = new Map(generations.map((generation) => [generation.sourceDocumentId, new Set(generation.pages.map((page) => page.pageNumber))]));
  const seen = new Set<string>();
  for (let index = 0; index < extractions.length; index += 1) {
    const path = "$.extractions[" + index + "]";
    const extraction = extractions[index];
    if (!isObject(extraction) || extraction.schema !== DOC_EXTRACTION_SCHEMA) return fail("INVALID_BINDING", path);
    if (typeof extraction.documentId !== "string" || extraction.documentId.length === 0) {
      return fail("INVALID_BINDING", path + ".documentId");
    }
    if (seen.has(extraction.documentId)) return fail("INVALID_BINDING", path + ".documentId");
    seen.add(extraction.documentId);
    const pages = pagesOf.get(extraction.documentId);
    if (!pages) return fail("UNAUTHORIZED_SOURCE", path + ".documentId");
    if (!Array.isArray(extraction.facts)) return fail("INVALID_BINDING", path + ".facts");
    for (let factIndex = 0; factIndex < extraction.facts.length; factIndex += 1) {
      const fact = extraction.facts[factIndex];
      const factPath = path + ".facts[" + factIndex + "]";
      if (!isObject(fact) || typeof fact.id !== "string" || fact.id.length === 0) return fail("INVALID_BINDING", factPath);
      if (!Array.isArray(fact.evidence) || fact.evidence.length === 0) {
        return fail("MISSING_REFERENCED_EVIDENCE", factPath + ".evidence");
      }
      for (let evidenceIndex = 0; evidenceIndex < fact.evidence.length; evidenceIndex += 1) {
        const evidence = fact.evidence[evidenceIndex];
        const evidencePath = factPath + ".evidence[" + evidenceIndex + "]";
        if (!isObject(evidence) || !Number.isInteger(evidence.page) || evidence.page < 1) {
          return fail("MISSING_REFERENCED_EVIDENCE", evidencePath);
        }
        if (!pages.has(evidence.page)) return fail("MISSING_REFERENCED_EVIDENCE", evidencePath + ".page");
      }
    }
  }
  return { ok: true, extractions };
}

function validateEnvelope(
  candidates: unknown,
  plan: DomainInvestigationPlan,
  pack: CompiledDomainPack,
  extractions: readonly DocExtraction[],
): { ok: true; envelope: ObjectMap; candidateCount: number } | PinFailure {
  if (!isObject(candidates)) return fail("INVALID_INVESTIGATION", "$.candidates");
  const record = candidates as ObjectMap;
  const keys = Object.keys(record);
  if (keys.length !== ENVELOPE_KEYS.length || !ENVELOPE_KEYS.every((key) => keys.includes(key))) {
    return fail("INVALID_INVESTIGATION", "$.candidates");
  }
  if (record.schema !== INVESTIGATION_CANDIDATES_SCHEMA) return fail("INVALID_INVESTIGATION", "$.candidates.schema");
  if (!Array.isArray(record.candidates)) return fail("INVALID_INVESTIGATION", "$.candidates.candidates");
  if (typeof record.packDigest !== "string" || record.packDigest !== pack.identity.digest) {
    return fail("PACK_DIGEST_MISMATCH", "$.candidates.packDigest");
  }
  if (typeof record.planDigest !== "string" || record.planDigest !== plan.digest) {
    return fail("PLAN_DIGEST_MISMATCH", "$.candidates.planDigest");
  }
  if (typeof record.extractionDigest !== "string" || record.extractionDigest !== authorizedExtractionDigest(extractions)) {
    return fail("EXTRACTION_DIGEST_MISMATCH", "$.candidates.extractionDigest");
  }
  return { ok: true, envelope: record, candidateCount: record.candidates.length };
}

function canonicalGenerations(generations: readonly BoundGeneration[]): EvidencePinSourceGeneration[] {
  return generations.map((generation) => ({
    sourceDocumentId: generation.sourceDocumentId,
    sourceSha256: generation.sourceSha256,
    readFingerprint: generation.readFingerprint,
    pageSetDigest: generation.pageSetDigest,
    pageCount: generation.pages.length,
    pages: generation.pages.map((page) => ({ pageNumber: page.pageNumber, pageTextSha256: page.pageTextSha256 })),
  }));
}

function resolvePage(
  pagesOf: ReadonlyMap<string, ReadonlySet<number>>,
  documentId: string,
  page: number,
): PinFailure | null {
  const pages = pagesOf.get(documentId);
  if (!pages) return fail("UNAUTHORIZED_SOURCE", "$.sourceGenerations");
  if (!pages.has(page)) return fail("MISSING_REFERENCED_EVIDENCE", "$.sourceGenerations");
  return null;
}

function checkSourceRef(
  ref: VerifiedSourceRef,
  pagesOf: ReadonlyMap<string, ReadonlySet<number>>,
  factsOf: ReadonlyMap<string, ReadonlySet<string>>,
  path: string,
  requireExcerpt: boolean,
): PinFailure | null {
  if (typeof ref.documentId !== "string" || ref.documentId.length === 0) return fail("MISSING_REFERENCED_EVIDENCE", path);
  const page = pageNumberOf(ref.page);
  if (page === null) return fail("MISSING_REFERENCED_EVIDENCE", path + ".page");
  const bound = resolvePage(pagesOf, ref.documentId, page);
  if (bound) return { ...bound, path };
  if (requireExcerpt) {
    if (typeof ref.excerptId !== "string" || ref.excerptId.length === 0) return fail("MISSING_REFERENCED_EVIDENCE", path + ".excerptId");
    if (!factsOf.get(ref.documentId)?.has(ref.excerptId)) return fail("MISSING_REFERENCED_EVIDENCE", path + ".excerptId");
  }
  return null;
}

function checkEvidence(
  evidence: readonly CandidateEvidence[],
  pagesOf: ReadonlyMap<string, ReadonlySet<number>>,
  path: string,
): PinFailure | null {
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    if (!item || typeof item.sourceDocumentId !== "string" || !Number.isInteger(item.page)) {
      return fail("MISSING_REFERENCED_EVIDENCE", path + "[" + index + "]");
    }
    const bound = resolvePage(pagesOf, item.sourceDocumentId, item.page);
    if (bound) return { ...bound, path: path + "[" + index + "]" };
  }
  return null;
}

function validateBoundOutput(
  verified: VerifiedCaseFacts,
  unresolved: UnresolvedCandidates,
  generations: readonly BoundGeneration[],
  extractions: readonly DocExtraction[],
  candidateCount: number,
): PinFailure | null {
  if (verified.schema !== VERIFIED_CASE_FACTS_SCHEMA || unresolved.schema !== UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA) {
    return fail("INVALID_BINDING", "$.verified");
  }
  if (verified.relationships.length !== 0) return fail("INVALID_BINDING", "$.verified.relationships");
  if (candidateCount === 0) {
    if (verified.coverage !== "INCOMPLETE" || verified.facts.length !== 0 || verified.documents.length !== 0 || unresolved.candidates.length !== 0) {
      return fail("INVALID_BINDING", "$.verified.coverage");
    }
  }
  const pagesOf = new Map(generations.map((generation) => [generation.sourceDocumentId, new Set(generation.pages.map((page) => page.pageNumber))]));
  const factsOf = new Map(extractions.map((extraction) => [extraction.documentId, new Set(extraction.facts.map((fact) => fact.id))]));
  for (const fact of verified.facts) {
    if (fact.status !== "VERIFIED" || fact.sourceRefs.length === 0) return fail("MISSING_REFERENCED_EVIDENCE", "$.verified.facts");
    for (const ref of fact.sourceRefs) {
      const issue = checkSourceRef(ref, pagesOf, factsOf, "$.verified.facts", true);
      if (issue) return issue;
    }
  }
  for (const document of verified.documents) {
    if (document.status !== "VERIFIED" || document.sourceRefs.length === 0) return fail("MISSING_REFERENCED_EVIDENCE", "$.verified.documents");
    for (const ref of document.sourceRefs) {
      const issue = checkSourceRef(ref, pagesOf, factsOf, "$.verified.documents", true);
      if (issue) return issue;
    }
  }
  for (const candidate of unresolved.candidates) {
    if (candidate.reasons.includes("UNAUTHORIZED_DOCUMENT")) {
      return fail("UNAUTHORIZED_SOURCE", "$.unresolved.candidates." + candidate.candidateId);
    }
    const evidenceIssue = checkEvidence(candidate.evidence, pagesOf, "$.unresolved.candidates." + candidate.candidateId + ".evidence");
    if (evidenceIssue) return evidenceIssue;
    for (const ref of candidate.sourceRefs) {
      const issue = checkSourceRef(ref, pagesOf, factsOf, "$.unresolved.candidates." + candidate.candidateId + ".sourceRefs", false);
      if (issue) return issue;
    }
  }
  return null;
}

/**
 * Prepare one immutable evidence pin from a compiled pack, a pinned plan,
 * authorized extractions, source-page generations, and one candidate envelope.
 * A completed envelope with zero candidates is pinned with incomplete coverage.
 * A missing, failed, or invalid investigation produces no pin.
 */
export function prepareInvestigationEvidencePin(input: PrepareInvestigationEvidencePinInput): PrepareInvestigationEvidencePinResult {
  if (!input || input.candidates == null) return fail("MISSING_INVESTIGATION", "$.candidates");
  const packResult = validatePack(input.pack);
  if (!packResult.ok) return packResult;
  const planResult = validatePlan(input.plan, packResult.pack);
  if (!planResult.ok) return planResult;
  const generationResult = validateGenerations(input.sourceGenerations);
  if (!generationResult.ok) return generationResult;
  const extractionResult = validateExtractions(input.extractions, generationResult.generations);
  if (!extractionResult.ok) return extractionResult;
  const envelopeResult = validateEnvelope(input.candidates, planResult.plan, packResult.pack, extractionResult.extractions);
  if (!envelopeResult.ok) return envelopeResult;

  const bound = bindInvestigationCandidates({
    pack: packResult.pack,
    plan: planResult.plan,
    extractions: extractionResult.extractions,
    documents: generationResult.generations.map((generation) => ({
      documentId: generation.sourceDocumentId,
      pages: generation.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
    })),
    candidates: envelopeResult.envelope,
  });
  if (!bound.ok) return fail("INVESTIGATION_FAILED", "$.candidates");

  const binderDigest = packDigest({ verified: bound.verified, unresolved: bound.unresolved });
  if (binderDigest !== bound.digest) return fail("BINDER_DIGEST_MISMATCH", "$.binderDigest");
  const evidenceDigest = investigationEvidenceDigest(bound.verified, bound.unresolved);
  const evidenceDigestAgain = investigationEvidenceDigest(
    {
      ...bound.verified,
      facts: [...bound.verified.facts].reverse(),
      documents: [...bound.verified.documents].reverse(),
      relationships: [...bound.verified.relationships],
      conflicts: [...bound.verified.conflicts].reverse(),
    },
    { ...bound.unresolved, candidates: [...bound.unresolved.candidates].reverse() },
  );
  if (!HEX_64.test(evidenceDigest) || evidenceDigest !== evidenceDigestAgain) {
    return fail("EVIDENCE_DIGEST_MISMATCH", "$.evidenceDigest");
  }
  const outputIssue = validateBoundOutput(
    bound.verified,
    bound.unresolved,
    generationResult.generations,
    extractionResult.extractions,
    envelopeResult.candidateCount,
  );
  if (outputIssue) return outputIssue;

  const sourceGenerations = canonicalGenerations(generationResult.generations);
  const sourceGenerationsDigest = packDigest(sourceGenerations);
  const extractionDigest = authorizedExtractionDigest(extractionResult.extractions);
  const body = {
    schema: INVESTIGATION_EVIDENCE_PIN_SCHEMA,
    artifacts: {
      pack: {
        retrieval: EVIDENCE_PIN_ARTIFACT_RETRIEVAL,
        schema: DOMAIN_PACK_RUNTIME_SCHEMA,
        packId: packResult.artifact.packId,
        version: packResult.artifact.version,
        digest: packResult.artifact.digest,
      },
      plan: {
        retrieval: EVIDENCE_PIN_ARTIFACT_RETRIEVAL,
        schema: DOMAIN_INVESTIGATION_PLAN_SCHEMA,
        digest: planResult.artifact.digest,
      },
    },
    extractionDigest,
    binderDigest,
    evidenceDigest,
    sourceGenerationsDigest,
    verified: bound.verified,
    unresolved: bound.unresolved,
    sourceGenerations,
  };
  const pin = freezeDeep({ ...body, pinId: packDigest(body) });
  return freezeDeep({
    ok: true as const,
    pin,
    retrieval: { pack: packResult.artifact, plan: planResult.artifact },
  });
}
