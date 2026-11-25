import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack } from "./domain-pack-compiler";
import {
  evaluateDomainRules,
  VERIFIED_CASE_FACTS_SCHEMA,
  type DomainRuleEvaluation,
  type DomainRuleResult,
  type VerifiedCaseFacts,
  type VerifiedFact,
  type VerifiedRelationshipFact,
} from "./domain-pack-rules";
import type { CompiledDomainPack, DomainPackSource, PackDefinition } from "./domain-pack-source";

const ROOT = join(import.meta.dirname, "../../../../packs/drafts/iep-us-federal/v0.3.0");

type Endpoint = { entityId: string; fieldId: string };
type CalculationSpec = {
  id: string;
  /** Null when both dates belong to one entity instance. */
  relationshipId: string | null;
  start: Endpoint;
  end: Endpoint;
};

const SPECS: readonly CalculationSpec[] = [
  {
    id: "calculation:C1",
    relationshipId: "relationship:consent-authorizes-evaluation",
    start: { entityId: "entity:consent", fieldId: "receivedDate" },
    end: { entityId: "entity:evaluation", fieldId: "completionDate" },
  },
  {
    id: "calculation:C2",
    relationshipId: "relationship:eligibility-precedes-iep",
    start: { entityId: "entity:eligibility-determination", fieldId: "determinationDate" },
    end: { entityId: "entity:iep", fieldId: "meetingDate" },
  },
  {
    id: "calculation:C3",
    relationshipId: "relationship:iep-contains-service",
    start: { entityId: "entity:iep", fieldId: "meetingDate" },
    end: { entityId: "entity:service", fieldId: "startDate" },
  },
  {
    id: "calculation:C14",
    relationshipId: null,
    start: { entityId: "entity:records-request", fieldId: "requestDate" },
    end: { entityId: "entity:records-request", fieldId: "responseDate" },
  },
  {
    id: "calculation:C15",
    relationshipId: "relationship:notice-for-meeting",
    start: { entityId: "entity:meeting-notice", fieldId: "noticeDate" },
    end: { entityId: "entity:iep-meeting", fieldId: "meetingDate" },
  },
  {
    id: "calculation:C20",
    relationshipId: null,
    start: { entityId: "entity:iee-request", fieldId: "requestDate" },
    end: { entityId: "entity:iee-request", fieldId: "agencyResponseDate" },
  },
  {
    id: "calculation:C21",
    relationshipId: "relationship:evaluation-supports-eligibility",
    start: { entityId: "entity:evaluation", fieldId: "completionDate" },
    end: { entityId: "entity:eligibility-determination", fieldId: "determinationDate" },
  },
];

const ACTIVATED = new Set(SPECS.map((spec) => spec.id));

function loadSource(fileName: string): DomainPackSource {
  return JSON.parse(readFileSync(join(ROOT, fileName), "utf8")) as DomainPackSource;
}

function compile(source: DomainPackSource): CompiledDomainPack {
  const result = compileDomainPack(source);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function dateFact(id: string, endpoint: Endpoint, instanceId: string, value: string, documentId: string, page: string): VerifiedFact {
  return {
    id,
    status: "VERIFIED",
    entityId: endpoint.entityId,
    instanceId,
    fieldId: endpoint.fieldId,
    value: { valueType: "DATE", value },
    sourceRefs: [{ documentId, page }],
  };
}

function textFact(id: string, entityId: string, instanceId: string, fieldId: string, documentId: string): VerifiedFact {
  return {
    id,
    status: "VERIFIED",
    entityId,
    instanceId,
    fieldId,
    value: { valueType: "TEXT", value: "recorded" },
    sourceRefs: [{ documentId, page: "5" }],
  };
}

function relationshipFact(id: string, relationshipId: string, fromInstanceId: string, toInstanceId: string, documentId: string, page: string): VerifiedRelationshipFact {
  return {
    id,
    status: "VERIFIED",
    relationshipId,
    fromInstanceId,
    toInstanceId,
    sourceRefs: [{ documentId, page }],
  };
}

function evidence(facts: VerifiedFact[], relationships: VerifiedRelationshipFact[] = []): VerifiedCaseFacts {
  return {
    schema: VERIFIED_CASE_FACTS_SCHEMA,
    coverage: "COMPLETE",
    facts,
    documents: [],
    relationships,
    conflicts: [],
  };
}

function run(pack: CompiledDomainPack, facts: VerifiedCaseFacts): Extract<DomainRuleEvaluation, { ok: true }> {
  const evaluation = evaluateDomainRules(pack, facts);
  if (!evaluation.ok) throw new Error(JSON.stringify(evaluation.issues));
  return evaluation;
}

function rowsFor(evaluation: Extract<DomainRuleEvaluation, { ok: true }>, ruleId: string): DomainRuleResult[] {
  return evaluation.results.filter((result) => result.ruleId === ruleId);
}

function instancesOf(pairs: { entityId: string; instanceId: string }[]): { entityId: string; instanceId: string }[] {
  return [...pairs].sort((left, right) => left.entityId.localeCompare(right.entityId));
}

function sortedRefs(refs: { documentId: string; page: string }[]): { documentId: string; page: string }[] {
  return [...refs].sort((left, right) => (left.documentId + left.page).localeCompare(right.documentId + right.page));
}

function span(spec: CalculationSpec, prefix: string, start: string, end: string | null): {
  facts: VerifiedFact[];
  startInstance: string;
  endInstance: string;
} {
  const sameInstance = spec.relationshipId === null;
  const startInstance = sameInstance ? prefix : prefix + "-from";
  const endInstance = sameInstance ? prefix : prefix + "-to";
  const facts = [dateFact(prefix + "-start", spec.start, startInstance, start, prefix + "-start-doc", "1")];
  if (end !== null) facts.push(dateFact(prefix + "-end", spec.end, endInstance, end, prefix + "-end-doc", "2"));
  return { facts, startInstance, endInstance };
}

function joinPair(spec: CalculationSpec, prefix: string, startInstance: string, endInstance: string, suffix = ""): VerifiedRelationshipFact {
  if (!spec.relationshipId) throw new Error(spec.id + " has no relationship");
  return relationshipFact(prefix + "-link" + suffix, spec.relationshipId, startInstance, endInstance, prefix + "-link-doc" + suffix, suffix === "" ? "3" : "4");
}

const stage4a = loadSource("iep-domain-pack-source.stage4a.json");
const stage4b = loadSource("iep-domain-pack-source.stage4b.json");
const pack = compile(stage4b);

describe("IEP stage 4B day counts", () => {
  it("activates only the seven Stage 4A field bindings", () => {
    const reconciliation = JSON.parse(readFileSync(join(ROOT, "iep-domain-reconciliation.stage4a.json"), "utf8")) as {
      daysBetweenCandidates: { id: string; requiredBindings: { role: string; entityId: string; fieldId: string }[] }[];
    };
    expect(reconciliation.daysBetweenCandidates.map((candidate) => candidate.id).sort()).toEqual([...ACTIVATED].sort());
    expect(stage4b.definitions).toHaveLength(275);
    expect(stage4b.identity).toMatchObject({ packId: "iep-us-federal", version: "0.3.0" });
    expect(stage4b.ownership).toEqual(stage4a.ownership);
    expect(stage4b.applicability).toEqual(stage4a.applicability);
    expect(stage4b.review).toEqual({ status: "DRAFT" });
    expect(stage4b.changes).toEqual(stage4a.changes);
    expect(stage4b.definitions.filter((definition) => !ACTIVATED.has(definition.id))).toEqual(
      stage4a.definitions.filter((definition) => !ACTIVATED.has(definition.id)),
    );

    const calculations = stage4b.definitions.filter((definition) => definition.kind === "calculation");
    expect(calculations).toHaveLength(23);
    expect(calculations.filter((definition) => definition.state === "EXECUTABLE").map((definition) => definition.id).sort()).toEqual([...ACTIVATED].sort());

    for (const spec of SPECS) {
      const before = stage4a.definitions.find((definition) => definition.id === spec.id);
      const after = stage4b.definitions.find((definition) => definition.id === spec.id);
      expect(before?.kind).toBe("calculation");
      if (before?.kind !== "calculation" || after?.kind !== "calculation") throw new Error(spec.id);
      expect(before.state).toBe("DECLARATION_ONLY");
      expect(before.bindings).toBeUndefined();
      const bindings = [
        { role: "start", entityId: spec.start.entityId, fieldId: spec.start.fieldId },
        { role: "end", entityId: spec.end.entityId, fieldId: spec.end.fieldId },
      ];
      expect(after).toEqual({ ...before, state: "EXECUTABLE", inputFields: ["start", "end"], bindings });
      const candidate = reconciliation.daysBetweenCandidates.find((item) => item.id === spec.id);
      expect(candidate?.requiredBindings.map(({ role, entityId, fieldId }) => ({ role, entityId, fieldId }))).toEqual(bindings);
      expect(fieldValueType(pack, spec.start)).toBe("DATE");
      expect(fieldValueType(pack, spec.end)).toBe("DATE");
      expect(relationshipsBetween(pack, spec.start.entityId, spec.end.entityId).map((definition) => definition.id)).toEqual(
        spec.relationshipId ? [spec.relationshipId] : [],
      );
      if (spec.relationshipId) {
        expect(pack.definitions.find((definition) => definition.id === spec.relationshipId)).toMatchObject({
          kind: "relationship",
          fromEntityId: spec.start.entityId,
          toEntityId: spec.end.entityId,
          evidenceRequired: true,
        });
      }
    }
  });

  it("keeps checks review-required, authorities unreviewed, and publication disabled", () => {
    const checks = stage4b.definitions.filter((definition) => definition.kind === "check");
    expect(checks).toHaveLength(67);
    expect(checks.every((definition) => definition.kind === "check" && definition.criterion.op === "REVIEW_REQUIRED")).toBe(true);
    expect(pack.publication).toBe("UNPUBLISHED");
    expect(pack.applicability.verification).toBe("UNVERIFIED");
    expect(pack.review).toEqual({ status: "DRAFT" });
    for (const definition of stage4b.definitions) {
      if (!definition.authority) continue;
      expect(definition.authority.reviewedBy).toBeUndefined();
      expect(definition.authority.reviewedAt).toBeUndefined();
    }
    const register = JSON.parse(readFileSync(join(ROOT, "iep-domain-authority-register.json"), "utf8")) as {
      status: string;
      authorities: { humanReview: string }[];
    };
    expect(register.status).toContain("Not human-reviewed");
    expect(register.authorities).toHaveLength(149);
    expect(register.authorities.every((authority) => authority.humanReview === "NOT_REVIEWED")).toBe(true);

    const spec = SPECS[0];
    const built = span(spec, "p1", "2024-01-01", "2024-01-11");
    const evaluation = run(pack, evidence(built.facts, [joinPair(spec, "p1", built.startInstance, built.endInstance)]));
    const checkResults = evaluation.results.filter((result) => result.kind === "check");
    expect(checkResults).toHaveLength(67);
    expect(checkResults.every((result) => result.outcome === "NOT_EVALUATED" && result.reasonCodes.includes("REVIEW_REQUIRED"))).toBe(true);
    expect(checkResults.some((result) => result.outcome === "ESTABLISHED" || result.outcome === "NOT_SATISFIED" || result.daysBetween !== undefined)).toBe(false);
    expect(rowsFor(evaluation, spec.id)[0]).toMatchObject({ outcome: "COMPUTED", daysBetween: "10" });
  });

  it("does not execute the other sixteen calculations", () => {
    const dormant = pack.definitions.filter((definition) => definition.kind === "calculation" && !ACTIVATED.has(definition.id));
    expect(dormant).toHaveLength(16);
    const evaluation = run(pack, evidence([]));
    for (const definition of dormant) {
      if (definition.kind !== "calculation") continue;
      expect(definition.state).toBe("DECLARATION_ONLY");
      const rows = rowsFor(evaluation, definition.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe("NOT_EVALUATED");
      expect(rows[0].reasonCodes).toContain("CALCULATION_NOT_EXECUTABLE");
      expect(rows[0].daysBetween).toBeUndefined();
    }
    expect(evaluation.results.some((result) => result.outcome === "COMPUTED" || result.outcome === "ESTABLISHED")).toBe(false);
  });

  describe.each(SPECS)("$id", (spec) => {
    it("computes the cited day count and keeps the field and relationship sources", () => {
      const built = span(spec, "p1", "2024-01-01", "2024-01-11");
      const links = spec.relationshipId ? [joinPair(spec, "p1", built.startInstance, built.endInstance)] : [];
      const rows = rowsFor(run(pack, evidence(built.facts, links)), spec.id);
      expect(rows).toHaveLength(1);
      const supportingFactIds = spec.relationshipId
        ? ["p1-end", "p1-link", "p1-start"]
        : ["p1-end", "p1-start"];
      const sourceRefs = sortedRefs([
        { documentId: "p1-end-doc", page: "2" },
        { documentId: "p1-start-doc", page: "1" },
        ...(spec.relationshipId ? [{ documentId: "p1-link-doc", page: "3" }] : []),
      ]);
      expect(rows[0]).toMatchObject({
        outcome: "COMPUTED",
        daysBetween: "10",
        operator: "DAYS_BETWEEN",
        instanceId: spec.relationshipId ? null : "p1",
        instances: instancesOf(spec.relationshipId
          ? [
              { entityId: spec.start.entityId, instanceId: built.startInstance },
              { entityId: spec.end.entityId, instanceId: built.endInstance },
            ]
          : [{ entityId: spec.start.entityId, instanceId: "p1" }]),
        supportingFactIds,
        sourceRefs,
      });
      expect(rows[0].reasonCodes).toContain("CALCULATION_COMPUTED");
    });

    it("returns NOT_EVALUATED when a date is missing", () => {
      const built = span(spec, "p1", "2024-01-01", null);
      const facts = [...built.facts];
      if (spec.relationshipId) {
        facts.push(textFact("p1-anchor", spec.end.entityId, built.endInstance, textField(pack, spec.end), "p1-anchor-doc"));
      }
      const links = spec.relationshipId ? [joinPair(spec, "p1", built.startInstance, built.endInstance)] : [];
      const rows = rowsFor(run(pack, evidence(facts, links)), spec.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe("NOT_EVALUATED");
      expect(rows[0].reasonCodes).toContain("FIELD_MISSING");
      expect(rows[0].daysBetween).toBeUndefined();
      expect(rows[0].missingRequirements).toContain("field:" + spec.end.entityId + "/" + spec.end.fieldId);
      expect(rows[0].supportingFactIds).toEqual(spec.relationshipId ? ["p1-link", "p1-start"] : ["p1-start"]);
      expect(rows[0].sourceRefs).toEqual(sortedRefs([
        { documentId: "p1-start-doc", page: "1" },
        ...(spec.relationshipId ? [{ documentId: "p1-link-doc", page: "3" }] : []),
      ]));
    });

    it("does not count days when the relationship between the same instances is duplicated", () => {
      if (!spec.relationshipId) {
        const first = span(spec, "p1", "2024-01-01", "2024-01-11");
        const second = span(spec, "p2", "2024-06-01", "2024-06-15");
        const duplicate = [
          relationshipFact("extra-a", "relationship:iep-supersedes-iep", "p1", "p2", "doc-extra-a", "3"),
          relationshipFact("extra-b", "relationship:iep-supersedes-iep", "p1", "p2", "doc-extra-b", "4"),
        ];
        const rows = rowsFor(run(pack, evidence([...first.facts, ...second.facts], duplicate)), spec.id);
        expect(rows).toHaveLength(2);
        expect(rows.map((result) => result.daysBetween).sort()).toEqual(["10", "14"]);
        expect(rows.every((result) => result.outcome === "COMPUTED")).toBe(true);
        expect(rows.some((result) => result.reasonCodes.includes("AMBIGUOUS_RELATIONSHIP"))).toBe(false);
        expect(rows.find((result) => result.instanceId === "p1")?.supportingFactIds).toEqual(["p1-end", "p1-start"]);
        expect(rows.find((result) => result.instanceId === "p2")?.supportingFactIds).toEqual(["p2-end", "p2-start"]);
        return;
      }
      const built = span(spec, "p1", "2024-01-01", "2024-01-11");
      const links = [
        joinPair(spec, "p1", built.startInstance, built.endInstance, "-a"),
        joinPair(spec, "p1", built.startInstance, built.endInstance, "-b"),
      ];
      const rows = rowsFor(run(pack, evidence(built.facts, links)), spec.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe("NOT_EVALUATED");
      expect(rows[0].reasonCodes).toContain("AMBIGUOUS_RELATIONSHIP");
      expect(rows[0].daysBetween).toBeUndefined();
      expect(rows[0].supportingFactIds).toEqual(["p1-link-a", "p1-link-b"]);
      expect(rows[0].sourceRefs).toEqual([
        { documentId: "p1-link-doc-a", page: "4" },
        { documentId: "p1-link-doc-b", page: "4" },
      ]);
    });

    it("does not join another instance by entity type or by nearby dates", () => {
      const first = span(spec, "p1", "2024-01-01", "2024-01-11");
      const second = span(spec, "p2", "2024-06-01", "2024-06-15");
      const nearby = span(spec, "p3", "2024-01-01", spec.relationshipId ? "2024-01-02" : null);
      const links = spec.relationshipId
        ? [
            joinPair(spec, "p1", first.startInstance, first.endInstance),
            joinPair(spec, "p2", second.startInstance, second.endInstance),
          ]
        : [];
      const rows = rowsFor(run(pack, evidence([...first.facts, ...second.facts, ...nearby.facts], links)), spec.id);
      if (spec.relationshipId) {
        expect(rows).toHaveLength(2);
        expect(rows.map((result) => result.daysBetween).sort()).toEqual(["10", "14"]);
        expect(rows.every((result) => result.outcome === "COMPUTED")).toBe(true);
        const alone = span(spec, "p3", "2024-01-01", "2024-01-02");
        const unmatched = rowsFor(run(pack, evidence(alone.facts)), spec.id);
        expect(unmatched).toHaveLength(1);
        expect(unmatched[0].outcome).toBe("NOT_EVALUATED");
        expect(unmatched[0].reasonCodes).toContain("CROSS_ENTITY");
        expect(unmatched[0].daysBetween).toBeUndefined();
        return;
      }
      expect(rows).toHaveLength(3);
      const byInstance = new Map(rows.map((result) => [result.instanceId, result]));
      expect(byInstance.get("p1")).toMatchObject({ outcome: "COMPUTED", daysBetween: "10", supportingFactIds: ["p1-end", "p1-start"] });
      expect(byInstance.get("p2")).toMatchObject({ outcome: "COMPUTED", daysBetween: "14", supportingFactIds: ["p2-end", "p2-start"] });
      expect(byInstance.get("p3")?.outcome).toBe("NOT_EVALUATED");
      expect(byInstance.get("p3")?.reasonCodes).toContain("FIELD_MISSING");
      expect(byInstance.get("p3")?.daysBetween).toBeUndefined();
      expect(rows.some((result) => result.daysBetween !== undefined && result.daysBetween !== "10" && result.daysBetween !== "14")).toBe(false);
    });
  });
});

function textField(compiled: CompiledDomainPack, endpoint: Endpoint): string {
  const entity = compiled.definitions.find((definition) => definition.id === endpoint.entityId && definition.kind === "entity");
  if (entity?.kind !== "entity") throw new Error(endpoint.entityId);
  const field = entity.fields.find((item) => item.id !== endpoint.fieldId && item.valueType === "TEXT");
  if (!field) throw new Error(endpoint.entityId + " has no text field");
  return field.id;
}

function fieldValueType(compiled: CompiledDomainPack, endpoint: Endpoint): string | undefined {
  const entity = compiled.definitions.find((definition) => definition.id === endpoint.entityId && definition.kind === "entity");
  if (entity?.kind !== "entity") return undefined;
  return entity.fields.find((field) => field.id === endpoint.fieldId)?.valueType;
}

function relationshipsBetween(compiled: CompiledDomainPack, left: string, right: string): PackDefinition[] {
  return compiled.definitions.filter((definition) => definition.kind === "relationship" && (
    (definition.fromEntityId === left && definition.toEntityId === right) ||
    (definition.fromEntityId === right && definition.toEntityId === left)
  ));
}
