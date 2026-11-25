import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack } from "./domain-pack-compiler";
import { legacyPackToEditableSource } from "./domain-pack-legacy-adapter";
import {
  evaluateDomainRules,
  VERIFIED_CASE_FACTS_SCHEMA,
  type DomainRuleEvaluation,
  type DomainRuleResult,
  type VerifiedCaseFacts,
  type VerifiedFact,
  type VerifiedScalar,
} from "./domain-pack-rules";
import { parsePackMarkdown } from "./pack-contracts";
import { DOMAIN_PACK_SOURCE_SCHEMA, type CompiledDomainPack, type DomainPackSource, type PackPredicate } from "./domain-pack-source";

const GOAL = "entity:goal";
const CASE = "entity:case";
const GOAL_FIELDS = ["baseline", "target", "measurementMethod", "masteryCriterion", "date"] as const;

function compile(source: DomainPackSource, upstream?: CompiledDomainPack): CompiledDomainPack {
  const result = compileDomainPack(source, upstream);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function numbersEqual(left: string, right: string): PackPredicate {
  return {
    op: "COMPARE",
    left: { ref: "LITERAL", valueType: "NUMBER", value: left },
    comparator: "EQ",
    right: { ref: "LITERAL", valueType: "NUMBER", value: right },
  };
}

function present(fields: readonly string[]): PackPredicate {
  return { op: "ALL", conditions: fields.map((fieldId) => ({ op: "FIELD_PRESENT", entityId: GOAL, fieldId })) };
}

function deadline(limit: string, jurisdiction?: string): PackPredicate {
  return {
    op: "COMPARE",
    left: { ref: "CALCULATION", calculationId: "calculation:C1" },
    comparator: "LTE",
    right: {
      ref: "LITERAL",
      valueType: "NUMBER",
      value: limit,
      ...(jurisdiction ? { jurisdiction } : {}),
    },
  };
}

function recordSource(options?: {
  verification?: "REVIEWED" | "UNVERIFIED";
  jurisdiction?: string;
  limit?: string;
  limitJurisdiction?: string | null;
}): DomainPackSource {
  const jurisdiction = options?.jurisdiction ?? "US-federal";
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "platform/record-review", version: "1.0.0", title: "Record review" },
    ownership: { scope: "PLATFORM", ownerId: "platform", authoredBy: "rules-test" },
    applicability: { jurisdiction, verification: options?.verification ?? "REVIEWED" },
    definitions: [
      {
        id: GOAL, kind: "entity", label: "Goal",
        fields: [
          { id: "baseline", valueType: "TEXT" },
          { id: "target", valueType: "TEXT" },
          { id: "measurementMethod", valueType: "TEXT" },
          { id: "masteryCriterion", valueType: "TEXT" },
          { id: "date", valueType: "DATE" },
        ],
      },
      {
        id: CASE, kind: "entity", label: "Case",
        fields: [
          { id: "consentDate", valueType: "DATE" },
          { id: "evaluationCompleted", valueType: "DATE" },
        ],
      },
      {
        id: "document:report", kind: "document", label: "Report", aliases: [],
        appliesWhen: { op: "REVIEW_REQUIRED" }, settlesCheckIds: [],
      },
      {
        id: "calculation:C1", kind: "calculation", label: "Days between two dates",
        operator: "DAYS_BETWEEN", inputFields: ["start", "end"], state: "EXECUTABLE",
        bindings: [
          { role: "start", entityId: CASE, fieldId: "consentDate" },
          { role: "end", entityId: CASE, fieldId: "evaluationCompleted" },
        ],
      },
      { id: "check:G2", kind: "check", label: "Required parts of one record", criterion: present(GOAL_FIELDS) },
      {
        id: "check:T2", kind: "check", label: "Within an explicit limit",
        criterion: deadline(options?.limit ?? "60", options?.limitJurisdiction === null ? undefined : options?.limitJurisdiction ?? jurisdiction),
      },
      { id: "check:D1", kind: "check", label: "Report is present", criterion: { op: "DOCUMENT_PRESENT", documentKindId: "document:report" } },
    ],
    changes: [],
    review: { status: "REVIEWED", reviewerId: "reviewer-1", reviewedAt: "2026-01-15" },
  };
}

function scalar(fieldId: string, value: string, valueType?: VerifiedScalar["valueType"]): VerifiedScalar {
  if (valueType === "NUMBER") return { valueType: "NUMBER", value };
  if (valueType === "TEXT") return { valueType: "TEXT", value };
  if (valueType === "BOOLEAN") return { valueType: "BOOLEAN", value };
  if (fieldId === "date" || fieldId === "consentDate" || fieldId === "evaluationCompleted" || fieldId === "occurred") {
    return { valueType: "DATE", value };
  }
  return { valueType: "TEXT", value };
}

function fact(id: string, entityId: string, instanceId: string, fieldId: string, value: string, valueType?: VerifiedScalar["valueType"]): VerifiedFact {
  return {
    id, status: "VERIFIED", entityId, instanceId, fieldId,
    value: scalar(fieldId, value, valueType),
    sourceRefs: [{ documentId: "doc-" + instanceId, page: "1" }],
  };
}

function goalFacts(instanceId: string, omit: readonly string[] = []): VerifiedFact[] {
  const values: Record<string, string> = {
    baseline: "12", target: "40", measurementMethod: "weekly probe",
    masteryCriterion: "three consecutive", date: "2024-06-01",
  };
  return GOAL_FIELDS.filter((fieldId) => !omit.includes(fieldId)).map((fieldId) =>
    fact(instanceId + "-" + fieldId, GOAL, instanceId, fieldId, values[fieldId]));
}

function caseFacts(instanceId: string, start: string, end?: string): VerifiedFact[] {
  const facts = [fact(instanceId + "-start", CASE, instanceId, "consentDate", start)];
  if (end !== undefined) facts.push(fact(instanceId + "-end", CASE, instanceId, "evaluationCompleted", end));
  return facts;
}

function evidence(facts: VerifiedFact[], extra: Partial<VerifiedCaseFacts> = {}): VerifiedCaseFacts {
  return {
    schema: VERIFIED_CASE_FACTS_SCHEMA,
    coverage: "COMPLETE",
    facts,
    documents: [],
    relationships: [],
    conflicts: [],
    ...extra,
  };
}

function run(pack: CompiledDomainPack, facts: VerifiedCaseFacts): Extract<DomainRuleEvaluation, { ok: true }> {
  const evaluation = evaluateDomainRules(pack, facts);
  if (!evaluation.ok) throw new Error(JSON.stringify(evaluation.issues));
  return evaluation;
}

function row(evaluation: Extract<DomainRuleEvaluation, { ok: true }>, ruleId: string, instanceId?: string | null): DomainRuleResult {
  const found = evaluation.results.filter((result) => result.ruleId === ruleId && (instanceId === undefined || result.instanceId === instanceId));
  expect(found, ruleId + " " + String(instanceId)).toHaveLength(1);
  return found[0];
}

describe("deterministic domain rules", () => {
  const pack = compile(recordSource());

  it("establishes a record only when every required part belongs to that same instance", () => {
    const evaluation = run(pack, evidence([...goalFacts("g1"), ...goalFacts("g2", GOAL_FIELDS.filter((field) => field !== "baseline"))]));
    const complete = row(evaluation, "check:G2", "g1");
    const partial = row(evaluation, "check:G2", "g2");
    expect(complete.outcome).toBe("ESTABLISHED");
    expect(complete.supportingFactIds).toEqual(["g1-baseline", "g1-date", "g1-masteryCriterion", "g1-measurementMethod", "g1-target"]);
    expect(complete.sourceRefs).toEqual([{ documentId: "doc-g1", page: "1" }]);
    expect(partial.outcome).toBe("NOT_ESTABLISHED");
    expect(partial.outcome).not.toBe("NOT_SATISFIED");
    expect(partial.missingRequirements).toContain("field:entity:goal/masteryCriterion");
    expect(partial.supportingFactIds.every((id) => id.startsWith("g2-"))).toBe(true);
  });

  it("calculates civil days and applies a deadline only for an explicit reviewed jurisdiction", () => {
    const onLimit = run(pack, evidence(caseFacts("c1", "2024-01-01", "2024-03-01")));
    expect(row(onLimit, "calculation:C1", "c1")).toMatchObject({ outcome: "COMPUTED", daysBetween: "60", operator: "DAYS_BETWEEN" });
    expect(row(onLimit, "check:T2", "c1").outcome).toBe("ESTABLISHED");
    const over = run(pack, evidence(caseFacts("c1", "2024-01-01", "2024-03-02")));
    expect(row(over, "calculation:C1", "c1").daysBetween).toBe("61");
    expect(row(over, "check:T2", "c1").outcome).toBe("NOT_SATISFIED");
    expect(row(over, "check:T2", "c1").reasonCodes).toContain("COMPARE_FAILS");
  });

  it("uses calendar-day subtraction, including leap days and reversed dates", () => {
    const cases: Array<[string, string, string]> = [
      ["2024-01-01", "2024-01-01", "0"],
      ["2024-02-28", "2024-03-01", "2"],
      ["2023-02-28", "2023-03-01", "1"],
      ["2024-03-01", "2024-02-28", "-2"],
      ["2024-01-01", "2024-02-15", "45"],
    ];
    for (const [start, end, days] of cases) {
      const evaluation = run(pack, evidence(caseFacts("c1", start, end)));
      expect(row(evaluation, "calculation:C1", "c1").daysBetween).toBe(days);
    }
  });

  it("treats a missing part as not established, not as proof it is absent", () => {
    const evaluation = run(pack, evidence(goalFacts("g1", ["masteryCriterion"])));
    const goal = row(evaluation, "check:G2", "g1");
    expect(goal.outcome).toBe("NOT_ESTABLISHED");
    expect(goal.reasonCodes).toContain("FIELD_MISSING");
    expect(goal.reasonCodes).not.toContain("COMPARE_FAILS");
    const negated = compile({
      ...recordSource(),
      definitions: [
        ...recordSource().definitions.filter((definition) => definition.id !== "check:G2"),
        { id: "check:absent", kind: "check", label: "A part is not recorded", criterion: { op: "NOT", condition: { op: "FIELD_PRESENT", entityId: GOAL, fieldId: "masteryCriterion" } } },
      ],
    });
    const denial = row(run(negated, evidence(goalFacts("g1", ["masteryCriterion"]))), "check:absent", "g1");
    expect(denial.outcome).toBe("NOT_ESTABLISHED");
    expect(denial.reasonCodes).toContain("NEGATION_OF_UNKNOWN");
  });

  it("does not turn incomplete coverage into a compliance conclusion", () => {
    const evaluation = run(pack, evidence(caseFacts("c1", "2024-01-01", "2024-01-11"), { coverage: "INCOMPLETE" }));
    expect(row(evaluation, "check:T2", "c1").outcome).toBe("NOT_ESTABLISHED");
    expect(row(evaluation, "check:T2", "c1").reasonCodes).toContain("INCOMPLETE_COVERAGE");
    expect(row(evaluation, "calculation:C1", "c1")).toMatchObject({ outcome: "COMPUTED", daysBetween: "10" });
    expect(row(evaluation, "calculation:C1", "c1").reasonCodes).toContain("INCOMPLETE_COVERAGE");
  });

  it("stops on conflicting values and on a declared conflict", () => {
    const first = fact("c1-a", CASE, "c1", "consentDate", "2024-01-01");
    const second = fact("c1-b", CASE, "c1", "consentDate", "2024-01-20");
    const conflicted = run(pack, evidence([first, second, fact("c1-end", CASE, "c1", "evaluationCompleted", "2024-02-01")]));
    expect(row(conflicted, "calculation:C1", "c1").outcome).toBe("CONFLICT");
    expect(row(conflicted, "calculation:C1", "c1").daysBetween).toBeUndefined();
    expect(row(conflicted, "check:T2", "c1").outcome).toBe("CONFLICT");
    expect(row(conflicted, "calculation:C1", "c1").supportingFactIds).toEqual(expect.arrayContaining(["c1-a", "c1-b"]));
    const declared = run(pack, evidence(caseFacts("c1", "2024-01-01", "2024-02-01"), {
      conflicts: [{ entityId: CASE, instanceId: "c1", fieldId: "consentDate" }],
    }));
    expect(row(declared, "calculation:C1", "c1").outcome).toBe("CONFLICT");
    expect(row(declared, "calculation:C1", "c1").daysBetween).toBeUndefined();
  });

  it("does not coerce an incompatible or impossible value", () => {
    const textDate = fact("c1-start", CASE, "c1", "consentDate", "2024-01-15", "TEXT");
    const typed = run(pack, evidence([textDate, fact("c1-end", CASE, "c1", "evaluationCompleted", "2024-02-01")]));
    expect(row(typed, "calculation:C1", "c1").outcome).toBe("NOT_EVALUATED");
    expect(row(typed, "calculation:C1", "c1").reasonCodes).toContain("TYPE_MISMATCH");
    expect(row(typed, "calculation:C1", "c1").daysBetween).toBeUndefined();
    const impossible = run(pack, evidence(caseFacts("c1", "2024-02-31", "2024-03-02")));
    expect(row(impossible, "calculation:C1", "c1").reasonCodes).toContain("DATE_INVALID");
    expect(row(impossible, "calculation:C1", "c1").daysBetween).toBeUndefined();
    const prose = run(pack, evidence(caseFacts("c1", "01/15/2024", "2024-02-01")));
    expect(row(prose, "calculation:C1", "c1").daysBetween).toBeUndefined();
  });

  it("does not satisfy one check by combining unrelated records", () => {
    const split = run(pack, evidence([
      ...goalFacts("g1", ["target", "measurementMethod", "masteryCriterion", "date"]),
      ...goalFacts("g2", ["baseline"]),
      ...caseFacts("c1", "2024-01-01"),
      ...caseFacts("c2", "2024-01-01", "2024-02-01").filter((item) => item.fieldId === "evaluationCompleted"),
    ]));
    expect(row(split, "check:G2", "g1").outcome).toBe("NOT_ESTABLISHED");
    expect(row(split, "check:G2", "g2").outcome).toBe("NOT_ESTABLISHED");
    expect(split.results.filter((result) => result.ruleId === "check:G2" && result.outcome === "ESTABLISHED")).toHaveLength(0);
    expect(row(split, "calculation:C1", "c1").daysBetween).toBeUndefined();
    expect(row(split, "calculation:C1", "c2").daysBetween).toBeUndefined();

    const unrelated = compile({
      ...recordSource(),
      definitions: recordSource().definitions.map((definition) => definition.id === "calculation:C1" && definition.kind === "calculation"
        ? {
            ...definition,
            bindings: [
              { role: "start", entityId: GOAL, fieldId: "date" },
              { role: "end", entityId: CASE, fieldId: "consentDate" },
            ],
          }
        : definition),
    });
    const crossed = run(unrelated, evidence([...goalFacts("g1"), ...caseFacts("c1", "2024-01-01", "2024-02-01")]));
    const crossedDays = crossed.results.find((result) => result.ruleId === "calculation:C1");
    expect(crossedDays?.outcome).toBe("NOT_EVALUATED");
    expect(crossedDays?.reasonCodes).toContain("CROSS_ENTITY");
    expect(crossedDays?.daysBetween).toBeUndefined();
  });

  it("joins only instances connected by a sourced relationship", () => {
    const source = recordSource();
    source.definitions.push(
      { id: "entity:notice", kind: "entity", label: "Notice", fields: [{ id: "occurred", valueType: "DATE" }] },
      { id: "entity:completion", kind: "entity", label: "Completion", fields: [{ id: "occurred", valueType: "DATE" }] },
      { id: "relationship:follows", kind: "relationship", label: "Follows", fromEntityId: "entity:notice", toEntityId: "entity:completion", evidenceRequired: true },
      {
        id: "calculation:span", kind: "calculation", label: "Span", operator: "DAYS_BETWEEN",
        inputFields: ["start", "end"], state: "EXECUTABLE",
        bindings: [
          { role: "start", entityId: "entity:notice", fieldId: "occurred" },
          { role: "end", entityId: "entity:completion", fieldId: "occurred" },
        ],
      },
      {
        id: "check:span", kind: "check", label: "Short span",
        criterion: {
          op: "COMPARE",
          left: { ref: "CALCULATION", calculationId: "calculation:span" },
          comparator: "LTE",
          right: { ref: "LITERAL", valueType: "NUMBER", value: "10", jurisdiction: "US-federal" },
        },
      },
    );
    const joined = compile(source);
    const evaluation = run(joined, evidence([
      fact("n1", "entity:notice", "n1", "occurred", "2024-01-01"),
      fact("c1", "entity:completion", "c1", "occurred", "2024-01-05"),
      fact("n2", "entity:notice", "n2", "occurred", "2024-02-01"),
      fact("c2", "entity:completion", "c2", "occurred", "2024-06-01"),
    ], {
      relationships: [
        { id: "link-1", status: "VERIFIED", relationshipId: "relationship:follows", fromInstanceId: "n1", toInstanceId: "c1", sourceRefs: [{ documentId: "doc-link", page: "3" }] },
        { id: "link-2", status: "VERIFIED", relationshipId: "relationship:follows", fromInstanceId: "n2", toInstanceId: "c2", sourceRefs: [] },
      ],
    }));
    const spans = evaluation.results.filter((result) => result.ruleId === "calculation:span");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ outcome: "COMPUTED", daysBetween: "4" });
    expect(spans[0].supportingFactIds).toEqual(["c1", "link-1", "n1"]);
    expect(evaluation.results.filter((result) => result.ruleId === "check:span" && result.outcome === "ESTABLISHED")).toHaveLength(1);
    expect(evaluation.results.some((result) => result.daysBetween !== undefined && result.daysBetween !== "4")).toBe(false);
  });

  it("lets a professional edition override a criterion without a core change", () => {
    const base = compile(recordSource());
    const edition = compile({
      schema: DOMAIN_PACK_SOURCE_SCHEMA,
      identity: { packId: "pro-a/record-review", version: "1.0.0", title: "Practice record review" },
      ownership: { scope: "PRO", ownerId: "pro-a", authoredBy: "pro-a" },
      applicability: { jurisdiction: "US-federal", verification: "REVIEWED" },
      upstream: { packId: base.identity.packId, version: base.identity.version, digest: base.identity.digest },
      definitions: [],
      changes: [
        {
          op: "replace", definitionId: "check:G2", reason: "Practice records mastery inside the measurement method",
          definition: { id: "check:G2", kind: "check", label: "Required parts of one record", criterion: present(["baseline", "target", "measurementMethod", "date"]) },
        },
        {
          op: "replace", definitionId: "check:T2", reason: "Practice adopted a shorter reviewed limit",
          definition: { id: "check:T2", kind: "check", label: "Within the practice limit", criterion: deadline("30", "US-federal") },
        },
      ],
      review: { status: "REVIEWED", reviewerId: "pro-a", reviewedAt: "2026-02-01" },
    }, base);
    const goals = evidence(goalFacts("g1", ["masteryCriterion"]));
    expect(row(run(base, goals), "check:G2", "g1").outcome).toBe("NOT_ESTABLISHED");
    expect(row(run(edition, goals), "check:G2", "g1").outcome).toBe("ESTABLISHED");
    const fortyFive = evidence(caseFacts("c1", "2024-01-01", "2024-02-15"));
    expect(row(run(base, fortyFive), "check:T2", "c1").outcome).toBe("ESTABLISHED");
    expect(row(run(edition, fortyFive), "check:T2", "c1").outcome).toBe("NOT_SATISFIED");
    expect(edition.ownership.scope).toBe("PRO");
  });

  it("does not apply a deadline when jurisdiction is unknown, mismatched, or omitted", () => {
    const unverified = compile(recordSource({ verification: "UNVERIFIED" }));
    const late = evidence(caseFacts("c1", "2024-01-01", "2024-03-31"));
    const blocked = run(unverified, late);
    expect(row(blocked, "calculation:C1", "c1")).toMatchObject({ outcome: "COMPUTED", daysBetween: "90" });
    expect(row(blocked, "check:T2", "c1").outcome).toBe("NOT_EVALUATED");
    expect(row(blocked, "check:T2", "c1").reasonCodes).toContain("JURISDICTION_UNESTABLISHED");
    expect(row(blocked, "check:T2", "c1").outcome).not.toBe("NOT_SATISFIED");
    const mismatched = compile(recordSource({ limitJurisdiction: "US-CA" }));
    expect(row(run(mismatched, late), "check:T2", "c1").reasonCodes).toContain("JURISDICTION_MISMATCH");
    const omitted = compile(recordSource({ limitJurisdiction: null }));
    expect(row(run(omitted, late), "check:T2", "c1").reasonCodes).toContain("JURISDICTIONAL_RULE_UNESTABLISHED");
  });

  it("does not read free-text labels or estimate an unsupported calculation", () => {
    const labels = compile({
      ...recordSource(),
      definitions: [
        ...recordSource().definitions.filter((definition) => definition.kind === "entity"),
        { id: "check:labels", kind: "check", label: "Untyped compare", criterion: { op: "COMPARE", left: "baseline", comparator: "LT", right: "target" } },
      ],
    });
    const labeled = row(run(labels, evidence(goalFacts("g1"))), "check:labels");
    expect(labeled.outcome).toBe("NOT_EVALUATED");
    expect(labeled.reasonCodes).toContain("OPERAND_UNTYPED");
    expect(labeled.supportingFactIds).toEqual([]);
    const difference = compile({
      ...recordSource(),
      definitions: [
        { id: "entity:amount", kind: "entity", label: "Amount", fields: [{ id: "left", valueType: "NUMBER" }, { id: "right", valueType: "NUMBER" }] },
        {
          id: "calculation:diff", kind: "calculation", label: "Difference", operator: "DIFFERENCE",
          inputFields: ["left", "right"], state: "EXECUTABLE",
          bindings: [
            { role: "left", entityId: "entity:amount", fieldId: "left" },
            { role: "right", entityId: "entity:amount", fieldId: "right" },
          ],
        },
      ],
    });
    const diff = row(run(difference, evidence([
      fact("a-left", "entity:amount", "a", "left", "10", "NUMBER"),
      fact("a-right", "entity:amount", "a", "right", "3", "NUMBER"),
    ])), "calculation:diff");
    expect(diff.outcome).toBe("NOT_EVALUATED");
    expect(diff.reasonCodes).toContain("CALCULATION_UNSUPPORTED");
    expect(diff.daysBetween).toBeUndefined();
    expect(diff.supportingFactIds).toEqual([]);
    const unbound = compile({
      ...recordSource(),
      definitions: recordSource().definitions.map((definition) => {
        if (definition.id !== "calculation:C1" || definition.kind !== "calculation") return definition;
        const { bindings: _bindings, ...rest } = definition;
        return { ...rest, inputFields: ["consentDate", "evaluationCompleted"] };
      }),
    });
    const ignored = row(run(unbound, evidence(caseFacts("c1", "2024-01-01", "2024-02-01"))), "calculation:C1");
    expect(ignored.reasonCodes).toContain("OPERAND_UNTYPED");
    expect(ignored.daysBetween).toBeUndefined();
    expect(ignored.supportingFactIds).toEqual([]);
  });

  it("never turns review-required into a positive verdict", () => {
    const source = recordSource();
    source.definitions.push(
      { id: "check:manual", kind: "check", label: "Manual", criterion: { op: "REVIEW_REQUIRED" } },
      { id: "check:all-review", kind: "check", label: "All review", criterion: { op: "ALL", conditions: [{ op: "REVIEW_REQUIRED" }, { op: "FIELD_PRESENT", entityId: GOAL, fieldId: "baseline" }] } },
      { id: "check:any-review", kind: "check", label: "Any review", criterion: { op: "ANY", conditions: [{ op: "REVIEW_REQUIRED" }, { op: "FIELD_PRESENT", entityId: GOAL, fieldId: "baseline" }] } },
      { id: "check:not-review", kind: "check", label: "Not review", criterion: { op: "NOT", condition: { op: "REVIEW_REQUIRED" } } },
    );
    const evaluation = run(compile(source), evidence(goalFacts("g1")));
    for (const ruleId of ["check:manual", "check:all-review", "check:not-review"]) {
      expect(row(evaluation, ruleId).outcome).not.toBe("ESTABLISHED");
      expect(row(evaluation, ruleId).reasonCodes).toContain("REVIEW_REQUIRED");
    }
    expect(row(evaluation, "check:any-review", "g1").outcome).toBe("ESTABLISHED");
    expect(row(evaluation, "check:any-review", "g1").supportingFactIds).toEqual(["g1-baseline"]);
  });

  it("requires a sourced document and does not treat a sourceless fact as a claim", () => {
    const missing = row(run(pack, evidence([])), "check:D1");
    expect(missing.outcome).toBe("NOT_ESTABLISHED");
    expect(missing.reasonCodes).toContain("DOCUMENT_MISSING");
    const presentDocument = run(pack, evidence([], {
      documents: [
        { id: "other", status: "VERIFIED", documentKindId: "document:other", sourceRefs: [{ documentId: "doc-x" }] },
        { id: "report", status: "VERIFIED", documentKindId: "document:report", sourceRefs: [{ documentId: "doc-report", page: "4" }] },
      ],
    }));
    expect(row(presentDocument, "check:D1")).toMatchObject({
      outcome: "ESTABLISHED",
      supportingFactIds: ["report"],
      sourceRefs: [{ documentId: "doc-report", page: "4" }],
    });
    const unsourced = goalFacts("g1").map((item) => item.fieldId === "baseline" ? { ...item, sourceRefs: [] } : item);
    const evaluation = run(pack, evidence(unsourced));
    expect(row(evaluation, "check:G2", "g1").outcome).toBe("NOT_ESTABLISHED");
    expect(row(evaluation, "check:G2", "g1").reasonCodes).toContain("SOURCE_MISSING");
  });

  it("rejects unverified input instead of evaluating it", () => {
    const facts = evidence(goalFacts("g1"));
    const unverified = { ...facts, facts: [{ ...facts.facts[0], status: "MODEL" }] };
    const result = evaluateDomainRules(pack, unverified as VerifiedCaseFacts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "unverified_input")).toBe(true);
  });

  it("does not give legacy imported packs an automatic positive verdict", () => {
    const root = join(import.meta.dirname, "../../../../packs");
    const names = readdirSync(root).filter((name) => name.endsWith(".md"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const parsed = parsePackMarkdown(readFileSync(join(root, name), "utf8"));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const imported = legacyPackToEditableSource(parsed.value, { scope: "PLATFORM", ownerId: "platform", authoredBy: "rules-test" });
      expect(imported.ok).toBe(true);
      if (!imported.ok) continue;
      const compiled = compile(imported.source);
      const evaluation = run(compiled, evidence([]));
      expect(evaluation.results.some((result) => result.outcome === "ESTABLISHED" || result.outcome === "COMPUTED")).toBe(false);
      expect(evaluation.results.filter((result) => result.kind === "check").every((result) => result.reasonCodes.includes("REVIEW_REQUIRED"))).toBe(true);
    }
  });

  it("does not turn a literal or a relationship into a verdict", () => {
    const source = recordSource();
    source.definitions.push(
      { id: "entity:notice", kind: "entity", label: "Notice", fields: [{ id: "occurred", valueType: "DATE" }, { id: "label", valueType: "TEXT" }] },
      { id: "entity:completion", kind: "entity", label: "Completion", fields: [{ id: "occurred", valueType: "DATE" }, { id: "label", valueType: "TEXT" }] },
      { id: "relationship:follows", kind: "relationship", label: "Follows", fromEntityId: "entity:notice", toEntityId: "entity:completion", evidenceRequired: true },
      {
        id: "check:any-literal", kind: "check", label: "Any literal",
        criterion: {
          op: "ANY",
          conditions: [
            numbersEqual("1", "1"),
            { op: "FIELD_PRESENT", entityId: "entity:notice", fieldId: "occurred" },
            { op: "FIELD_PRESENT", entityId: "entity:completion", fieldId: "occurred" },
          ],
        },
      },
      {
        id: "check:all-literal", kind: "check", label: "All literal",
        criterion: {
          op: "ALL",
          conditions: [
            numbersEqual("1", "2"),
            { op: "FIELD_PRESENT", entityId: "entity:notice", fieldId: "occurred" },
            { op: "FIELD_PRESENT", entityId: "entity:completion", fieldId: "occurred" },
          ],
        },
      },
      {
        id: "check:not-literal", kind: "check", label: "Not a literal",
        criterion: {
          op: "NOT",
          condition: {
            op: "ANY",
            conditions: [
              numbersEqual("1", "1"),
              { op: "FIELD_PRESENT", entityId: "entity:notice", fieldId: "occurred" },
              { op: "FIELD_PRESENT", entityId: "entity:completion", fieldId: "occurred" },
            ],
          },
        },
      },
      {
        id: "check:all-evidenced", kind: "check", label: "All with a real miss",
        criterion: {
          op: "ALL",
          conditions: [
            numbersEqual("1", "2"),
            { op: "FIELD_PRESENT", entityId: "entity:notice", fieldId: "occurred" },
            { op: "FIELD_PRESENT", entityId: "entity:completion", fieldId: "occurred" },
          ],
        },
      },
      { id: "check:bare-any", kind: "check", label: "Bare true literal", criterion: { op: "ANY", conditions: [numbersEqual("1", "1")] } },
      { id: "check:bare-all", kind: "check", label: "Bare false literal", criterion: { op: "ALL", conditions: [numbersEqual("1", "2")] } },
    );
    const joined = compile(source);
    const anchors = evidence([
      fact("n1-label", "entity:notice", "n1", "label", "notice"),
      fact("c1-label", "entity:completion", "c1", "label", "done"),
    ], {
      relationships: [{
        id: "link-1", status: "VERIFIED", relationshipId: "relationship:follows",
        fromInstanceId: "n1", toInstanceId: "c1", sourceRefs: [{ documentId: "doc-link", page: "3" }],
      }],
    });
    const evaluation = run(joined, anchors);
    for (const ruleId of ["check:any-literal", "check:all-literal", "check:not-literal"]) {
      const result = row(evaluation, ruleId);
      expect(result.outcome).toBe("NOT_EVALUATED");
      expect(result.reasonCodes).toContain("SOURCE_MISSING");
      expect(result.supportingFactIds.filter((id) => id !== "link-1")).toEqual([]);
    }
    expect(row(evaluation, "check:any-literal").outcome).not.toBe("ESTABLISHED");
    expect(row(evaluation, "check:all-literal").outcome).not.toBe("NOT_SATISFIED");
    expect(row(evaluation, "check:not-literal").outcome).not.toBe("NOT_SATISFIED");
    expect(row(evaluation, "check:bare-any").outcome).toBe("NOT_EVALUATED");
    expect(row(evaluation, "check:bare-all").outcome).toBe("NOT_EVALUATED");

    const recorded = run(joined, evidence([
      fact("n1-occurred", "entity:notice", "n1", "occurred", "2024-01-01"),
      fact("c1-occurred", "entity:completion", "c1", "occurred", "2024-01-09"),
    ], {
      relationships: [{
        id: "link-1", status: "VERIFIED", relationshipId: "relationship:follows",
        fromInstanceId: "n1", toInstanceId: "c1", sourceRefs: [{ documentId: "doc-link", page: "3" }],
      }],
    }));
    const negative = row(recorded, "check:all-evidenced");
    expect(negative.outcome).toBe("NOT_SATISFIED");
    expect(negative.reasonCodes).toContain("COMPARE_FAILS");
    expect(negative.supportingFactIds).toEqual(expect.arrayContaining(["c1-occurred", "n1-occurred"]));
  });

  it("returns one unevaluated result when one relationship joins the same instances more than once", () => {
    const source = recordSource();
    source.definitions.push(
      { id: "entity:notice", kind: "entity", label: "Notice", fields: [{ id: "occurred", valueType: "DATE" }] },
      { id: "entity:completion", kind: "entity", label: "Completion", fields: [{ id: "occurred", valueType: "DATE" }] },
      { id: "relationship:follows", kind: "relationship", label: "Follows", fromEntityId: "entity:notice", toEntityId: "entity:completion", evidenceRequired: true },
      {
        id: "calculation:span", kind: "calculation", label: "Span", operator: "DAYS_BETWEEN",
        inputFields: ["start", "end"], state: "EXECUTABLE",
        bindings: [
          { role: "start", entityId: "entity:notice", fieldId: "occurred" },
          { role: "end", entityId: "entity:completion", fieldId: "occurred" },
        ],
      },
      {
        id: "check:span", kind: "check", label: "Short span",
        criterion: {
          op: "COMPARE",
          left: { ref: "CALCULATION", calculationId: "calculation:span" },
          comparator: "LTE",
          right: { ref: "LITERAL", valueType: "NUMBER", value: "10", jurisdiction: "US-federal" },
        },
      },
      {
        id: "check:same-day", kind: "check", label: "Same day",
        criterion: {
          op: "COMPARE",
          left: { ref: "FIELD", entityId: "entity:notice", fieldId: "occurred" },
          comparator: "EQ",
          right: { ref: "FIELD", entityId: "entity:completion", fieldId: "occurred" },
        },
      },
    );
    const evaluation = run(compile(source), evidence([
      fact("n1-occurred", "entity:notice", "n1", "occurred", "2024-01-01"),
      fact("c1-occurred", "entity:completion", "c1", "occurred", "2024-01-05"),
      fact("n2-occurred", "entity:notice", "n2", "occurred", "2024-02-01"),
      fact("c2-occurred", "entity:completion", "c2", "occurred", "2024-02-11"),
    ], {
      relationships: [
        { id: "link-a", status: "VERIFIED", relationshipId: "relationship:follows", fromInstanceId: "n1", toInstanceId: "c1", sourceRefs: [{ documentId: "doc-a", page: "1" }] },
        { id: "link-b", status: "VERIFIED", relationshipId: "relationship:follows", fromInstanceId: "n1", toInstanceId: "c1", sourceRefs: [{ documentId: "doc-b", page: "2" }] },
        { id: "link-c", status: "VERIFIED", relationshipId: "relationship:follows", fromInstanceId: "n2", toInstanceId: "c2", sourceRefs: [{ documentId: "doc-c", page: "3" }] },
        { id: "link-unsourced", status: "VERIFIED", relationshipId: "relationship:follows", fromInstanceId: "n2", toInstanceId: "c2", sourceRefs: [] },
      ],
    }));
    const spans = evaluation.results.filter((result) => result.ruleId === "calculation:span");
    expect(spans).toHaveLength(2);
    const ambiguousSpan = spans.find((result) => result.instances.some((item) => item.instanceId === "n1"));
    const clearSpan = spans.find((result) => result.instances.some((item) => item.instanceId === "n2"));
    expect(ambiguousSpan).toMatchObject({ outcome: "NOT_EVALUATED", supportingFactIds: ["link-a", "link-b"] });
    expect(ambiguousSpan?.reasonCodes).toContain("AMBIGUOUS_RELATIONSHIP");
    expect(ambiguousSpan?.daysBetween).toBeUndefined();
    expect(ambiguousSpan?.sourceRefs).toEqual([{ documentId: "doc-a", page: "1" }, { documentId: "doc-b", page: "2" }]);
    expect(clearSpan).toMatchObject({ outcome: "COMPUTED", daysBetween: "10", supportingFactIds: ["c2-occurred", "link-c", "n2-occurred"] });
    expect(evaluation.results.some((result) => result.daysBetween === "4")).toBe(false);

    const spanChecks = evaluation.results.filter((result) => result.ruleId === "check:span");
    expect(spanChecks).toHaveLength(2);
    const ambiguousCheck = spanChecks.find((result) => result.instances.some((item) => item.instanceId === "n1"));
    const clearCheck = spanChecks.find((result) => result.instances.some((item) => item.instanceId === "n2"));
    expect(ambiguousCheck?.outcome).toBe("NOT_EVALUATED");
    expect(ambiguousCheck?.reasonCodes).toContain("AMBIGUOUS_RELATIONSHIP");
    expect(ambiguousCheck?.daysBetween).toBeUndefined();
    expect(clearCheck?.outcome).toBe("ESTABLISHED");
    expect(clearCheck?.supportingFactIds).toEqual(expect.arrayContaining(["c2-occurred", "link-c", "n2-occurred"]));

    const comparisons = evaluation.results.filter((result) => result.ruleId === "check:same-day");
    expect(comparisons).toHaveLength(2);
    const ambiguousCompare = comparisons.find((result) => result.instances.some((item) => item.instanceId === "n1"));
    const clearCompare = comparisons.find((result) => result.instances.some((item) => item.instanceId === "n2"));
    expect(ambiguousCompare?.outcome).toBe("NOT_EVALUATED");
    expect(ambiguousCompare?.reasonCodes).toContain("AMBIGUOUS_RELATIONSHIP");
    expect(clearCompare?.outcome).toBe("NOT_SATISFIED");
    expect(clearCompare?.supportingFactIds).toEqual(["c2-occurred", "link-c", "n2-occurred"]);
  });

  it("keeps the joining relationship on a direct field comparison", () => {
    const source = recordSource();
    source.definitions.push(
      { id: "entity:notice", kind: "entity", label: "Notice", fields: [{ id: "occurred", valueType: "DATE" }] },
      { id: "entity:completion", kind: "entity", label: "Completion", fields: [{ id: "occurred", valueType: "DATE" }] },
      { id: "relationship:follows", kind: "relationship", label: "Follows", fromEntityId: "entity:notice", toEntityId: "entity:completion", evidenceRequired: true },
      {
        id: "check:same-day", kind: "check", label: "Same day",
        criterion: {
          op: "COMPARE",
          left: { ref: "FIELD", entityId: "entity:notice", fieldId: "occurred" },
          comparator: "EQ",
          right: { ref: "FIELD", entityId: "entity:completion", fieldId: "occurred" },
        },
      },
      {
        id: "check:not-same-day", kind: "check", label: "Not the same day",
        criterion: {
          op: "NOT",
          condition: {
            op: "COMPARE",
            left: { ref: "FIELD", entityId: "entity:notice", fieldId: "occurred" },
            comparator: "EQ",
            right: { ref: "FIELD", entityId: "entity:completion", fieldId: "occurred" },
          },
        },
      },
    );
    const joined = compile(source);
    const links = {
      relationships: [{
        id: "link-1", status: "VERIFIED" as const, relationshipId: "relationship:follows",
        fromInstanceId: "n1", toInstanceId: "c1", sourceRefs: [{ documentId: "doc-link", page: "3" }],
      }],
    };
    const same = row(run(joined, evidence([
      fact("n1-occurred", "entity:notice", "n1", "occurred", "2024-01-05"),
      fact("c1-occurred", "entity:completion", "c1", "occurred", "2024-01-05"),
    ], links)), "check:same-day");
    expect(same.outcome).toBe("ESTABLISHED");
    expect(same.supportingFactIds).toEqual(["c1-occurred", "link-1", "n1-occurred"]);
    expect(same.sourceRefs).toEqual([
      { documentId: "doc-c1", page: "1" },
      { documentId: "doc-link", page: "3" },
      { documentId: "doc-n1", page: "1" },
    ]);
    const denied = row(run(joined, evidence([
      fact("n1-occurred", "entity:notice", "n1", "occurred", "2024-01-05"),
      fact("c1-occurred", "entity:completion", "c1", "occurred", "2024-01-05"),
    ], links)), "check:not-same-day");
    expect(denied.outcome).toBe("NOT_SATISFIED");
    expect(denied.supportingFactIds).toEqual(["c1-occurred", "link-1", "n1-occurred"]);
    expect(denied.sourceRefs).toEqual(same.sourceRefs);
  });

  it("keeps domain vocabulary out of the evaluator", () => {
    const source = readFileSync(new URL("./domain-pack-rules.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bIEP\b|\bWCPM\b|300\.320|300\.301/);
  });
});
