import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const ROOT = join(import.meta.dirname, "../../../../packs/drafts/iep-us-federal/v0.3.0");
const PINS = {
  ontology: "60e096187cbc44346ec78b76648edd4fcd159e407d0ec1d60000d62610455fd8",
  authorityRegister: "b7175fb6a54aa5085bbba9c63e9c0827fd4dab1858f12a5e25c36946c3018f74",
  conflictPatterns: "85586cfd6356397e775ed2e89f3a7c0b7f1c5c106e2111d308c5d6dd0fc1767f",
  stateOverlays: "928f6b91eb0baff422908aec0b5ac955403b8b1764539a6149c85c70043e787f",
  factClasses: "9ec53126bb258fbad2d956744b3681a20b93b830ef697cc1b627ef748a67b6b9",
  workflowCoverage: "1ec87d6129888c48aa96918178a854a1009c17a483b747aabec0e8d478774311",
  unsupportedOperators: "44f1e486331b68d09c03f1f9499e1808699e5aec9ecddea0b09e034b7e38389d",
} as const;

const JOINS = [
  ["calculation:C1", "relationship:consent-authorizes-evaluation"],
  ["calculation:C2", "relationship:eligibility-precedes-iep"],
  ["calculation:C3", "relationship:iep-contains-service"],
  ["calculation:C15", "relationship:notice-for-meeting"],
  ["calculation:C21", "relationship:evaluation-supports-eligibility"],
] as const;

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, name), "utf8")) as unknown;
}

function iepInput(): InvestigationPlanInput {
  const source = loadJson("iep-domain-pack-source.stage4b.json") as DomainPackSource;
  const compiled = compileDomainPack(source);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  return {
    pack: compiled.value,
    artifacts: {
      ontology: loadJson("iep-domain-ontology-spec.json"),
      authorityRegister: loadJson("iep-domain-authority-register.json"),
      conflictPatterns: loadJson("iep-domain-conflict-patterns.v1.json"),
      stateOverlays: loadJson("iep-domain-state-overlays.v1.json"),
      factClasses: loadJson("iep-domain-fact-classes.v1.json"),
      workflowCoverage: loadJson("iep-domain-workflow-coverage.v1.json"),
      unsupportedOperators: loadJson("iep-domain-unsupported-operators.v1.json"),
    },
    digests: PINS,
  };
}

function compileIep() {
  const result = compileInvestigationPlan(iepInput());
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

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
  it("plans a non-IEP edition without hardcoded definition counts", () => {
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
    expect(source).not.toContain("iep-us-federal");
    expect(source).not.toContain("check:G2");
    expect(source).not.toContain("calculation:C1");
    expect(source).not.toMatch(/\b275\b/);
  });
});

describe("IEP stage 4B investigation plan", () => {
  const plan = compileIep();

  it("pins the seven companion digests and compiles every definition once", () => {
    expect(plan.supplemental.items).toEqual([
      { schema: "hive.domain-conflict-pattern-spec/1", digest: PINS.conflictPatterns },
      { schema: "hive.domain-state-overlay-spec/1", digest: PINS.stateOverlays },
      { schema: "hive.domain-fact-class-spec/1", digest: PINS.factClasses },
      { schema: "hive.domain-workflow-coverage-spec/1", digest: PINS.workflowCoverage },
      { schema: "hive.domain-unsupported-operator-spec/1", digest: PINS.unsupportedOperators },
      { schema: "hive.domain-ontology-spec/1", digest: PINS.ontology },
      { schema: "hive.domain-authority-register/1", digest: PINS.authorityRegister },
    ]);
    expect(plan.accounting).toMatchObject({
      definitionCount: 275,
      presentationCount: 27,
      investigationDefinitionCount: 248,
      disabledCount: 0,
    });
    expect(plan.pack).toMatchObject({ packId: "iep-us-federal", version: "0.3.0", publication: "UNPUBLISHED", reviewStatus: "DRAFT" });
    expect(plan.applicability.verification).toBe("UNVERIFIED");
    const ids = new Set([...plan.presentation.map((row) => row.definitionId), ...plan.tasks.map((task) => task.definitionId)]);
    expect(ids.size).toBe(plan.presentation.length + plan.tasks.length);
    expect(plan.presentation).toHaveLength(27);
    expect(plan.presentation.every((row) => ["persona", "report", "term", "note", "guideline", "referenceTable"].includes(row.kind))).toBe(true);
  });

  it("counts tasks by the contracted kinds", () => {
    expect(plan.accounting.taskCounts).toMatchObject({
      BIND_ENTITY: 50,
      BIND_RELATIONSHIP: 39,
      BIND_DOCUMENT: 35,
      REVIEW_CHECK: 67,
      EVALUATE_CHECK: 0,
      DECLARED_CALCULATION: 16,
      COMPUTE_DAYS_BETWEEN: 7,
      TRACE_CHAIN: 7,
      ASK_QUESTION: 27,
      APPLY_CONFLICT_PATTERN: 14,
      NOTE_OVERLAY: 4,
      NOTE_EXCEPTION: 14,
      NOTE_UNSUPPORTED: 2,
      DISABLED: 0,
    });
    expect(plan.tasks.filter((task) => task.dp2Eligible).map((task) => task.definitionId).sort()).toEqual(
      ["calculation:C1", "calculation:C14", "calculation:C15", "calculation:C2", "calculation:C20", "calculation:C21", "calculation:C3"].sort(),
    );
    expect(plan.tasks.filter((task) => task.sourceKind === "workflowCoverage" && task.deferred).map((task) => task.definitionId).sort()).toEqual([
      "workflowCoverage:discipline",
      "workflowCoverage:preschool-part-c-transition",
    ]);
  });

  it("uses structured joins and authored direction, and ignores precondition prose", () => {
    const ontology = loadJson("iep-domain-ontology-spec.json") as { entities: Array<{ id: string; ruleIds?: string[] }> };
    const subjectsOf = (definitionId: string) => ontology.entities.filter((entity) => (entity.ruleIds ?? []).includes(definitionId)).map((entity) => entity.id).sort();
    expect(subjectsOf("calculation:C1")).toEqual(["entity:consent", "entity:evaluation"]);
    expect(subjectsOf("calculation:C2")).toEqual(["entity:eligibility-determination", "entity:iep"]);
    expect(subjectsOf("calculation:C15")).toEqual([]);
    expect(subjectsOf("calculation:C21")).toEqual([]);
    for (const [definitionId, relationshipId] of JOINS) {
      const task = plan.tasks.find((candidate) => candidate.definitionId === definitionId);
      expect(task?.join?.relationshipId).toBe(relationshipId);
      expect(task?.joinGate).toBe("PASSED");
      expect(task?.resultBinding).toEqual({
        relationshipId,
        fromEntityId: task?.join?.fromEntityId,
        toEntityId: task?.join?.toEntityId,
      });
      expect(task?.subjectEntityId === undefined || subjectsOf(definitionId).length === 1).toBe(true);
      expect(plan.dependencies.some((edge) => edge.toTaskId === task?.taskId && edge.fromTaskId === "task:" + relationshipId && edge.reason === "declared_join")).toBe(true);
    }
    for (const definitionId of ["calculation:C14", "calculation:C20"]) {
      const task = plan.tasks.find((candidate) => candidate.definitionId === definitionId);
      expect(task?.join).toBeNull();
      expect(task?.joinGate).toBe("PASSED");
      expect(task?.resultBinding).toBeUndefined();
      expect(task?.coverage).toMatchObject({ population: "PER_SUBJECT_INSTANCE", subjectEntityId: subjectsOf(definitionId)[0] });
      expect(plan.dependencies.some((edge) => edge.toTaskId === task?.taskId && edge.reason === "declared_join")).toBe(false);
    }
    const declared = plan.tasks.filter((task) => task.taskKind === "DECLARED_CALCULATION");
    expect(declared.every((task) => task.join === undefined && task.dp2Eligible === false)).toBe(true);
    expect(plan.tasks.find((task) => task.definitionId === "check:G2")).toMatchObject({
      taskKind: "REVIEW_CHECK",
      subjectEntityId: "entity:annual-goal",
      dp2Eligible: false,
      coverage: { population: "PER_SUBJECT_INSTANCE", subjectEntityId: "entity:annual-goal", requiredCases: PER_INSTANCE_CASES },
    });
  });

  it("is stable, and prose or proposed bindings do not change the digest", () => {
    const again = compileIep();
    expect(again.digest).toBe(plan.digest);
    expect(again.digest).toMatch(/^[a-f0-9]{64}$/);
    const input = iepInput();
    const ontology = structuredClone(input.artifacts.ontology) as { entities: unknown[]; calculations: Array<{ preconditions?: string[]; proposedBindings?: unknown; join?: unknown }> };
    ontology.entities.reverse();
    ontology.calculations.forEach((calculation) => {
      calculation.preconditions = ["relationship:not-a-declaration"];
      calculation.proposedBindings = [{ role: "start", entityId: "entity:student", fieldId: "displayName" }];
    });
    const mutated = compileInvestigationPlan({
      ...input,
      artifacts: { ...input.artifacts, ontology },
      digests: { ...input.digests, ontology: packDigest(ontology) },
    });
    expect(mutated.ok).toBe(true);
    if (mutated.ok) {
      expect(mutated.value.tasks).toEqual(plan.tasks);
      expect(mutated.value.dependencies).toEqual(plan.dependencies);
      expect(mutated.value.digest).not.toBe(plan.digest);
    }
  });

  it("keeps the seven proposed checks out of the plan", () => {
    const proposed = loadJson("iep-domain-proposed-checks.v1.json") as { proposals: Array<{ definitionId: string }> };
    expect(proposed.proposals).toHaveLength(7);
    const ids = new Set([...plan.presentation.map((row) => row.definitionId), ...plan.tasks.map((task) => task.definitionId), ...plan.uncompiledRuleIds]);
    for (const proposal of proposed.proposals) expect(ids.has(proposal.definitionId)).toBe(false);
    expect(plan.uncompiledRuleIds).toEqual(expect.arrayContaining(["check:PP1", "check:PR1", "check:PR2"]));
  });

  it("preserves authority limits and does not treat an empty gate as a conclusion", () => {
    const goal = plan.tasks.find((task) => task.definitionId === "check:G2a");
    const limit = goal?.authorities.find((authority) => authority.role === "LIMIT_DOES_NOT_LIST_FIVE_FIELDS");
    expect(limit).toMatchObject({ heldAsLimitation: true, unreviewed: true, humanReview: "NOT_REVIEWED" });
    expect((limit?.doesNotEstablish ?? "").length).toBeGreaterThan(0);
    expect(goal?.authorities.every((authority) => authority.unreviewed)).toBe(true);
    expect(plan.tasks.find((task) => task.definitionId === "check:IM1")?.authorities[0]?.practiceClass).toBe("AUTHOR_PROPOSED");
    expect(plan.tasks.every((task) => !("outcome" in task) && !("daysBetween" in task))).toBe(true);
  });

  it("rejects invalid mappings, missing references, the wrong join direction, and a mismatched digest", () => {
    const input = iepInput();
    const inverse = structuredClone(input.artifacts.authorityRegister) as {
      authorities: Array<{ authorityId: string; relatedDefinitionIds: string[] }>;
    };
    const record = inverse.authorities.find((authority) => authority.relatedDefinitionIds.includes("calculation:C1"));
    if (!record) throw new Error("missing C1 authority");
    record.relatedDefinitionIds = record.relatedDefinitionIds.filter((id) => id !== "calculation:C1");
    const inverseResult = compileInvestigationPlan({
      ...input,
      artifacts: { ...input.artifacts, authorityRegister: inverse },
      digests: { ...input.digests, authorityRegister: packDigest(inverse) },
    });
    expect(inverseResult.ok).toBe(false);
    if (!inverseResult.ok) expect(inverseResult.issues.some((item) => item.code === "authority_inverse")).toBe(true);

    const invented = structuredClone(input.artifacts.authorityRegister) as {
      definitionAuthorityMap: Record<string, string[]>;
      authorities: Array<{ authorityId: string; relatedDefinitionIds: string[] }>;
    };
    const authorityId = invented.authorities[0].authorityId;
    invented.definitionAuthorityMap["check:DS1"] = [authorityId];
    invented.authorities[0].relatedDefinitionIds = [...invented.authorities[0].relatedDefinitionIds, "check:DS1"];
    const inventedResult = compileInvestigationPlan({
      ...input,
      artifacts: { ...input.artifacts, authorityRegister: invented },
      digests: { ...input.digests, authorityRegister: packDigest(invented) },
    });
    expect(inventedResult.ok).toBe(false);
    if (!inventedResult.ok) expect(inventedResult.issues.some((item) => item.code === "authority_map_key")).toBe(true);

    const missingAuthority = structuredClone(input.artifacts.ontology) as { entities: Array<{ authorityIds?: string[] }> };
    missingAuthority.entities[0].authorityIds = [...(missingAuthority.entities[0].authorityIds ?? []), "AUTH-DOES-NOT-EXIST"];
    const missingResult = compileInvestigationPlan({
      ...input,
      artifacts: { ...input.artifacts, ontology: missingAuthority },
      digests: { ...input.digests, ontology: packDigest(missingAuthority) },
    });
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.issues.some((item) => item.code === "ontology_authority")).toBe(true);

    const wrongJoin = structuredClone(input.artifacts.ontology) as { calculations: Array<{ id: string; join?: { relationshipId: string } | null }> };
    const calculation = wrongJoin.calculations.find((item) => item.id === "calculation:C1");
    if (!calculation?.join) throw new Error("missing C1 join");
    calculation.join = { relationshipId: "relationship:evaluation-supports-eligibility" };
    const wrongResult = compileInvestigationPlan({
      ...input,
      artifacts: { ...input.artifacts, ontology: wrongJoin },
      digests: { ...input.digests, ontology: packDigest(wrongJoin) },
    });
    expect(wrongResult.ok).toBe(true);
    if (wrongResult.ok) {
      expect(wrongResult.value.tasks.find((task) => task.definitionId === "calculation:C1")).toMatchObject({
        joinGate: "RELATIONSHIP_UNDECLARED",
        dp2Eligible: false,
      });
      expect(wrongResult.value.tasks.find((task) => task.definitionId === "calculation:C1")?.join).toBeUndefined();
    }

    const droppedJoin = structuredClone(input.artifacts.ontology) as { calculations: Array<{ id: string; join?: unknown; preconditions?: string[] }> };
    const dropped = droppedJoin.calculations.find((item) => item.id === "calculation:C1");
    if (!dropped) throw new Error("missing C1");
    delete dropped.join;
    dropped.preconditions = ["relationship:consent-authorizes-evaluation"];
    const droppedResult = compileInvestigationPlan({
      ...input,
      artifacts: { ...input.artifacts, ontology: droppedJoin },
      digests: { ...input.digests, ontology: packDigest(droppedJoin) },
    });
    expect(droppedResult.ok).toBe(true);
    if (droppedResult.ok) {
      const task = droppedResult.value.tasks.find((item) => item.definitionId === "calculation:C1");
      expect(task?.joinGate).toBe("RELATIONSHIP_UNDECLARED");
      expect(task?.join).toBeUndefined();
    }

    const digestResult = compileInvestigationPlan({ ...input, digests: { ...input.digests, ontology: "ab".repeat(32) } });
    expect(digestResult.ok).toBe(false);
    if (!digestResult.ok) {
      expect(digestResult.issues.some((item) => item.code === "digest_mismatch")).toBe(true);
      expect("value" in digestResult).toBe(false);
    }
  });
});
