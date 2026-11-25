import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack, packDigest } from "../domain-pack-compiler";
import {
  compileInvestigationPlan,
  PER_INSTANCE_CASES,
  type InvestigationPlanInput,
} from "../domain-investigation-plan";
import type { DomainPackSource } from "../domain-pack-source";

const ROOT = join(import.meta.dirname, "../../../../../packs/drafts/iep-us-federal/v0.3.0");
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

describe("investigation plan compiler source", () => {
  it("does not embed the draft pack id", () => {
    const source = readFileSync(new URL("../domain-investigation-plan.ts", import.meta.url), "utf8");
    expect(source).not.toContain("iep-us-federal");
  });
});
