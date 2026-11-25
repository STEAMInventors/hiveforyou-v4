import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  bindInvestigationCandidates,
  INVESTIGATION_CANDIDATES_SCHEMA,
  type CandidateBinderInput,
  type UnresolvedCandidate,
} from "./domain-investigation-binder";
import { buildCoverageLedger, investigationEvidenceDigest } from "./domain-investigation-ledger";
import { compileInvestigationPlan, type SupplementalArtifacts } from "./domain-investigation-plan";
import { evaluateDomainRules, type DomainRuleResult } from "./domain-pack-rules";
import { DOMAIN_PACK_SOURCE_SCHEMA, type CompiledDomainPack, type DomainPackSource } from "./domain-pack-source";
import {
  assessRelationshipTypedSource,
  authoredRelationshipDirection,
  decideRelationshipVerification,
  relationshipCandidateContentDigest,
  relationshipExcerptId,
  relationshipStructureDigest,
  relationshipVerificationFactId,
  RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA,
  RELATIONSHIP_VERIFICATION_CONTEXT_SCHEMA,
  type RelationshipSourceStructure,
  type RelationshipVerificationDecision,
  type RelationshipVerificationRecord,
} from "./domain-relationship-verification";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import type { VerificationPage } from "./verify-quotes";

const DOC = "doc-1";
const WHEN = "2026-11-24T22:00:00.000Z";
const LATER = "2026-11-24T22:05:00.000Z";
const PAGE_1 = [
  "Name: North.",
  "Started 2024-01-02.",
  "Other name: South.",
  "Ended 2024-02-01.",
  "North authorizes the review of South.",
  "North does not authorize the review of South.",
  "North was present and South was present.",
  "North disputes the record about South.",
  "South authorizes the review of North.",
  "north->south North South.",
].join(" ");

function source(): DomainPackSource {
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "example-review", version: "1.0.0", title: "Example review" },
    ownership: { scope: "PRO", ownerId: "pro-1", authoredBy: "pro-1" },
    applicability: { jurisdiction: "unspecified", verification: "UNVERIFIED" },
    definitions: [
      { id: "entity:item", kind: "entity", label: "Item", fields: [{ id: "label", valueType: "TEXT" }, { id: "startDate", valueType: "DATE" }] },
      { id: "entity:other", kind: "entity", label: "Other", fields: [{ id: "name", valueType: "TEXT" }, { id: "when", valueType: "DATE" }] },
      { id: "relationship:item-other", kind: "relationship", label: "Item to other", fromEntityId: "entity:item", toEntityId: "entity:other", evidenceRequired: true },
      { id: "calculation:between", kind: "calculation", label: "Days between records", operator: "DAYS_BETWEEN", inputFields: ["startDate", "when"], state: "EXECUTABLE", bindings: [{ role: "start", entityId: "entity:item", fieldId: "startDate" }, { role: "end", entityId: "entity:other", fieldId: "when" }] },
    ],
    changes: [],
    review: { status: "DRAFT" },
  };
}

function companions(pack: CompiledDomainPack): SupplementalArtifacts {
  return {
    ontology: {
      schema: "hive.domain-ontology-spec/1",
      packRef: { packId: pack.identity.packId, version: pack.identity.version },
      entities: [
        { id: "entity:item", factClass: "RECORD", fields: [{ id: "label", valueType: "TEXT" }, { id: "startDate", valueType: "DATE" }], ruleIds: ["calculation:between"], documentKinds: [], instanceBoundary: "One record.", identityKeys: ["label"] },
        { id: "entity:other", factClass: "RECORD", fields: [{ id: "name", valueType: "TEXT" }, { id: "when", valueType: "DATE" }], ruleIds: [], documentKinds: [], identityKeys: ["name"] },
      ],
      relationships: [{ id: "relationship:item-other", fromEntityId: "entity:item", toEntityId: "entity:other", evidenceForLink: "The records name one another.", cardinality: "many" }],
      documents: [],
      calculations: [{ id: "calculation:between", join: { relationshipId: "relationship:item-other" } }],
    },
    authorityRegister: { schema: "hive.domain-authority-register/1", authorities: [], definitionAuthorityMap: {}, authorityRoles: {}, structuralDefinitions: {}, unusedAuthorityDisposition: {} },
    conflictPatterns: { schema: "hive.domain-conflict-pattern-spec/1", dp1Supported: false, patterns: [] },
    stateOverlays: { schema: "hive.domain-state-overlay-spec/1", dp1Supported: false, overlays: [] },
    factClasses: { schema: "hive.domain-fact-class-spec/1", dp1Supported: false, classes: ["RECORD"] },
    workflowCoverage: { schema: "hive.domain-workflow-coverage-spec/1", dp1Supported: false, rows: [] },
    unsupportedOperators: { schema: "hive.domain-unsupported-operator-spec/1", dp1Supported: false, operators: [{ id: "EVERY", status: "UNSUPPORTED", dp1Predicate: false }, { id: "EXISTS", status: "UNSUPPORTED", dp1Predicate: false }] },
  };
}

function fact(id: string, written: string, quote: string): ExtractionFact {
  return {
    id, modelId: id, category: "record", subject: "record", attribute: "value", value: written, valueAsWritten: written,
    unit: null, per: null, timeframe: { from: null, to: null, asWritten: null }, modality: "stated", attributedTo: null,
    aboutPersonRef: null, tableContext: null, evidence: [{ page: 1, printedPageLabel: null, quote }], confidence: "high",
  };
}

function world() {
  const compiled = compileDomainPack(source());
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  const pack = compiled.value;
  const artifacts = companions(pack);
  const digests = Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, packDigest(value)])) as Record<keyof SupplementalArtifacts, string>;
  const planned = compileInvestigationPlan({ pack, artifacts, digests });
  if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
  const plan = planned.value;
  const extractions = [extraction()];
  return { pack, plan, extractions };
}

function extraction(): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId: DOC,
    fileName: "record.txt",
    pageRange: null,
    document: { titleAsPrinted: "Record", documentType: "record", domain: { label: "review", confidence: null }, issuer: null, aboutPeople: [], keyDates: [], summary: "" },
    facts: [
      fact("F-label", "North", "Name: North."),
      fact("F-start", "2024-01-02", "Started 2024-01-02."),
      fact("F-name", "South", "Other name: South."),
      fact("F-when", "2024-02-01", "Ended 2024-02-01."),
    ],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
  };
}

function documents(): CandidateBinderInput["documents"] {
  return [{ documentId: DOC, pages: [{ pageNumber: 1, text: PAGE_1 }] satisfies VerificationPage[] }];
}

function taskId(plan: ReturnType<typeof world>["plan"], definitionId: string): string {
  const task = plan.tasks.find((item) => item.definitionId === definitionId);
  if (!task) throw new Error("missing task " + definitionId);
  return task.taskId;
}

function fields(plan: ReturnType<typeof world>["plan"]) {
  return [
    { candidateId: "c-label", taskId: taskId(plan, "entity:item"), kind: "FIELD", entityId: "entity:item", instanceId: "north", fieldId: "label", documentId: DOC, extractionFactId: "F-label", value: { valueType: "TEXT", value: "North" } },
    { candidateId: "c-start", taskId: taskId(plan, "entity:item"), kind: "FIELD", entityId: "entity:item", instanceId: "north", fieldId: "startDate", documentId: DOC, extractionFactId: "F-start", value: { valueType: "DATE", value: "2024-01-02" } },
    { candidateId: "c-name", taskId: taskId(plan, "entity:other"), kind: "FIELD", entityId: "entity:other", instanceId: "south", fieldId: "name", documentId: DOC, extractionFactId: "F-name", value: { valueType: "TEXT", value: "South" } },
    { candidateId: "c-when", taskId: taskId(plan, "entity:other"), kind: "FIELD", entityId: "entity:other", instanceId: "south", fieldId: "when", documentId: DOC, extractionFactId: "F-when", value: { valueType: "DATE", value: "2024-02-01" } },
  ];
}

function link(plan: ReturnType<typeof world>["plan"], candidateId: string, quote: string, overrides: Record<string, unknown> = {}) {
  return {
    candidateId,
    taskId: taskId(plan, "relationship:item-other"),
    kind: "RELATIONSHIP",
    relationshipId: "relationship:item-other",
    fromInstanceId: "north",
    toInstanceId: "south",
    evidence: [{ sourceDocumentId: DOC, page: 1, quote }],
    ...overrides,
  };
}

function bind(candidates: unknown[]) {
  const { pack, plan, extractions } = world();
  const result = bindInvestigationCandidates({
    pack,
    plan,
    extractions,
    documents: documents(),
    candidates: {
      schema: INVESTIGATION_CANDIDATES_SCHEMA,
      planDigest: plan.digest,
      packDigest: pack.identity.digest,
      extractionDigest: authorizedExtractionDigest(extractions),
      candidates,
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { pack, plan, extractions, bound: result };
}

function candidateOf(bound: { unresolved: { candidates: readonly UnresolvedCandidate[] } }, candidateId: string): UnresolvedCandidate {
  const candidate = bound.unresolved.candidates.find((item) => item.candidateId === candidateId);
  if (!candidate?.relationshipId || !candidate.fromEntityId || !candidate.toEntityId || !candidate.fromInstanceId || !candidate.toInstanceId) {
    throw new Error("missing candidate " + candidateId);
  }
  return candidate;
}

function contextFor(
  scene: ReturnType<typeof bind>,
  candidateId: string,
  overrides: Record<string, unknown> = {},
) {
  const candidate = candidateOf(scene.bound, candidateId);
  return {
    schema: RELATIONSHIP_VERIFICATION_CONTEXT_SCHEMA,
    hiveId: "hive-1",
    actorId: "owner-1",
    permission: "HIVE_OWNER",
    evidenceRevision: {
      extractionDigest: authorizedExtractionDigest(scene.extractions),
      binderDigest: scene.bound.digest,
      evidenceDigest: investigationEvidenceDigest(scene.bound.verified, scene.bound.unresolved),
    },
    candidate: {
      candidateId,
      contentDigest: relationshipCandidateContentDigest({
        relationshipId: candidate.relationshipId ?? "",
        fromEntityId: candidate.fromEntityId ?? "",
        toEntityId: candidate.toEntityId ?? "",
        fromInstanceId: candidate.fromInstanceId ?? "",
        toInstanceId: candidate.toInstanceId ?? "",
        evidence: candidate.evidence,
      }),
    },
    packDigest: scene.pack.identity.digest,
    planDigest: scene.plan.digest,
    ...overrides,
  };
}

function decide(
  scene: ReturnType<typeof bind>,
  candidateId: string,
  options: {
    request?: unknown;
    records?: readonly RelationshipVerificationRecord[];
    structures?: readonly unknown[];
    decidedAt?: string;
    context?: unknown;
    unresolved?: typeof scene.bound.unresolved;
    binderDigest?: string;
  } = {},
): RelationshipVerificationDecision {
  const unresolved = options.unresolved ?? scene.bound.unresolved;
  return decideRelationshipVerification({
    pack: scene.pack,
    plan: scene.plan,
    verified: scene.bound.verified,
    unresolved,
    binderDigest: options.binderDigest ?? scene.bound.digest,
    documents: documents(),
    extractions: scene.extractions,
    context: options.context ?? contextFor(scene, candidateId),
    records: options.records ?? [],
    decidedAt: options.decidedAt ?? WHEN,
    ...(options.request !== undefined ? { request: options.request } : {}),
    ...(options.structures !== undefined ? { structures: options.structures } : {}),
  });
}

function request(candidateId: string, decision: "ACCEPT" | "REJECT" | "REVOKE", expectedHead: string | null, requestId = "req-" + candidateId + "-" + decision, targetRecordId?: string) {
  return {
    requestId,
    expectedHead,
    candidateId,
    decision,
    ...(targetRecordId ? { targetRecordId } : {}),
  };
}

function ready(decision: RelationshipVerificationDecision) {
  if (!decision.ok) throw new Error(decision.message ?? decision.code);
  return decision;
}

function between(pack: CompiledDomainPack, verified: RelationshipVerificationDecision["verified"]): DomainRuleResult | undefined {
  const evaluation = evaluateDomainRules(pack, verified);
  expect(evaluation.ok).toBe(true);
  if (!evaluation.ok) return undefined;
  return evaluation.results.find((item) => item.ruleId === "calculation:between");
}

function ledger(scene: ReturnType<typeof bind>, decision: RelationshipVerificationDecision, unresolved = decision.unresolved) {
  return buildCoverageLedger({
    plan: scene.plan,
    pack: scene.pack,
    verified: decision.verified,
    unresolved,
    evidenceDigest: investigationEvidenceDigest(decision.verified, unresolved),
  });
}

function structure(polarity: "HOLDS" | "DOES_NOT_HOLD", slots = [
  { role: "FROM_IDENTITY" as const, value: "North" },
  { role: "TO_IDENTITY" as const, value: "South" },
  { role: "POLARITY" as const, value: "North" },
  { role: "DIRECTION" as const, value: authoredRelationshipDirection("north", "south") },
]): RelationshipSourceStructure {
  const body = {
    schema: RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA,
    relationshipId: "relationship:item-other",
    direction: "AUTHORED_FROM_TO" as const,
    polarity,
    slots,
  };
  return { ...body, structureDigest: relationshipStructureDigest(body) };
}

describe("trusted relationship verification", () => {
  it("does not admit co-occurrence of affirmative, negated, unrelated, contradictory, or word-reversed sentences", () => {
    const scene = bind([
      ...fields(world().plan),
      link(world().plan, "c-affirm", "North authorizes the review of South."),
      link(world().plan, "c-negate", "North does not authorize the review of South."),
      link(world().plan, "c-unrelated", "North was present and South was present."),
      link(world().plan, "c-contradict", "North disputes the record about South."),
      link(world().plan, "c-reversed-words", "South authorizes the review of North."),
    ]);
    const plan = scene.plan;
    const rebound = bind([
      ...fields(plan),
      link(plan, "c-affirm", "North authorizes the review of South."),
      link(plan, "c-negate", "North does not authorize the review of South."),
      link(plan, "c-unrelated", "North was present and South was present."),
      link(plan, "c-contradict", "North disputes the record about South."),
      link(plan, "c-reversed-words", "South authorizes the review of North."),
    ]);
    expect(rebound.bound.verified.relationships).toEqual([]);
    const decision = ready(decide(rebound, "c-affirm"));
    expect(decision.code).toBe("NO_RECORD");
    expect(decision.typedResult).toBe("NO_TYPED_SOURCE");
    expect(decision.record).toBeNull();
    expect(decision.verified.relationships).toEqual([]);
    expect(decision.records).toEqual([]);
    for (const candidateId of ["c-affirm", "c-negate", "c-unrelated", "c-contradict", "c-reversed-words"]) {
      expect(decision.unresolved.candidates.find((item) => item.candidateId === candidateId)).toMatchObject({
        trust: "REVIEW_REQUIRED",
        reasons: ["RELATIONSHIP_SEMANTICS_UNVERIFIED"],
      });
    }
    expect(between(rebound.pack, decision.verified)?.daysBetween).toBeUndefined();
    expect(between(rebound.pack, decision.verified)?.reasonCodes).not.toContain("CALCULATION_COMPUTED");
  });

  it("refuses swapped endpoints", () => {
    const scene = bind([
      ...fields(world().plan),
      link(world().plan, "c-swap", "North authorizes the review of South.", { fromInstanceId: "south", toInstanceId: "north" }),
    ]);
    const plan = scene.plan;
    const rebound = bind([
      ...fields(plan),
      link(plan, "c-swap", "North authorizes the review of South.", { fromInstanceId: "south", toInstanceId: "north" }),
    ]);
    const held = rebound.bound.unresolved.candidates.find((item) => item.candidateId === "c-swap");
    expect(held?.reasons).toContain("DIRECTION_MISMATCH");
    const decision = decide(rebound, "c-swap", { request: request("c-swap", "ACCEPT", null) });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("NOT_ELIGIBLE");
    expect(decision.records).toEqual([]);
    expect(decision.verified.relationships).toEqual([]);
  });

  it("withholds a decision, method, verifier, actor, or status supplied by the candidate or the request", () => {
    const scene = bind([...fields(world().plan), link(world().plan, "c-link", "North authorizes the review of South.")]);
    const plan = scene.plan;
    const rebound = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const poisonedUnresolved = structuredClone(rebound.bound.unresolved);
    const poisoned = poisonedUnresolved.candidates.find((item) => item.candidateId === "c-link");
    Object.assign(poisoned ?? {}, { status: "VERIFIED", method: "AUTHORIZED_HUMAN" });
    const binderDigest = packDigest({ verified: rebound.bound.verified, unresolved: poisonedUnresolved });
    const forgedContext = {
      ...contextFor(rebound, "c-link"),
      evidenceRevision: {
        extractionDigest: authorizedExtractionDigest(rebound.extractions),
        binderDigest,
        evidenceDigest: investigationEvidenceDigest(rebound.bound.verified, poisonedUnresolved),
      },
    };
    const fromCandidate = decide(rebound, "c-link", {
      request: request("c-link", "ACCEPT", null),
      unresolved: poisonedUnresolved,
      binderDigest,
      context: forgedContext,
    });
    expect(fromCandidate.ok).toBe(false);
    if (!fromCandidate.ok) expect(fromCandidate.code).toBe("CANDIDATE_INVALID");
    expect(fromCandidate.verified.relationships).toEqual([]);

    const fromRequest = decide(rebound, "c-link", {
      request: { ...request("c-link", "ACCEPT", null), actorId: "forged", verifierId: "model", method: "AUTHORIZED_HUMAN", status: "VERIFIED" },
    });
    expect(fromRequest.ok).toBe(false);
    if (!fromRequest.ok) expect(fromRequest.code).toBe("REQUEST_INVALID");
    expect(fromRequest.records).toEqual([]);
    expect(fromRequest.verified.relationships).toEqual([]);
  });

  it("withholds a missing, unauthorized, or digest-mismatched server context", () => {
    const scene = bind([...fields(world().plan), link(world().plan, "c-link", "North authorizes the review of South.")]);
    const plan = scene.plan;
    const rebound = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const base = contextFor(rebound, "c-link");
    const cases = [
      { ...base, actorId: undefined },
      { ...base, permission: "MEMBER" },
      { ...base, verifierId: "forged" },
      { ...base, packDigest: "f".repeat(64) },
      { ...base, evidenceRevision: { ...base.evidenceRevision, evidenceDigest: "e".repeat(64) } },
      { ...base, candidate: { ...base.candidate, contentDigest: "c".repeat(64) } },
    ];
    for (const context of cases) {
      const decision = decide(rebound, "c-link", { context, request: request("c-link", "ACCEPT", null) });
      expect(decision.ok).toBe(false);
      expect(decision.records).toEqual([]);
      expect(decision.verified.relationships).toEqual([]);
    }
    const denied = decide(rebound, "c-link", { context: { ...base, permission: "MEMBER" }, request: request("c-link", "ACCEPT", null) });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("PERMISSION_DENIED");
    const mismatch = decide(rebound, "c-link", { context: { ...base, packDigest: "f".repeat(64) }, request: request("c-link", "ACCEPT", null) });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe("DIGEST_MISMATCH");
  });

  it("accepts one owner decision, preserves its quotations, and removes that candidate from review", () => {
    const scene = bind([...fields(world().plan), link(world().plan, "c-link", "North authorizes the review of South.")]);
    const plan = scene.plan;
    const rebound = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const candidate = candidateOf(rebound.bound, "c-link");
    const accepted = ready(decide(rebound, "c-link", { request: request("c-link", "ACCEPT", null) }));
    expect(accepted.code).toBe("APPENDED");
    expect(accepted.typedResult).toBe("NO_TYPED_SOURCE");
    expect(accepted.records).toHaveLength(1);
    expect(accepted.record).toMatchObject({
      schema: "hive.relationship-verification/1",
      decision: "ACCEPT",
      method: "AUTHORIZED_HUMAN",
      effect: "SUPPORTS",
      actorId: "owner-1",
      permission: "HIVE_OWNER",
      sequence: 1,
      causalParentId: null,
      relationshipId: "relationship:item-other",
    });
    expect(accepted.record?.quotations).toEqual([{
      documentId: DOC,
      page: 1,
      quote: "North authorizes the review of South.",
      excerptId: relationshipExcerptId(DOC, 1, "North authorizes the review of South."),
    }]);
    expect(accepted.verified.relationships).toHaveLength(1);
    expect(accepted.verified.relationships[0]).toMatchObject({
      status: "VERIFIED",
      relationshipId: "relationship:item-other",
      fromInstanceId: "north",
      toInstanceId: "south",
      sourceRefs: candidate.sourceRefs,
      id: relationshipVerificationFactId("relationship:item-other", "north", "south", {
        extractionDigest: authorizedExtractionDigest(rebound.extractions),
        binderDigest: rebound.bound.digest,
        evidenceDigest: investigationEvidenceDigest(rebound.bound.verified, rebound.bound.unresolved),
      }),
    });
    expect(accepted.unresolved.candidates.some((item) => item.candidateId === "c-link")).toBe(false);
    expect(accepted.dispositions).toEqual([{ relationshipId: "relationship:item-other", fromInstanceId: "north", toInstanceId: "south", disposition: "HELD" }]);
    expect(between(rebound.pack, accepted.verified)).toMatchObject({ outcome: "COMPUTED", daysBetween: "30" });
    const covered = ledger(rebound, accepted);
    expect(covered.ok).toBe(true);
    const leaked = buildCoverageLedger({
      plan: rebound.plan,
      pack: rebound.pack,
      verified: accepted.verified,
      unresolved: rebound.bound.unresolved,
      evidenceDigest: investigationEvidenceDigest(accepted.verified, rebound.bound.unresolved),
    });
    expect(leaked.ok).toBe(false);
    if (!leaked.ok) expect(leaked.issues.some((item) => item.code === "relationship_promoted")).toBe(true);
    expect(rebound.bound.verified.relationships).toEqual([]);
    const repeated = decide(rebound, "c-link", {
      records: accepted.records,
      request: request("c-link", "REJECT", accepted.record?.recordId ?? null, "req-reject-open"),
      decidedAt: LATER,
    });
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.code).toBe("NOT_ELIGIBLE");
    expect(repeated.records).toHaveLength(1);
  });

  it("rejects a candidate without admitting a relationship or a day count", () => {
    const scene = bind([...fields(world().plan), link(world().plan, "c-link", "North authorizes the review of South.")]);
    const plan = scene.plan;
    const rebound = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const rejected = ready(decide(rebound, "c-link", { request: request("c-link", "REJECT", null) }));
    expect(rejected.record).toMatchObject({ decision: "REJECT", effect: "WITHHOLDS", method: "AUTHORIZED_HUMAN" });
    expect(rejected.verified.relationships).toEqual([]);
    expect(rejected.unresolved.candidates.find((item) => item.candidateId === "c-link")).toMatchObject({
      trust: "REVIEW_REQUIRED",
      reasons: ["RELATIONSHIP_SEMANTICS_UNVERIFIED"],
    });
    expect(rejected.dispositions[0]?.disposition).toBe("UNRESOLVED");
    expect(between(rebound.pack, rejected.verified)?.daysBetween).toBeUndefined();
    const covered = ledger(rebound, rejected);
    expect(covered.ok).toBe(true);
    if (covered.ok) expect(covered.value.rows.find((row) => row.definitionId === "calculation:between")?.daysBetween).toBeUndefined();
  });

  it("folds two corroborating approvals into one verified relationship and one day count", () => {
    const plan = world().plan;
    const scene = bind([
      ...fields(plan),
      link(plan, "c-one", "North authorizes the review of South."),
      link(plan, "c-two", "North was present and South was present."),
    ]);
    const first = ready(decide(scene, "c-one", { request: request("c-one", "ACCEPT", null, "req-one") }));
    const second = ready(decide(scene, "c-two", {
      request: request("c-two", "ACCEPT", first.record?.recordId ?? null, "req-two"),
      records: first.records,
      decidedAt: LATER,
    }));
    expect(second.records).toHaveLength(2);
    expect(second.records[0]).toEqual(first.records[0]);
    expect(second.records[1]?.causalParentId).toBe(first.record?.recordId);
    expect(second.verified.relationships).toHaveLength(1);
    expect(second.verified.relationships[0]?.sourceRefs).toEqual(candidateOf(scene.bound, "c-one").sourceRefs);
    expect(second.unresolved.candidates.some((item) => item.candidateId === "c-one" || item.candidateId === "c-two")).toBe(false);
    expect(second.records.map((record) => record.quotations[0]?.quote)).toEqual([
      "North authorizes the review of South.",
      "North was present and South was present.",
    ]);
    const row = between(scene.pack, second.verified);
    expect(row).toMatchObject({ outcome: "COMPUTED", daysBetween: "30" });
    expect(row?.reasonCodes).not.toContain("AMBIGUOUS_RELATIONSHIP");
    const covered = ledger(scene, second);
    expect(covered.ok).toBe(true);
    if (covered.ok) {
      expect(covered.value.rows.find((item) => item.definitionId === "calculation:between" && item.disposition === "COMPUTED")?.daysBetween).toBe("30");
    }
  });

  it("appends a matching typed acceptance and withholds a human acceptance of that evidence", () => {
    const plan = world().plan;
    const scene = bind([...fields(plan), link(plan, "c-typed", "north->south North South.")]);
    const pinned = structure("HOLDS");
    const typed = ready(decide(scene, "c-typed", { structures: [pinned] }));
    expect(typed.code).toBe("APPENDED");
    expect(typed.typedResult).toBe("TYPED_ACCEPT");
    expect(typed.record).toMatchObject({
      method: "TYPED_SOURCE",
      decision: "ACCEPT",
      effect: "SUPPORTS",
      polarity: "HOLDS",
      structureDigest: pinned.structureDigest,
    });
    expect(typed.verified.relationships).toHaveLength(1);
    const replay = ready(decide(scene, "c-typed", { structures: [pinned], records: typed.records, decidedAt: LATER }));
    expect(replay.code).toBe("REPLAYED");
    expect(replay.record).toEqual(typed.record);
    expect(replay.records).toHaveLength(1);
    const human = decide(scene, "c-typed", {
      structures: [pinned],
      records: typed.records,
      request: request("c-typed", "ACCEPT", typed.record?.recordId ?? null, "req-human"),
      decidedAt: LATER,
    });
    expect(human.ok).toBe(false);
    if (!human.ok) expect(human.code).toBe("HUMAN_WITHHELD");
    expect(human.records).toHaveLength(1);
    expect(human.records[0]).toEqual(typed.records[0]);
    expect(human.verified.relationships).toHaveLength(1);
    const mismatch = structure("HOLDS", [
      { role: "FROM_IDENTITY", value: "West" },
      { role: "TO_IDENTITY", value: "South" },
      { role: "POLARITY", value: "North" },
      { role: "DIRECTION", value: authoredRelationshipDirection("north", "south") },
    ]);
    const withheld = ready(decide(scene, "c-typed", { structures: [mismatch] }));
    expect(withheld.typedResult).toBe("TYPED_MISMATCH");
    expect(withheld.record).toMatchObject({ method: "TYPED_SOURCE", decision: "REJECT", effect: "WITHHOLDS" });
    expect(withheld.verified.relationships).toEqual([]);
    expect(withheld.unresolved.candidates.some((item) => item.candidateId === "c-typed")).toBe(true);
  });

  it("keeps trusted opposition unresolved and blocks a later human acceptance", () => {
    const plan = world().plan;
    const scene = bind([
      ...fields(plan),
      link(plan, "c-support", "North authorizes the review of South."),
      link(plan, "c-oppose", "north->south North South."),
      link(plan, "c-later", "North was present and South was present."),
    ]);
    const pinned = structure("DOES_NOT_HOLD");
    const support = ready(decide(scene, "c-support", {
      structures: [pinned],
      request: request("c-support", "ACCEPT", null, "req-support"),
    }));
    expect(support.typedResult).toBe("TYPED_INAPPLICABLE");
    expect(support.verified.relationships).toHaveLength(1);
    const opposed = ready(decide(scene, "c-oppose", { structures: [pinned], records: support.records, decidedAt: LATER }));
    expect(opposed.typedResult).toBe("TYPED_OPPOSE");
    expect(opposed.record).toMatchObject({ method: "TYPED_SOURCE", decision: "REJECT", effect: "OPPOSES", polarity: "DOES_NOT_HOLD" });
    expect(opposed.verified.relationships).toEqual([]);
    expect(opposed.dispositions).toEqual([expect.objectContaining({ disposition: "CONTRADICTORY_RELATIONSHIP" })]);
    expect(opposed.unresolved.candidates.some((item) => item.candidateId === "c-support")).toBe(false);
    expect(opposed.unresolved.candidates.find((item) => item.candidateId === "c-oppose")?.reasons).toEqual(["RELATIONSHIP_SEMANTICS_UNVERIFIED"]);
    expect(between(scene.pack, opposed.verified)?.daysBetween).toBeUndefined();
    const covered = ledger(scene, opposed);
    expect(covered.ok).toBe(true);
    if (covered.ok) expect(covered.value.rows.find((row) => row.definitionId === "calculation:between")?.daysBetween).toBeUndefined();
    const later = decide(scene, "c-later", {
      structures: [pinned],
      records: opposed.records,
      request: request("c-later", "ACCEPT", opposed.record?.recordId ?? null, "req-later"),
      decidedAt: "2026-11-24T22:10:00.000Z",
    });
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.code).toBe("HUMAN_WITHHELD");
    expect(later.records).toHaveLength(opposed.records.length);
    expect(later.verified.relationships).toEqual([]);
  });

  it("revokes a later fold without changing the acceptance or an earlier ledger", () => {
    const plan = world().plan;
    const scene = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const accepted = ready(decide(scene, "c-link", { request: request("c-link", "ACCEPT", null, "req-accept") }));
    const covered = ledger(scene, accepted);
    expect(covered.ok).toBe(true);
    if (!covered.ok) return;
    const beforeLedger = structuredClone(covered.value);
    const beforeAccept = structuredClone(accepted.records[0]);
    const revoked = ready(decide(scene, "c-link", {
      records: accepted.records,
      request: request("c-link", "REVOKE", accepted.record?.recordId ?? null, "req-revoke", accepted.record?.recordId),
      decidedAt: LATER,
    }));
    expect(revoked.records[0]).toEqual(beforeAccept);
    expect(revoked.records[1]).toMatchObject({ decision: "REVOKE", effect: "REVOKES", targetRecordId: beforeAccept?.recordId, method: "AUTHORIZED_HUMAN" });
    expect(revoked.records[1]?.quotations).toEqual(beforeAccept?.quotations);
    expect(revoked.verified.relationships).toEqual([]);
    expect(accepted.verified.relationships).toHaveLength(1);
    expect(covered.value).toEqual(beforeLedger);
    expect(between(scene.pack, revoked.verified)?.daysBetween).toBeUndefined();
    const after = ledger(scene, revoked);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.rows.find((row) => row.definitionId === "calculation:between")?.daysBetween).toBeUndefined();
    expect(covered.value.digest).toBe(beforeLedger.digest);
    const second = decide(scene, "c-link", {
      records: revoked.records,
      request: request("c-link", "REVOKE", revoked.record?.recordId ?? null, "req-revoke-again", accepted.record?.recordId),
      decidedAt: "2026-11-24T22:10:00.000Z",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("CAUSAL_CONFLICT");
    expect(second.records).toHaveLength(2);
  });

  it("replays a revoked acceptance without restoring the relationship", () => {
    const plan = world().plan;
    const scene = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const accepted = ready(decide(scene, "c-link", { request: request("c-link", "ACCEPT", null, "req-accept") }));
    const revoked = ready(decide(scene, "c-link", {
      records: accepted.records,
      request: request("c-link", "REVOKE", accepted.record?.recordId ?? null, "req-revoke", accepted.record?.recordId),
      decidedAt: LATER,
    }));
    const replay = ready(decide(scene, "c-link", {
      records: revoked.records,
      request: { ...request("c-link", "REJECT", "stale-head", "req-accept") },
      decidedAt: "2026-11-24T22:10:00.000Z",
    }));
    expect(replay.code).toBe("REPLAYED");
    expect(replay.record).toEqual(accepted.record);
    expect(replay.records).toHaveLength(2);
    expect(replay.records[1]?.decision).toBe("REVOKE");
    expect(replay.verified.relationships).toEqual([]);
  });

  it("accepts again only from the revoke head", () => {
    const plan = world().plan;
    const scene = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const accepted = ready(decide(scene, "c-link", { request: request("c-link", "ACCEPT", null, "req-accept") }));
    const revoked = ready(decide(scene, "c-link", {
      records: accepted.records,
      request: request("c-link", "REVOKE", accepted.record?.recordId ?? null, "req-revoke", accepted.record?.recordId),
      decidedAt: LATER,
    }));
    const stale = decide(scene, "c-link", {
      records: revoked.records,
      request: request("c-link", "ACCEPT", accepted.record?.recordId ?? null, "req-stale"),
      decidedAt: "2026-11-24T22:10:00.000Z",
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("CAUSAL_CONFLICT");
    expect(stale.records).toHaveLength(2);
    expect(stale.verified.relationships).toEqual([]);
    const again = ready(decide(scene, "c-link", {
      records: revoked.records,
      request: request("c-link", "ACCEPT", revoked.record?.recordId ?? null, "req-again"),
      decidedAt: "2026-11-24T22:10:00.000Z",
    }));
    expect(again.records).toHaveLength(3);
    expect(again.records[0]).toEqual(accepted.records[0]);
    expect(again.verified.relationships).toHaveLength(1);
    expect(again.record?.recordId).not.toBe(accepted.record?.recordId);
    expect(between(scene.pack, again.verified)?.daysBetween).toBe("30");
  });

  it("refuses an invalid quotation", () => {
    const plan = world().plan;
    const scene = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const unresolved = structuredClone(scene.bound.unresolved);
    const candidate = unresolved.candidates.find((item) => item.candidateId === "c-link");
    if (!candidate) throw new Error("missing candidate");
    candidate.evidence = [{ sourceDocumentId: DOC, page: 1, quote: "This sentence was never written." }];
    const binderDigest = packDigest({ verified: scene.bound.verified, unresolved });
    const context = {
      ...contextFor(scene, "c-link"),
      evidenceRevision: {
        extractionDigest: authorizedExtractionDigest(scene.extractions),
        binderDigest,
        evidenceDigest: investigationEvidenceDigest(scene.bound.verified, unresolved),
      },
      candidate: {
        candidateId: "c-link",
        contentDigest: relationshipCandidateContentDigest({
          relationshipId: candidate.relationshipId ?? "",
          fromEntityId: candidate.fromEntityId ?? "",
          toEntityId: candidate.toEntityId ?? "",
          fromInstanceId: candidate.fromInstanceId ?? "",
          toInstanceId: candidate.toInstanceId ?? "",
          evidence: candidate.evidence,
        }),
      },
    };
    const decision = decide(scene, "c-link", {
      unresolved,
      binderDigest,
      context,
      request: request("c-link", "ACCEPT", null),
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("NOT_ELIGIBLE");
    expect(decision.verified.relationships).toEqual([]);
    expect(decision.records).toEqual([]);
  });

  it("returns NO_TYPED_SOURCE without a structure and STRUCTURE_UNAPPROVED for an unapproved companion", () => {
    const plan = world().plan;
    const scene = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const none = ready(decide(scene, "c-link"));
    expect(none.typedResult).toBe("NO_TYPED_SOURCE");
    expect(none.verified.relationships).toEqual([]);
    const broken = structure("HOLDS");
    const unapproved = decide(scene, "c-link", {
      structures: [{ ...broken, structureDigest: "0".repeat(64) }],
      request: request("c-link", "ACCEPT", null),
    });
    expect(unapproved.ok).toBe(false);
    if (!unapproved.ok) expect(unapproved.code).toBe("STRUCTURE_UNAPPROVED");
    expect(unapproved.verified.relationships).toEqual([]);
    const reversed = decide(scene, "c-link", {
      structures: [{ ...structure("DOES_NOT_HOLD"), direction: "REVERSE" }],
      request: request("c-link", "ACCEPT", null),
    });
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) expect(reversed.code).toBe("STRUCTURE_UNAPPROVED");

    const proof = compileDomainPack(JSON.parse(readFileSync(join(import.meta.dirname, "../../../../packs/drafts/iep-us-federal/v0.3.0/iep-domain-pack-source.stage4b.json"), "utf8")) as DomainPackSource);
    expect(proof.ok).toBe(true);
    if (!proof.ok) return;
    expect(proof.value.identity).toMatchObject({ packId: "iep-us-federal", version: "0.3.0" });
    const relationships = proof.value.definitions.filter((definition) => definition.kind === "relationship");
    expect(relationships.length).toBeGreaterThan(0);
    for (const relationship of relationships) {
      expect(assessRelationshipTypedSource(relationship.id, undefined)).toBe("NO_TYPED_SOURCE");
      expect(assessRelationshipTypedSource(relationship.id, [])).toBe("NO_TYPED_SOURCE");
    }
    const sourceText = readFileSync(new URL("./domain-relationship-verification.ts", import.meta.url), "utf8");
    expect(sourceText).not.toContain("iep-us-federal");
    expect(sourceText).not.toContain("authorizes");
    expect(sourceText).not.toContain("Date.now");
    expect(sourceText).not.toMatch(/openai|anthropic|litellm|fetch\(/i);
  });

  it("keeps record and fact ids deterministic", () => {
    const plan = world().plan;
    const scene = bind([...fields(plan), link(plan, "c-link", "North authorizes the review of South.")]);
    const left = ready(decide(scene, "c-link", { request: request("c-link", "ACCEPT", null, "req-accept") }));
    const right = ready(decide(scene, "c-link", { request: request("c-link", "ACCEPT", null, "req-accept") }));
    expect(right.record?.recordId).toBe(left.record?.recordId);
    expect(right.verified.relationships[0]?.id).toBe(left.verified.relationships[0]?.id);
    const replay = ready(decide(scene, "c-link", { records: left.records, request: request("c-link", "ACCEPT", null, "req-accept"), decidedAt: LATER }));
    expect(replay.code).toBe("REPLAYED");
    expect(replay.record?.decidedAt).toBe(WHEN);
    expect(replay.records).toHaveLength(1);
  });
});
