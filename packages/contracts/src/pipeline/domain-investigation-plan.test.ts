import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  compileInvestigationPlan,
  PER_INSTANCE_CASES,
  type InvestigationPlanInput,
  type SupplementalArtifacts,
} from "./domain-investigation-plan";
import {
  DOMAIN_PACK_SOURCE_SCHEMA,
  type CompiledDomainPack,
  type DomainPackSource,
  type PackDefinition,
} from "./domain-pack-source";

function tinySource(): DomainPackSource {
  const item: PackDefinition = {
    id: "entity:item", kind: "entity", label: "Item",
    fields: [
      { id: "label", valueType: "TEXT" },
      { id: "startDate", valueType: "DATE" },
      { id: "endDate", valueType: "DATE" },
    ],
  };
  const other: PackDefinition = {
    id: "entity:other", kind: "entity", label: "Other",
    fields: [{ id: "when", valueType: "DATE" }],
  };
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "example-review", version: "1.0.0", title: "Example review" },
    ownership: { scope: "PRO", ownerId: "pro-1", authoredBy: "pro-1" },
    applicability: { jurisdiction: "unspecified", verification: "UNVERIFIED", effectiveFrom: "2020-01-01" },
    definitions: [
      item,
      other,
      { id: "relationship:item-other", kind: "relationship", label: "Item to other", fromEntityId: "entity:item", toEntityId: "entity:other", evidenceRequired: true },
      { id: "document:record", kind: "document", label: "Record", aliases: ["record"], appliesWhen: { op: "REVIEW_REQUIRED" }, settlesCheckIds: [] },
      {
        id: "check:review", kind: "check", label: "Review",
        criterion: { op: "REVIEW_REQUIRED" }, question: "Is the record complete?",
        authority: { kind: "PROFESSIONAL_PRACTICE", citation: "Practice note" },
      },
      { id: "check:present", kind: "check", label: "Present", criterion: { op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "label" } },
      {
        id: "check:cross", kind: "check", label: "Cross",
        criterion: {
          op: "ALL",
          conditions: [
            { op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "label" },
            { op: "FIELD_PRESENT", entityId: "entity:other", fieldId: "when" },
          ],
        },
      },
      {
        id: "calculation:span", kind: "calculation", label: "Span", operator: "DAYS_BETWEEN",
        inputFields: ["startDate", "endDate"], state: "EXECUTABLE",
        bindings: [
          { role: "start", entityId: "entity:item", fieldId: "startDate" },
          { role: "end", entityId: "entity:item", fieldId: "endDate" },
        ],
      },
      {
        id: "calculation:gap", kind: "calculation", label: "Gap", operator: "DIFFERENCE",
        inputFields: ["left", "right"], state: "DECLARATION_ONLY", legacyInputs: "left minus right",
      },
      { id: "chain:path", kind: "chain", label: "Path", links: ["Item record", "Other record"] },
      { id: "chain:return", kind: "chain", label: "Return", links: ["Other record", "Item record"] },
      { id: "question:ask", kind: "question", label: "Ask", audience: "all", text: "What happened?", appliesWhen: { op: "REVIEW_REQUIRED" } },
      { id: "term:word", kind: "term", label: "Word", meaning: "A defined word." },
      { id: "guideline:style", kind: "guideline", label: "Style", text: "Use plain language.", scope: "REPORTING" },
      { id: "workflow:steps", kind: "workflow", label: "Steps", steps: [{ id: "ask", action: "ASK_QUESTION", requiresReview: true }] },
    ],
    changes: [],
    review: { status: "DRAFT" },
  };
}

function compileTiny(source: DomainPackSource = tinySource(), upstream?: CompiledDomainPack): CompiledDomainPack {
  const result = compileDomainPack(source, upstream);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function companionsFor(pack: CompiledDomainPack): SupplementalArtifacts {
  const ofKind = (kind: PackDefinition["kind"]) => pack.definitions.filter((definition) => definition.kind === kind);
  const entities = ofKind("entity");
  const relationships = ofKind("relationship");
  const documents = ofKind("document");
  const checks = ofKind("check");
  const calculations = ofKind("calculation");
  const questions = ofKind("question");
  const chains = ofKind("chain");
  const firstEntity = entities[0]?.id;
  const secondEntity = entities[1]?.id ?? firstEntity;
  const firstRelationship = relationships[0]?.id;
  const authorityId = "AUTH-EXAMPLE";
  const mapped = [
    ...checks.filter((definition) => definition.id === "check:review").map((definition) => definition.id),
    "conflictPattern:sample",
    "stateOverlay:sample",
  ];
  return {
    ontology: {
      schema: "hive.domain-ontology-spec/1",
      packRef: { packId: pack.identity.packId, version: pack.identity.version },
      entities: entities.map((definition) => ({
        id: definition.id,
        factClass: definition.id === firstEntity ? "EVENT" : "NOT-A-CLASS",
        fields: definition.kind === "entity" ? definition.fields.map((field) => ({ id: field.id, valueType: field.valueType })) : [],
        ruleIds: definition.id === firstEntity ? ["check:review", "check:present", "question:ask", "calculation:span"].filter((id) => pack.definitions.some((item) => item.id === id)) : [],
        documentKinds: documents[0] ? [documents[0].id] : [],
        instanceBoundary: "One record.",
        identityKeys: ["label as written"],
      })),
      relationships: relationships.map((definition) => definition.kind === "relationship" ? {
        id: definition.id,
        fromEntityId: definition.fromEntityId,
        toEntityId: definition.toEntityId,
        evidenceForLink: "The records name one another.",
        cardinality: "many",
      } : definition),
      documents: documents.map((definition) => ({
        id: definition.id,
        entities: firstEntity ? [firstEntity] : [],
        checksSupported: [],
        requirementBasis: "PROFESSIONALLY_RECOMMENDED",
      })),
      chains: chains.map((definition) => ({
        id: definition.id,
        relationshipIds: firstRelationship ? [firstRelationship] : [],
        startEntity: firstEntity,
        endEntity: secondEntity,
        relevantChecks: [],
        investigationQuestions: [],
      })),
      calculations: calculations.map((definition) => ({
        id: definition.id,
        preconditions: ["relationship:item-other is mentioned only in prose"],
        proposedBindings: [{ role: "start", entityId: "entity:other", fieldId: "when" }],
        ...(definition.kind === "calculation" && definition.state === "EXECUTABLE" ? { join: null } : {}),
      })),
    },
    authorityRegister: {
      schema: "hive.domain-authority-register/1",
      authorities: [{
        authorityId,
        authorityType: "PROFESSIONAL_REFERENCE",
        evidenceStrength: "PROFESSIONAL_STANDARD",
        humanReview: "NOT_REVIEWED",
        verificationStatus: "AUTHOR_PROPOSED",
        interpretation: { establishes: "A practice note.", doesNotEstablish: "Not a conclusion about a person." },
        limitations: ["Unreviewed practice note."],
        relatedDefinitionIds: mapped,
      }],
      definitionAuthorityMap: Object.fromEntries(mapped.map((id) => [id, [authorityId]])),
      authorityRoles: pack.definitions.some((definition) => definition.id === "check:review")
        ? { "check:review": { [authorityId]: "CLAIM_AUTHOR_PROPOSED" } }
        : {},
      authorityClassIndex: { legend: { PROFESSIONAL_REFERENCE: "PROFESSIONAL_CRITERIA" } },
      structuralDefinitions: {
        "term:word": "STRUCTURAL - persona/report/intake definition; makes no domain claim.",
      },
      unusedAuthorityDisposition: {},
    },
    conflictPatterns: {
      schema: "hive.domain-conflict-pattern-spec/1",
      dp1Supported: false,
      patterns: firstEntity && firstRelationship ? [{
        id: "conflictPattern:sample",
        entities: [firstEntity],
        fields: ["label"],
        relationshipRequirements: [firstRelationship],
        authorityIds: [authorityId],
      }] : [],
    },
    stateOverlays: {
      schema: "hive.domain-state-overlay-spec/1",
      dp1Supported: false,
      overlays: [{ id: "stateOverlay:sample", authorityIds: [authorityId], storedThreshold: null }],
    },
    factClasses: { schema: "hive.domain-fact-class-spec/1", dp1Supported: false, classes: ["EVENT"] },
    workflowCoverage: {
      schema: "hive.domain-workflow-coverage-spec/1",
      dp1Supported: false,
      rows: [
        { workflow: "Sample path", answers: { remainingClassified: "YES" }, note: "A note that says deferred in prose." },
        { workflow: "Deferred path", answers: { remainingClassified: "DEFERRED" }, note: "Deferred module." },
      ],
    },
    unsupportedOperators: {
      schema: "hive.domain-unsupported-operator-spec/1",
      dp1Supported: false,
      operators: [
        { id: "EVERY", status: "UNSUPPORTED", dp1Predicate: false },
        { id: "EXISTS", status: "UNSUPPORTED", dp1Predicate: false },
      ],
    },
  };
}

function planTiny(pack: CompiledDomainPack, artifacts = companionsFor(pack)) {
  const digests = Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, packDigest(value)])) as InvestigationPlanInput["digests"];
  return compileInvestigationPlan({ pack, artifacts, digests });
}

describe("investigation plan compiler", () => {
  it("plans a synthetic edition without hardcoded definition counts", () => {
    const pack = compileTiny();
    const result = planTiny(pack);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = result.value;
    expect(plan.accounting.definitionCount).toBe(pack.definitions.length);
    expect(plan.accounting.presentationCount + plan.accounting.investigationDefinitionCount).toBe(pack.definitions.length);
    expect(plan.applicability.jurisdictionEstablished).toBe(false);
    expect(plan.applicability.effectiveFrom).toBe("2020-01-01");
    expect(plan.pack.reviewStatus).toBe("DRAFT");
    expect(plan.pack.publication).toBe("UNPUBLISHED");
    expect(plan.ownership.scope).toBe("PRO");

    const span = plan.tasks.find((task) => task.definitionId === "calculation:span");
    expect(span).toMatchObject({ taskKind: "COMPUTE_DAYS_BETWEEN", join: null, joinGate: "PASSED", dp2Eligible: true, subjectEntityId: "entity:item" });
    expect(span?.coverage).toMatchObject({ population: "PER_SUBJECT_INSTANCE", requiredCases: PER_INSTANCE_CASES });
    expect(plan.dependencies.some((edge) => edge.toTaskId === span?.taskId && edge.reason === "declared_join")).toBe(false);

    const gap = plan.tasks.find((task) => task.definitionId === "calculation:gap");
    expect(gap).toMatchObject({ taskKind: "DECLARED_CALCULATION", dp2Eligible: false, joinGate: "NOT_APPLICABLE" });
    expect(gap?.join).toBeUndefined();

    const present = plan.tasks.find((task) => task.definitionId === "check:present");
    expect(present).toMatchObject({ taskKind: "EVALUATE_CHECK", dp2Eligible: true, subjectEntityId: "entity:item" });
    const cross = plan.tasks.find((task) => task.definitionId === "check:cross");
    expect(cross).toMatchObject({ taskKind: "EVALUATE_CHECK", dp2Eligible: false, joinGate: "RELATIONSHIP_UNDECLARED" });
    expect(cross?.reasonCodes).toContain("UNRESOLVED_SUBJECT");
    expect(cross?.subjectEntityId).toBeUndefined();

    const review = plan.tasks.find((task) => task.definitionId === "check:review");
    expect(review?.authorityKind).toBe("PROFESSIONAL_PRACTICE");
    expect(review?.authorities[0]).toMatchObject({
      practiceClass: "PROFESSIONAL_CRITERIA",
      role: "CLAIM_AUTHOR_PROPOSED",
      humanReview: "NOT_REVIEWED",
      unreviewed: true,
      heldAsLimitation: false,
    });
    expect(review?.reasonCodes).toContain("UNREVIEWED_AUTHORITY");

    const other = plan.tasks.find((task) => task.definitionId === "entity:other");
    expect(other?.factClass).toBeNull();
    expect(other?.reasonCodes).toContain("UNCLASSIFIED");
    expect(plan.tasks.find((task) => task.definitionId === "workflow:steps")?.taskKind).toBe("NOTE_EXCEPTION");
    expect(plan.tasks.filter((task) => task.sourceKind === "workflowCoverage" && task.deferred)).toHaveLength(1);
    expect(plan.tasks.filter((task) => task.taskKind === "NOTE_UNSUPPORTED").map((task) => task.operatorId).sort()).toEqual(["EVERY", "EXISTS"]);
    expect(plan.tasks.find((task) => task.definitionId === "stateOverlay:sample")?.comparisonRecorded).toBe(false);
    expect(JSON.stringify(plan)).not.toContain("ESTABLISHED");
  });

  it("keeps a disabled edition id accounted for and pins the upstream digest", () => {
    const base = compileTiny();
    const derived = compileTiny({
      schema: DOMAIN_PACK_SOURCE_SCHEMA,
      identity: { packId: "firm-example", version: "1.0.0", title: "Firm edition" },
      ownership: { scope: "FIRM", ownerId: "firm-1", authoredBy: "editor-1" },
      applicability: { jurisdiction: "neutral test jurisdiction", verification: "UNVERIFIED" },
      upstream: { packId: base.identity.packId, version: base.identity.version, digest: base.identity.digest },
      definitions: [],
      changes: [{ op: "disable", definitionId: "check:review", reason: "Not used in this practice" }],
      review: { status: "DRAFT" },
    }, base);
    const result = planTiny(derived);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.upstream).toEqual({ packId: base.identity.packId, version: base.identity.version, digest: base.identity.digest });
    expect(result.value.disabledDefinitionIds).toEqual(["check:review"]);
    expect(result.value.tasks.find((task) => task.definitionId === "check:review")).toMatchObject({
      taskKind: "DISABLED",
      dp2Eligible: false,
      disabledReason: "Not used in this practice",
    });
    expect(result.value.tasks.some((task) => task.definitionId === "check:review" && task.taskKind === "REVIEW_CHECK")).toBe(false);
  });

  it("rejects a digest mismatch, a missing artifact, a bad map, a bad direction, and a cycle", () => {
    const pack = compileTiny();
    const artifacts = companionsFor(pack);
    const digests = Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, packDigest(value)])) as InvestigationPlanInput["digests"];
    const mismatch = compileInvestigationPlan({ pack, artifacts, digests: { ...digests, ontology: "0".repeat(64) } });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.issues.some((item) => item.code === "digest_mismatch")).toBe(true);

    const missing = { ...artifacts, factClasses: undefined };
    const missingResult = compileInvestigationPlan({ pack, artifacts: missing as unknown as SupplementalArtifacts, digests });
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.issues.some((item) => item.code === "missing_artifact")).toBe(true);

    const brokenMap = structuredClone(artifacts);
    const register = brokenMap.authorityRegister as { authorities: Array<{ relatedDefinitionIds: string[] }> };
    register.authorities[0].relatedDefinitionIds = register.authorities[0].relatedDefinitionIds.filter((id) => id !== "check:review");
    const inverse = planTiny(pack, brokenMap);
    expect(inverse.ok).toBe(false);
    if (!inverse.ok) expect(inverse.issues.some((item) => item.code === "authority_inverse")).toBe(true);

    const unknownKey = structuredClone(artifacts);
    const map = (unknownKey.authorityRegister as { definitionAuthorityMap: Record<string, string[]> }).definitionAuthorityMap;
    map["check:not-compiled"] = ["AUTH-EXAMPLE"];
    const unknown = planTiny(pack, unknownKey);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues.some((item) => item.code === "authority_map_key")).toBe(true);

    const flipped = structuredClone(artifacts);
    const relationship = (flipped.ontology as { relationships: Array<{ fromEntityId: string; toEntityId: string }> }).relationships[0];
    [relationship.fromEntityId, relationship.toEntityId] = [relationship.toEntityId, relationship.fromEntityId];
    const direction = planTiny(pack, flipped);
    expect(direction.ok).toBe(false);
    if (!direction.ok) expect(direction.issues.some((item) => item.code === "relationship_direction")).toBe(true);

    const cycled = structuredClone(artifacts);
    const chains = (cycled.ontology as { chains: Array<{ id: string; relationshipIds: string[] }> }).chains;
    chains[0].relationshipIds = [chains[1].id];
    chains[1].relationshipIds = [chains[0].id];
    const cycle = planTiny(pack, cycled);
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.issues.some((item) => item.code === "dependency_cycle")).toBe(true);
  });

  it("does not embed a profession's identifiers in the compiler", () => {
    const source = readFileSync(new URL("./domain-investigation-plan.ts", import.meta.url), "utf8");
    expect(source).not.toContain("check:G2");
    expect(source).not.toContain("calculation:C1");
    expect(source).not.toMatch(/\b275\b/);
  });
});
