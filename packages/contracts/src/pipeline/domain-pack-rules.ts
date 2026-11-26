/**
 * DP-2 deterministic rule evaluator.
 * It reads one compiled Domain Pack and one set of verified case facts.
 * It does not read model output, free-text field names, or legacy prose.
 * A positive check verdict is ESTABLISHED. COMPUTED is an exact calculation
 * value and is never a compliance verdict. REVIEW_REQUIRED cannot become one.
 */
import {
  compareDecimal,
  decimalFromPlain,
  evaluateFormula,
  formatDecimal,
  type Decimal,
} from "../analysis/decimal-formula";
import {
  DOMAIN_PACK_RUNTIME_SCHEMA,
  INTERVAL_UNITS,
  calculationFieldBindings,
  type CompiledDomainPack,
  type EffectiveDefinition,
  type FieldValueType,
  type PackCalculationBinding,
  type PackCalculationOperator,
  type PackLiteralCalculationBinding,
  type PackOperand,
  type PackPredicate,
} from "./domain-pack-source";

export const VERIFIED_CASE_FACTS_SCHEMA = "hive.verified-case-facts/1" as const;
export const DOMAIN_PACK_RULE_EVALUATION_SCHEMA = "hive.domain-pack-rule-evaluation/1" as const;

export const DOMAIN_RULE_REASON_CODES = [
  "FIELD_PRESENT",
  "FIELD_MISSING",
  "DOCUMENT_PRESENT",
  "DOCUMENT_MISSING",
  "COMPARE_HOLDS",
  "COMPARE_FAILS",
  "REVIEW_REQUIRED",
  "OPERAND_UNTYPED",
  "TYPE_MISMATCH",
  "DATE_INVALID",
  "CONFLICTING_EVIDENCE",
  "SOURCE_MISSING",
  "INCOMPLETE_COVERAGE",
  "JURISDICTION_UNESTABLISHED",
  "JURISDICTION_MISMATCH",
  "JURISDICTIONAL_RULE_UNESTABLISHED",
  "CALCULATION_UNSUPPORTED",
  "CALCULATION_NOT_EXECUTABLE",
  "CALCULATION_COMPUTED",
  "PERIOD_INVALID",
  "REFERENCE_UNAVAILABLE",
  "CROSS_ENTITY",
  "AMBIGUOUS_RELATIONSHIP",
  "NO_INSTANCE",
  "NEGATION_OF_UNKNOWN",
] as const;
export type DomainRuleReasonCode = (typeof DOMAIN_RULE_REASON_CODES)[number];

export type DomainRuleOutcome =
  | "ESTABLISHED"
  | "NOT_ESTABLISHED"
  | "NOT_SATISFIED"
  | "CONFLICT"
  | "NOT_EVALUATED"
  | "COMPUTED";

export type VerifiedSourceRef = { documentId: string; page?: string; excerptId?: string };

export type VerifiedScalar =
  | { valueType: "TEXT"; value: string }
  | { valueType: "NUMBER"; value: string }
  | { valueType: "DATE"; value: string }
  | { valueType: "BOOLEAN"; value: string }
  | { valueType: "MONEY"; value: string; currency: string }
  | { valueType: "QUANTITY"; value: string; unit: string };

export type VerifiedFact = {
  id: string;
  status: "VERIFIED";
  entityId: string;
  instanceId: string;
  fieldId: string;
  value: VerifiedScalar;
  sourceRefs: VerifiedSourceRef[];
};

export type VerifiedDocumentFact = {
  id: string;
  status: "VERIFIED";
  documentKindId: string;
  subject?: { entityId: string; instanceId: string };
  sourceRefs: VerifiedSourceRef[];
};

export type VerifiedRelationshipFact = {
  id: string;
  status: "VERIFIED";
  relationshipId: string;
  fromInstanceId: string;
  toInstanceId: string;
  sourceRefs: VerifiedSourceRef[];
};

export type VerifiedFieldConflict = { entityId: string; instanceId: string; fieldId: string };

export type VerifiedCaseFacts = {
  schema: typeof VERIFIED_CASE_FACTS_SCHEMA;
  coverage: "COMPLETE" | "INCOMPLETE";
  facts: VerifiedFact[];
  documents: VerifiedDocumentFact[];
  relationships: VerifiedRelationshipFact[];
  conflicts: VerifiedFieldConflict[];
};

export type DomainRuleResult = {
  kind: "check" | "calculation";
  ruleId: string;
  instanceId: string | null;
  instances: { entityId: string; instanceId: string }[];
  outcome: DomainRuleOutcome;
  supportingFactIds: string[];
  sourceRefs: VerifiedSourceRef[];
  missingRequirements: string[];
  reasonCodes: DomainRuleReasonCode[];
  operator?: PackCalculationOperator;
  daysBetween?: string;
  computedValue?: string;
  computedUnit?: string;
};

export type DomainRuleIssue = { code: string; path: string; message: string };
export type DomainRuleEvaluation =
  | {
      ok: true;
      schema: typeof DOMAIN_PACK_RULE_EVALUATION_SCHEMA;
      packId: string;
      packDigest: string;
      results: DomainRuleResult[];
    }
  | { ok: false; issues: DomainRuleIssue[] };

type Canonical =
  | { valueType: "NUMBER"; decimal: Decimal }
  | { valueType: "DATE"; decimal: Decimal }
  | { valueType: "TEXT"; text: string }
  | { valueType: "BOOLEAN"; text: "true" | "false" }
  | { valueType: "MONEY"; decimal: Decimal; currency: string }
  | { valueType: "QUANTITY"; decimal: Decimal; unit: string };

type PartialEval = {
  outcome: DomainRuleOutcome;
  factIds: string[];
  sourceRefs: VerifiedSourceRef[];
  missing: string[];
  reasons: DomainRuleReasonCode[];
  daysBetween?: string;
  computedValue?: string;
  computedUnit?: string;
  scalar?: Canonical;
};

type InstancePlan = {
  instances: Map<string, string>;
  supportFactIds: string[];
  supportRefs: VerifiedSourceRef[];
  /** Several sourced facts join this same relationship and these same endpoints. */
  ambiguous?: boolean;
};

type EvidenceIndex = {
  facts: VerifiedFact[];
  documents: VerifiedDocumentFact[];
  relationships: VerifiedRelationshipFact[];
  conflicts: Set<string>;
  instances: Map<string, string[]>;
};

const CHECK_OUTCOMES = new Set<DomainRuleOutcome>([
  "ESTABLISHED", "NOT_ESTABLISHED", "NOT_SATISFIED", "CONFLICT", "NOT_EVALUATED",
]);

function fail(code: string, path: string, message: string): DomainRuleIssue {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: DomainRuleIssue[]): void {
  const ok = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!ok.has(key)) issues.push(fail("unknown_field", path + "." + key, "Field is not part of the verified-fact contract."));
  }
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sourced(refs: readonly VerifiedSourceRef[]): boolean {
  return refs.some((ref) => nonempty(ref.documentId));
}

function fieldKey(entityId: string, instanceId: string, fieldId: string): string {
  return entityId + "\0" + instanceId + "\0" + fieldId;
}

function requirementField(entityId: string, fieldId: string): string {
  return "field:" + entityId + "/" + fieldId;
}

/** Civil day index. Invalid calendar dates and non-midnight instants do not roll forward. */
export function calendarDayIndex(iso: string): bigint | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  if (!Number.isSafeInteger(utc) || utc % 86_400_000 !== 0) return null;
  const probe = new Date(utc);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return BigInt(utc / 86_400_000);
}

function formatDate(decimal: Decimal): string | null {
  if (decimal.scale !== 0) return null;
  const utc = Number(decimal.units) * 86_400_000;
  if (!Number.isSafeInteger(utc)) return null;
  const probe = new Date(utc);
  const year = probe.getUTCFullYear();
  const month = String(probe.getUTCMonth() + 1).padStart(2, "0");
  const day = String(probe.getUTCDate()).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${month}-${day}`;
}

function blank(reasons: DomainRuleReasonCode[], missing: string[] = []): PartialEval {
  return { outcome: "NOT_EVALUATED", factIds: [], sourceRefs: [], missing, reasons, scalar: undefined };
}

function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function merge(...parts: PartialEval[]): PartialEval {
  return {
    outcome: "NOT_ESTABLISHED",
    factIds: dedupe(parts.flatMap((part) => part.factIds)),
    sourceRefs: parts.flatMap((part) => part.sourceRefs),
    missing: dedupe(parts.flatMap((part) => part.missing)),
    reasons: dedupe(parts.flatMap((part) => part.reasons)),
  };
}

function worse(left: DomainRuleOutcome, right: DomainRuleOutcome): DomainRuleOutcome {
  const rank: Record<DomainRuleOutcome, number> = {
    NOT_EVALUATED: 5,
    CONFLICT: 4,
    NOT_SATISFIED: 3,
    NOT_ESTABLISHED: 2,
    COMPUTED: 1,
    ESTABLISHED: 0,
  };
  return rank[left] >= rank[right] ? left : right;
}

function ready(part: PartialEval): boolean {
  return !!part.scalar && (part.outcome === "ESTABLISHED" || part.outcome === "COMPUTED");
}

function canonical(value: VerifiedScalar): Canonical | "INVALID" | "INVALID_DATE" {
  if (value.valueType === "TEXT") return { valueType: "TEXT", text: value.value };
  if (value.valueType === "BOOLEAN") {
    return value.value === "true" || value.value === "false"
      ? { valueType: "BOOLEAN", text: value.value }
      : "INVALID";
  }
  if (value.valueType === "DATE") {
    const day = calendarDayIndex(value.value);
    const decimal = day === null ? null : decimalFromPlain(day.toString());
    return decimal ? { valueType: "DATE", decimal } : "INVALID_DATE";
  }
  const decimal = decimalFromPlain(value.value);
  if (!decimal) return "INVALID";
  if (value.valueType === "NUMBER") return { valueType: "NUMBER", decimal };
  if (value.valueType === "MONEY") return { valueType: "MONEY", decimal, currency: value.currency };
  return { valueType: "QUANTITY", decimal, unit: value.unit };
}

function sameCanonical(left: Canonical, right: Canonical): boolean {
  if (left.valueType !== right.valueType) return false;
  if (left.valueType === "TEXT" && right.valueType === "TEXT") return left.text === right.text;
  if (left.valueType === "BOOLEAN" && right.valueType === "BOOLEAN") return left.text === right.text;
  if (left.valueType === "MONEY" && right.valueType === "MONEY") {
    return left.currency === right.currency && compareDecimal(left.decimal, right.decimal) === 0;
  }
  if (left.valueType === "QUANTITY" && right.valueType === "QUANTITY") {
    return left.unit === right.unit && compareDecimal(left.decimal, right.decimal) === 0;
  }
  if ((left.valueType === "NUMBER" || left.valueType === "DATE") && (right.valueType === "NUMBER" || right.valueType === "DATE")) {
    return compareDecimal(left.decimal, right.decimal) === 0;
  }
  return false;
}

function refsOf(fact: { sourceRefs: readonly VerifiedSourceRef[] }): VerifiedSourceRef[] {
  return fact.sourceRefs.filter((ref) => nonempty(ref.documentId)).map((ref) => ({
    documentId: ref.documentId,
    ...(ref.page !== undefined ? { page: ref.page } : {}),
    ...(ref.excerptId !== undefined ? { excerptId: ref.excerptId } : {}),
  }));
}

function readField(
  entityId: string,
  fieldId: string,
  instanceId: string,
  expected: FieldValueType,
  index: EvidenceIndex,
): PartialEval {
  const missing = [requirementField(entityId, fieldId)];
  const group = index.facts.filter((fact) => fact.entityId === entityId && fact.instanceId === instanceId && fact.fieldId === fieldId);
  const usable = group.filter((fact) => sourced(fact.sourceRefs));
  if (index.conflicts.has(fieldKey(entityId, instanceId, fieldId))) {
    return {
      outcome: "CONFLICT",
      factIds: (usable.length ? usable : group).map((fact) => fact.id),
      sourceRefs: (usable.length ? usable : group).flatMap(refsOf),
      missing: [],
      reasons: ["CONFLICTING_EVIDENCE"],
    };
  }
  if (group.length === 0) return { outcome: "NOT_ESTABLISHED", factIds: [], sourceRefs: [], missing, reasons: ["FIELD_MISSING"] };
  if (usable.length === 0) return { outcome: "NOT_ESTABLISHED", factIds: [], sourceRefs: [], missing, reasons: ["SOURCE_MISSING"] };
  if (usable.some((fact) => fact.value.valueType !== expected)) {
    return { outcome: "NOT_EVALUATED", factIds: usable.map((fact) => fact.id), sourceRefs: usable.flatMap(refsOf), missing: [], reasons: ["TYPE_MISMATCH"] };
  }
  const parsed = usable.map((fact) => ({ fact, value: canonical(fact.value) }));
  if (parsed.some((item) => item.value === "INVALID_DATE")) {
    return { outcome: "NOT_EVALUATED", factIds: usable.map((fact) => fact.id), sourceRefs: usable.flatMap(refsOf), missing: [], reasons: ["DATE_INVALID"] };
  }
  if (parsed.some((item) => item.value === "INVALID")) {
    return { outcome: "NOT_EVALUATED", factIds: usable.map((fact) => fact.id), sourceRefs: usable.flatMap(refsOf), missing: [], reasons: ["TYPE_MISMATCH"] };
  }
  const values = parsed.map((item) => item.value as Canonical);
  if (values.some((value) => !sameCanonical(value, values[0]))) {
    return { outcome: "CONFLICT", factIds: usable.map((fact) => fact.id), sourceRefs: usable.flatMap(refsOf), missing: [], reasons: ["CONFLICTING_EVIDENCE"] };
  }
  return {
    outcome: "ESTABLISHED",
    factIds: usable.map((fact) => fact.id),
    sourceRefs: usable.flatMap(refsOf),
    missing: [],
    reasons: ["FIELD_PRESENT"],
    scalar: values[0],
  };
}

function jurisdictionGate(pack: CompiledDomainPack, required: string): DomainRuleReasonCode | null {
  const name = pack.applicability?.jurisdiction;
  if (typeof name !== "string" || pack.applicability?.verification !== "REVIEWED") return "JURISDICTION_UNESTABLISHED";
  const token = name.trim().toLowerCase();
  if (token === "" || token === "unknown" || token === "unspecified") return "JURISDICTION_UNESTABLISHED";
  return name === required ? null : "JURISDICTION_MISMATCH";
}

function definitionMap(pack: CompiledDomainPack): Map<string, EffectiveDefinition> {
  return new Map(pack.definitions.map((definition) => [definition.id, definition]));
}

function daysCalculation(pack: CompiledDomainPack, operand: string | PackOperand): boolean {
  if (typeof operand === "string" || operand.ref !== "CALCULATION") return false;
  const definition = definitionMap(pack).get(operand.calculationId);
  return definition?.kind === "calculation" && definition.operator === "DAYS_BETWEEN";
}

function deadlineGate(pack: CompiledDomainPack, left: PackOperand, right: PackOperand): DomainRuleReasonCode | null {
  const leftDays = daysCalculation(pack, left);
  const rightDays = daysCalculation(pack, right);
  if (!leftDays && !rightDays) return null;
  if (leftDays && rightDays) return "JURISDICTIONAL_RULE_UNESTABLISHED";
  const threshold = leftDays ? right : left;
  if (threshold.ref !== "LITERAL" || threshold.valueType !== "NUMBER" || !nonempty(threshold.jurisdiction)) {
    return "JURISDICTIONAL_RULE_UNESTABLISHED";
  }
  return jurisdictionGate(pack, threshold.jurisdiction);
}

function subtractDays(end: bigint, start: bigint): string | null {
  const evaluated = evaluateFormula(
    { op: "-", args: [{ value: end.toString() }, { value: start.toString() }] },
    () => null,
  );
  return evaluated.ok ? formatDecimal(evaluated.value) : null;
}

function evaluateDays(
  definition: Extract<EffectiveDefinition, { kind: "calculation" }>,
  plan: InstancePlan,
  index: EvidenceIndex,
  pack: CompiledDomainPack,
): PartialEval {
  if (definition.state !== "EXECUTABLE") return blank(["CALCULATION_NOT_EXECUTABLE"]);
  if (definition.operator !== "DAYS_BETWEEN") return blank(["CALCULATION_UNSUPPORTED"]);
  const bindings = calculationFieldBindings(definition.bindings);
  if (bindings.length === 0) return blank(["OPERAND_UNTYPED"]);
  const start = bindings.find((binding) => binding.role === "start");
  const end = bindings.find((binding) => binding.role === "end");
  if (!start || !end || bindings.length !== 2) return blank(["OPERAND_UNTYPED"]);
  const startInstance = plan.instances.get(start.entityId);
  const endInstance = plan.instances.get(end.entityId);
  if (!startInstance || !endInstance) return blank(["CROSS_ENTITY"], [requirementField(start.entityId, start.fieldId), requirementField(end.entityId, end.fieldId)]);
  const startField = fieldType(pack, start.entityId, start.fieldId);
  const endField = fieldType(pack, end.entityId, end.fieldId);
  if (startField !== "DATE" || endField !== "DATE") return blank(["TYPE_MISMATCH"]);
  const startRead = readField(start.entityId, start.fieldId, startInstance, "DATE", index);
  const endRead = readField(end.entityId, end.fieldId, endInstance, "DATE", index);
  const combined = merge(startRead, endRead, {
    outcome: "NOT_ESTABLISHED",
    factIds: plan.supportFactIds,
    sourceRefs: plan.supportRefs,
    missing: [],
    reasons: [],
  });
  const startScalar = startRead.scalar;
  const endScalar = endRead.scalar;
  if (!ready(startRead) || !ready(endRead) || !startScalar || startScalar.valueType !== "DATE" || !endScalar || endScalar.valueType !== "DATE") {
    return { ...combined, outcome: worse(ready(startRead) ? "ESTABLISHED" : startRead.outcome, ready(endRead) ? "ESTABLISHED" : endRead.outcome) };
  }
  const startNumber = dayNumber(startScalar.decimal);
  const endDay = dayNumber(endScalar.decimal);
  if (startNumber === null || endDay === null) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "DATE_INVALID"]) };
  const days = subtractDays(endDay, startNumber);
  if (days === null) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "CALCULATION_UNSUPPORTED"]) };
  const decimal = decimalFromPlain(days);
  if (!decimal) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "CALCULATION_UNSUPPORTED"]) };
  return {
    ...combined,
    outcome: "COMPUTED",
    reasons: dedupe([...combined.reasons, "CALCULATION_COMPUTED"]),
    daysBetween: days,
    scalar: { valueType: "NUMBER", decimal },
  };
}

function dayNumber(value: Decimal): bigint | null {
  if (value.scale !== 0) return null;
  return value.units;
}

function fieldType(pack: CompiledDomainPack, entityId: string, fieldId: string): FieldValueType | null {
  const entity = definitionMap(pack).get(entityId);
  if (entity?.kind !== "entity") return null;
  return entity.fields.find((field) => field.id === fieldId)?.valueType ?? null;
}

function literalScalar(operand: Extract<PackOperand, { ref: "LITERAL" }>): PartialEval {
  const value = canonical(operand.valueType === "MONEY"
    ? { valueType: "MONEY", value: operand.value, currency: operand.currency ?? "" }
    : operand.valueType === "QUANTITY"
      ? { valueType: "QUANTITY", value: operand.value, unit: operand.unit ?? "" }
      : { valueType: operand.valueType, value: operand.value });
  if (value === "INVALID" || value === "INVALID_DATE") return blank(["TYPE_MISMATCH"]);
  return { outcome: "ESTABLISHED", factIds: [], sourceRefs: [], missing: [], reasons: [], scalar: value };
}

function evaluateOperand(operand: PackOperand, plan: InstancePlan, index: EvidenceIndex, pack: CompiledDomainPack): PartialEval {
  if (operand.ref === "LITERAL") return literalScalar(operand);
  if (operand.ref === "FIELD") {
    const expected = fieldType(pack, operand.entityId, operand.fieldId);
    const instanceId = plan.instances.get(operand.entityId);
    if (!expected || !instanceId) {
      return blank([instanceId ? "TYPE_MISMATCH" : "CROSS_ENTITY"], [requirementField(operand.entityId, operand.fieldId)]);
    }
    return readField(operand.entityId, operand.fieldId, instanceId, expected, index);
  }
  const definition = definitionMap(pack).get(operand.calculationId);
  if (definition?.kind !== "calculation") return blank(["OPERAND_UNTYPED"]);
  return evaluateCalculation(definition, plan, index, pack);
}

function roleBinding(definition: Extract<EffectiveDefinition, { kind: "calculation" }>, role: string): PackCalculationBinding | undefined {
  return definition.bindings?.find((binding) => binding.role === role);
}

function literalBinding(binding: PackCalculationBinding | undefined): PackLiteralCalculationBinding | null {
  return binding && "literal" in binding ? binding : null;
}

function readRole(
  definition: Extract<EffectiveDefinition, { kind: "calculation" }>,
  role: string,
  allowed: readonly FieldValueType[],
  plan: InstancePlan,
  index: EvidenceIndex,
  pack: CompiledDomainPack,
): PartialEval {
  const binding = roleBinding(definition, role);
  if (!binding || !("entityId" in binding)) return blank(["OPERAND_UNTYPED"]);
  const instanceId = plan.instances.get(binding.entityId);
  if (!instanceId) return blank(["CROSS_ENTITY"], [requirementField(binding.entityId, binding.fieldId)]);
  const actual = fieldType(pack, binding.entityId, binding.fieldId);
  if (!actual || !allowed.includes(actual)) return blank(["TYPE_MISMATCH"]);
  return readField(binding.entityId, binding.fieldId, instanceId, actual, index);
}

function readInstanceField(
  entityId: string,
  fieldId: string,
  instanceId: string,
  allowed: readonly FieldValueType[],
  index: EvidenceIndex,
  pack: CompiledDomainPack,
): PartialEval {
  const actual = fieldType(pack, entityId, fieldId);
  if (!actual || !allowed.includes(actual)) return blank(["TYPE_MISMATCH"]);
  return readField(entityId, fieldId, instanceId, actual, index);
}

function decimalOf(scalar: Canonical | undefined): Decimal | null {
  return scalar && "decimal" in scalar ? scalar.decimal : null;
}

function sameMeasure(left: Canonical, right: Canonical): boolean {
  if (left.valueType !== right.valueType || !("decimal" in left) || !("decimal" in right)) return false;
  if (left.valueType === "MONEY" && right.valueType === "MONEY") return left.currency === right.currency;
  if (left.valueType === "QUANTITY" && right.valueType === "QUANTITY") return left.unit === right.unit;
  return left.valueType === "NUMBER";
}

function measureUnit(scalar: Canonical): string {
  if (scalar.valueType === "QUANTITY") return scalar.unit;
  if (scalar.valueType === "MONEY") return scalar.currency;
  return "";
}

function computedNumber(combined: PartialEval, value: string, unit: string, decimal: Decimal, valueType: "NUMBER" | "MONEY" | "QUANTITY", scalar: Canonical): PartialEval {
  const next: Canonical = valueType === "MONEY" && scalar.valueType === "MONEY"
    ? { valueType: "MONEY", decimal, currency: scalar.currency }
    : valueType === "QUANTITY" && scalar.valueType === "QUANTITY"
      ? { valueType: "QUANTITY", decimal, unit: scalar.unit }
      : { valueType: "NUMBER", decimal };
  return {
    ...combined,
    outcome: "COMPUTED",
    reasons: dedupe([...combined.reasons, "CALCULATION_COMPUTED"]),
    computedValue: value,
    computedUnit: unit,
    scalar: next,
  };
}

function subtractMeasures(left: Canonical, right: Canonical): { value: string; decimal: Decimal } | null {
  const leftDecimal = decimalOf(left);
  const rightDecimal = decimalOf(right);
  if (!leftDecimal || !rightDecimal) return null;
  const evaluated = evaluateFormula(
    { op: "-", args: [{ value: formatDecimal(leftDecimal) }, { value: formatDecimal(rightDecimal) }] },
    () => null,
  );
  if (!evaluated.ok) return null;
  return { value: formatDecimal(evaluated.value), decimal: evaluated.value };
}

function evaluateDifference(
  definition: Extract<EffectiveDefinition, { kind: "calculation" }>,
  plan: InstancePlan,
  index: EvidenceIndex,
  pack: CompiledDomainPack,
): PartialEval {
  const minuend = readRole(definition, "minuend", ["NUMBER", "MONEY", "QUANTITY"], plan, index, pack);
  const subtrahend = readRole(definition, "subtrahend", ["NUMBER", "MONEY", "QUANTITY"], plan, index, pack);
  const combined = merge(minuend, subtrahend);
  if (!ready(minuend) || !ready(subtrahend) || !minuend.scalar || !subtrahend.scalar) {
    return { ...combined, outcome: worse(ready(minuend) ? "ESTABLISHED" : minuend.outcome, ready(subtrahend) ? "ESTABLISHED" : subtrahend.outcome) };
  }
  if (!sameMeasure(minuend.scalar, subtrahend.scalar)) {
    return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "TYPE_MISMATCH"]) };
  }
  const difference = subtractMeasures(minuend.scalar, subtrahend.scalar);
  if (!difference || minuend.scalar.valueType === "DATE" || minuend.scalar.valueType === "TEXT" || minuend.scalar.valueType === "BOOLEAN") {
    return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "CALCULATION_UNSUPPORTED"]) };
  }
  const valueType = minuend.scalar.valueType;
  return computedNumber(combined, difference.value, measureUnit(minuend.scalar), difference.decimal, valueType, minuend.scalar);
}

function evaluateRate(
  definition: Extract<EffectiveDefinition, { kind: "calculation" }>,
  plan: InstancePlan,
  index: EvidenceIndex,
  pack: CompiledDomainPack,
): PartialEval {
  const from = readRole(definition, "from", ["NUMBER", "QUANTITY"], plan, index, pack);
  const to = readRole(definition, "to", ["NUMBER", "QUANTITY"], plan, index, pack);
  const start = readRole(definition, "start", ["DATE"], plan, index, pack);
  const end = readRole(definition, "end", ["DATE"], plan, index, pack);
  const combined = merge(from, to, start, end);
  if (!ready(from) || !ready(to) || !ready(start) || !ready(end) || !from.scalar || !to.scalar || !start.scalar || !end.scalar) {
    const outcomes = [from, to, start, end].map((item) => ready(item) ? "ESTABLISHED" as const : item.outcome);
    return { ...combined, outcome: outcomes.reduce(worse) };
  }
  if (!sameMeasure(from.scalar, to.scalar) || start.scalar.valueType !== "DATE" || end.scalar.valueType !== "DATE") {
    return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "TYPE_MISMATCH"]) };
  }
  const startDay = dayNumber(start.scalar.decimal);
  const endDay = dayNumber(end.scalar.decimal);
  if (startDay === null || endDay === null) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "DATE_INVALID"]) };
  const days = subtractDays(endDay, startDay);
  const dayDecimal = days ? decimalFromPlain(days) : null;
  if (!days || !dayDecimal || compareDecimal(dayDecimal, { units: 0n, scale: 0 }) <= 0) {
    return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "PERIOD_INVALID"]) };
  }
  const fromDecimal = decimalOf(from.scalar);
  const toDecimal = decimalOf(to.scalar);
  if (!fromDecimal || !toDecimal) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "TYPE_MISMATCH"]) };
  const evaluated = evaluateFormula({
    op: "round",
    places: 1,
    args: [{
      op: "/",
      args: [
        { op: "-", args: [{ value: formatDecimal(toDecimal) }, { value: formatDecimal(fromDecimal) }] },
        { op: "/", args: [{ value: days }, { value: "7" }] },
      ],
    }],
  }, () => null);
  if (!evaluated.ok) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "CALCULATION_UNSUPPORTED"]) };
  const unit = measureUnit(from.scalar);
  return computedNumber(combined, formatDecimal(evaluated.value), unit ? unit + " per week" : "per week", evaluated.value, "NUMBER", from.scalar);
}

function evaluateSum(
  definition: Extract<EffectiveDefinition, { kind: "calculation" }>,
  plan: InstancePlan,
  index: EvidenceIndex,
  pack: CompiledDomainPack,
): PartialEval {
  const valueBinding = roleBinding(definition, "value");
  const groupBinding = roleBinding(definition, "group");
  if (!valueBinding || !("entityId" in valueBinding) || !groupBinding || !("entityId" in groupBinding)) return blank(["OPERAND_UNTYPED"]);
  if (valueBinding.entityId !== groupBinding.entityId) return blank(["CROSS_ENTITY"]);
  const own = readRole(definition, "value", ["NUMBER", "MONEY", "QUANTITY"], plan, index, pack);
  const group = readRole(definition, "group", ["TEXT"], plan, index, pack);
  const combined = merge(own, group);
  if (!ready(own) || !ready(group) || !own.scalar || group.scalar?.valueType !== "TEXT") {
    return { ...combined, outcome: worse(ready(own) ? "ESTABLISHED" : own.outcome, ready(group) ? "ESTABLISHED" : group.outcome) };
  }
  const entityId = valueBinding.entityId;
  const groupText = group.scalar.text;
  const peers = index.instances.get(entityId) ?? [];
  let total = decimalOf(own.scalar);
  const factIds = [...own.factIds, ...group.factIds];
  const sourceRefs = [...own.sourceRefs, ...group.sourceRefs];
  if (!total) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "TYPE_MISMATCH"]) };
  for (const instanceId of peers) {
    if (instanceId === plan.instances.get(entityId)) continue;
    const peerGroup = readInstanceField(entityId, groupBinding.fieldId, instanceId, ["TEXT"], index, pack);
    if (peerGroup.outcome === "CONFLICT") {
      return { ...merge(combined, peerGroup), outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "CONFLICTING_EVIDENCE"]) };
    }
    if (!ready(peerGroup) || peerGroup.scalar?.valueType !== "TEXT" || peerGroup.scalar.text !== groupText) continue;
    const peerValue = readInstanceField(entityId, valueBinding.fieldId, instanceId, ["NUMBER", "MONEY", "QUANTITY"], index, pack);
    if (!ready(peerValue) || !peerValue.scalar || !sameMeasure(own.scalar, peerValue.scalar)) {
      return {
        ...merge(combined, peerValue),
        outcome: "NOT_EVALUATED",
        reasons: dedupe([...combined.reasons, ...peerValue.reasons, peerValue.outcome === "CONFLICT" ? "CONFLICTING_EVIDENCE" : "TYPE_MISMATCH"]),
      };
    }
    const peerDecimal = decimalOf(peerValue.scalar);
    if (!peerDecimal) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "TYPE_MISMATCH"]) };
    const added = evaluateFormula({ op: "+", args: [{ value: formatDecimal(total) }, { value: formatDecimal(peerDecimal) }] }, () => null);
    if (!added.ok) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "CALCULATION_UNSUPPORTED"]) };
    total = added.value;
    factIds.push(...peerValue.factIds, ...peerGroup.factIds);
    sourceRefs.push(...peerValue.sourceRefs, ...peerGroup.sourceRefs);
  }
  return computedNumber(
    { ...combined, factIds: dedupe(factIds), sourceRefs: dedupeRefs(sourceRefs) },
    formatDecimal(total),
    measureUnit(own.scalar),
    total,
    own.scalar.valueType === "MONEY" || own.scalar.valueType === "QUANTITY" ? own.scalar.valueType : "NUMBER",
    own.scalar,
  );
}

function intervalUnit(unit: string): "day" | "week" | "month" | "year" | null {
  const token = unit.trim().toLowerCase();
  if (!(INTERVAL_UNITS as readonly string[]).includes(token)) return null;
  if (token.startsWith("day")) return "day";
  if (token.startsWith("week")) return "week";
  if (token.startsWith("month")) return "month";
  return "year";
}

function monthLength(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function addCivil(iso: string, count: number, unit: "day" | "week" | "month" | "year"): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > monthLength(year, month)) return null;
  if (unit === "day" || unit === "week") {
    const days = unit === "week" ? count * 7 : count;
    const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
    const nextYear = shifted.getUTCFullYear();
    const nextMonth = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const nextDay = String(shifted.getUTCDate()).padStart(2, "0");
    return `${nextYear}-${nextMonth}-${nextDay}`;
  }
  const months = unit === "year" ? count * 12 : count;
  const absolute = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(absolute / 12);
  const nextMonth = absolute % 12 + 1;
  if (nextYear < 1 || nextYear > 9999) return null;
  const nextDay = Math.min(day, monthLength(nextYear, nextMonth));
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
}

function evaluateInterval(
  definition: Extract<EffectiveDefinition, { kind: "calculation" }>,
  plan: InstancePlan,
  index: EvidenceIndex,
  pack: CompiledDomainPack,
): PartialEval {
  const date = readRole(definition, "date", ["DATE"], plan, index, pack);
  const interval = literalBinding(roleBinding(definition, "interval"));
  if (!interval) return blank(["OPERAND_UNTYPED"]);
  const amount = decimalFromPlain(interval.literal.value);
  const unit = intervalUnit(interval.literal.unit);
  if (!amount || amount.scale !== 0 || amount.units > 10000n || amount.units < -10000n || !unit) return blank(["PERIOD_INVALID"]);
  if (!ready(date) || date.scalar?.valueType !== "DATE") return date;
  const written = formatDate(date.scalar.decimal);
  const next = written ? addCivil(written, Number(amount.units), unit) : null;
  const indexDay = next ? calendarDayIndex(next) : null;
  const decimal = indexDay === null ? null : decimalFromPlain(indexDay.toString());
  if (!next || !decimal) return { ...date, outcome: "NOT_EVALUATED", reasons: dedupe([...date.reasons, "DATE_INVALID"]) };
  return {
    ...date,
    outcome: "COMPUTED",
    reasons: dedupe([...date.reasons, "CALCULATION_COMPUTED"]),
    computedValue: next,
    computedUnit: "date",
    scalar: { valueType: "DATE", decimal },
  };
}

export function referenceTableCell(pack: CompiledDomainPack, tableId: string, rowKey: string, column: string): string | null {
  const table = definitionMap(pack).get(tableId);
  if (table?.kind !== "referenceTable") return null;
  const columnIndex = table.columns.findIndex((header) => header === column);
  if (columnIndex < 0) return null;
  const rows = table.rows.filter((row) => row[0] === rowKey);
  if (rows.length !== 1) return null;
  const cell = rows[0]?.[columnIndex] ?? "";
  return /^-?\d+(\.\d+)?$/.test(cell) ? cell : null;
}

function evaluateReferenceGap(
  definition: Extract<EffectiveDefinition, { kind: "calculation" }>,
  plan: InstancePlan,
  index: EvidenceIndex,
  pack: CompiledDomainPack,
): PartialEval {
  const value = readRole(definition, "value", ["NUMBER", "QUANTITY"], plan, index, pack);
  const row = readRole(definition, "row", ["TEXT"], plan, index, pack);
  const column = readRole(definition, "column", ["TEXT"], plan, index, pack);
  const table = roleBinding(definition, "table");
  const combined = merge(value, row, column);
  if (!table || !("referenceTableId" in table)) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "OPERAND_UNTYPED"]) };
  if (!ready(value) || !ready(row) || !ready(column) || !value.scalar || row.scalar?.valueType !== "TEXT" || column.scalar?.valueType !== "TEXT") {
    const outcomes = [value, row, column].map((item) => ready(item) ? "ESTABLISHED" as const : item.outcome);
    return { ...combined, outcome: outcomes.reduce(worse) };
  }
  const cell = referenceTableCell(pack, table.referenceTableId, row.scalar.text, column.scalar.text);
  const cellDecimal = cell ? decimalFromPlain(cell) : null;
  if (!cell || !cellDecimal) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "REFERENCE_UNAVAILABLE"]) };
  const difference = subtractMeasures(value.scalar, { valueType: "NUMBER", decimal: cellDecimal });
  if (!difference) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "TYPE_MISMATCH"]) };
  const valueType = value.scalar.valueType === "QUANTITY" ? "QUANTITY" : "NUMBER";
  return computedNumber(combined, difference.value, measureUnit(value.scalar), difference.decimal, valueType, value.scalar);
}

function evaluateCalculation(
  definition: Extract<EffectiveDefinition, { kind: "calculation" }>,
  plan: InstancePlan,
  index: EvidenceIndex,
  pack: CompiledDomainPack,
): PartialEval {
  if (definition.state !== "EXECUTABLE") return blank(["CALCULATION_NOT_EXECUTABLE"]);
  if (!definition.bindings) return blank(["OPERAND_UNTYPED"]);
  switch (definition.operator) {
    case "DAYS_BETWEEN":
      return evaluateDays(definition, plan, index, pack);
    case "DIFFERENCE":
      return evaluateDifference(definition, plan, index, pack);
    case "RATE_PER_WEEK":
      return evaluateRate(definition, plan, index, pack);
    case "SUM_BY":
      return evaluateSum(definition, plan, index, pack);
    case "ADD_INTERVAL":
      return evaluateInterval(definition, plan, index, pack);
    case "REFERENCE_GAP":
      return evaluateReferenceGap(definition, plan, index, pack);
    default:
      return blank(["CALCULATION_UNSUPPORTED"]);
  }
}

function compareScalars(left: Canonical, right: Canonical, comparator: "EQ" | "NE" | "LT" | "LTE" | "GT" | "GTE"): boolean | "MISMATCH" {
  if (left.valueType !== right.valueType) return "MISMATCH";
  if (left.valueType === "TEXT" && right.valueType === "TEXT") {
    if (comparator !== "EQ" && comparator !== "NE") return "MISMATCH";
    const equal = left.text === right.text;
    return comparator === "EQ" ? equal : !equal;
  }
  if (left.valueType === "BOOLEAN" && right.valueType === "BOOLEAN") {
    if (comparator !== "EQ" && comparator !== "NE") return "MISMATCH";
    const equal = left.text === right.text;
    return comparator === "EQ" ? equal : !equal;
  }
  if (left.valueType === "MONEY" && right.valueType === "MONEY") {
    if (left.currency !== right.currency) return "MISMATCH";
  }
  if (left.valueType === "QUANTITY" && right.valueType === "QUANTITY") {
    if (left.unit !== right.unit) return "MISMATCH";
  }
  if (!("decimal" in left) || !("decimal" in right)) return "MISMATCH";
  const order = compareDecimal(left.decimal, right.decimal);
  switch (comparator) {
    case "EQ": return order === 0;
    case "NE": return order !== 0;
    case "LT": return order < 0;
    case "LTE": return order <= 0;
    case "GT": return order > 0;
    case "GTE": return order >= 0;
  }
}

function evaluateCompare(predicate: Extract<PackPredicate, { op: "COMPARE" }>, plan: InstancePlan, index: EvidenceIndex, pack: CompiledDomainPack): PartialEval {
  if (typeof predicate.left === "string" || typeof predicate.right === "string") return blank(["OPERAND_UNTYPED"]);
  const left = evaluateOperand(predicate.left, plan, index, pack);
  const right = evaluateOperand(predicate.right, plan, index, pack);
  const combined = merge(left, right);
  if (!ready(left) || !ready(right) || !left.scalar || !right.scalar) {
    return { ...combined, outcome: worse(ready(left) ? "ESTABLISHED" : left.outcome, ready(right) ? "ESTABLISHED" : right.outcome) };
  }
  const gate = deadlineGate(pack, predicate.left, predicate.right);
  if (gate) return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, gate]) };
  const compared = compareScalars(left.scalar, right.scalar, predicate.comparator);
  if (compared === "MISMATCH") return { ...combined, outcome: "NOT_EVALUATED", reasons: dedupe([...combined.reasons, "TYPE_MISMATCH"]) };
  return {
    ...combined,
    outcome: compared ? "ESTABLISHED" : "NOT_SATISFIED",
    reasons: dedupe([...combined.reasons, compared ? "COMPARE_HOLDS" : "COMPARE_FAILS"]),
  };
}

function evaluatePredicate(predicate: PackPredicate, plan: InstancePlan, index: EvidenceIndex, pack: CompiledDomainPack): PartialEval {
  switch (predicate.op) {
    case "REVIEW_REQUIRED":
      return blank(["REVIEW_REQUIRED"]);
    case "FIELD_PRESENT": {
      const expected = fieldType(pack, predicate.entityId, predicate.fieldId);
      const instanceId = plan.instances.get(predicate.entityId);
      if (!expected || !instanceId) return blank(["CROSS_ENTITY"], [requirementField(predicate.entityId, predicate.fieldId)]);
      return readField(predicate.entityId, predicate.fieldId, instanceId, expected, index);
    }
    case "DOCUMENT_PRESENT":
      return evaluateDocument(predicate.documentKindId, plan, index);
    case "ALL":
      return combineAll(predicate.conditions.map((condition) => evaluatePredicate(condition, plan, index, pack)));
    case "ANY":
      return combineAny(predicate.conditions.map((condition) => evaluatePredicate(condition, plan, index, pack)));
    case "NOT":
      return negate(evaluatePredicate(predicate.condition, plan, index, pack));
    case "COMPARE":
      return evaluateCompare(predicate, plan, index, pack);
  }
}

function combineAll(children: PartialEval[]): PartialEval {
  const combined = merge(...children);
  if (children.length === 0) return { ...combined, outcome: "NOT_EVALUATED" };
  if (children.some((child) => child.outcome === "NOT_EVALUATED")) return { ...combined, outcome: "NOT_EVALUATED" };
  if (children.some((child) => child.outcome === "CONFLICT")) return { ...combined, outcome: "CONFLICT" };
  if (children.some((child) => child.outcome === "NOT_SATISFIED")) return { ...combined, outcome: "NOT_SATISFIED" };
  if (children.some((child) => child.outcome === "NOT_ESTABLISHED")) return { ...combined, outcome: "NOT_ESTABLISHED" };
  return { ...combined, outcome: "ESTABLISHED" };
}

function combineAny(children: PartialEval[]): PartialEval {
  const established = children.filter((child) => child.outcome === "ESTABLISHED");
  if (established.length > 0) return { ...merge(...established), outcome: "ESTABLISHED" };
  const combined = merge(...children);
  if (children.some((child) => child.outcome === "NOT_EVALUATED")) return { ...combined, outcome: "NOT_EVALUATED" };
  if (children.some((child) => child.outcome === "CONFLICT")) return { ...combined, outcome: "CONFLICT" };
  if (children.some((child) => child.outcome === "NOT_ESTABLISHED")) return { ...combined, outcome: "NOT_ESTABLISHED" };
  return { ...combined, outcome: "NOT_SATISFIED" };
}

function negate(child: PartialEval): PartialEval {
  if (child.outcome === "ESTABLISHED") return { ...child, outcome: "NOT_SATISFIED" };
  if (child.outcome === "NOT_SATISFIED") return { ...child, outcome: "ESTABLISHED" };
  if (child.outcome === "NOT_ESTABLISHED") {
    return { ...child, outcome: "NOT_ESTABLISHED", reasons: dedupe([...child.reasons, "NEGATION_OF_UNKNOWN"]) };
  }
  return child;
}

function evaluateDocument(documentKindId: string, plan: InstancePlan, index: EvidenceIndex): PartialEval {
  const missing = ["document:" + documentKindId];
  const documents = index.documents.filter((document) => document.documentKindId === documentKindId && sourced(document.sourceRefs));
  const bound = [...plan.instances.entries()];
  const matched = bound.length === 0
    ? documents
    : documents.filter((document) => document.subject !== undefined && plan.instances.get(document.subject.entityId) === document.subject.instanceId);
  if (matched.length === 0) return { outcome: "NOT_ESTABLISHED", factIds: [], sourceRefs: [], missing, reasons: ["DOCUMENT_MISSING"] };
  return {
    outcome: "ESTABLISHED",
    factIds: matched.map((document) => document.id),
    sourceRefs: matched.flatMap(refsOf),
    missing: [],
    reasons: ["DOCUMENT_PRESENT"],
  };
}

function entitiesInOperand(operand: string | PackOperand, pack: CompiledDomainPack): string[] {
  if (typeof operand === "string") return [];
  if (operand.ref === "FIELD") return [operand.entityId];
  if (operand.ref === "LITERAL") return [];
  const definition = definitionMap(pack).get(operand.calculationId);
  if (definition?.kind !== "calculation" || !definition.bindings) return [];
  return calculationFieldBindings(definition.bindings).map((binding) => binding.entityId);
}

function entitiesInPredicate(predicate: PackPredicate, pack: CompiledDomainPack): string[] {
  switch (predicate.op) {
    case "REVIEW_REQUIRED":
      return [];
    case "FIELD_PRESENT":
      return [predicate.entityId];
    case "DOCUMENT_PRESENT":
      return [];
    case "ALL":
    case "ANY":
      return predicate.conditions.flatMap((condition) => entitiesInPredicate(condition, pack));
    case "NOT":
      return entitiesInPredicate(predicate.condition, pack);
    case "COMPARE":
      return [...entitiesInOperand(predicate.left, pack), ...entitiesInOperand(predicate.right, pack)];
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function predicateRequirements(predicate: PackPredicate, pack: CompiledDomainPack): string[] {
  switch (predicate.op) {
    case "FIELD_PRESENT":
      return [requirementField(predicate.entityId, predicate.fieldId)];
    case "DOCUMENT_PRESENT":
      return ["document:" + predicate.documentKindId];
    case "ALL":
    case "ANY":
      return predicate.conditions.flatMap((condition) => predicateRequirements(condition, pack));
    case "NOT":
      return predicateRequirements(predicate.condition, pack);
    case "COMPARE":
      return compareRequirements(predicate, pack);
    default:
      return [];
  }
}

function compareRequirements(predicate: Extract<PackPredicate, { op: "COMPARE" }>, pack: CompiledDomainPack): string[] {
  const requirements: string[] = [];
  for (const operand of [predicate.left, predicate.right]) {
    if (typeof operand === "string") continue;
    if (operand.ref === "FIELD") requirements.push(requirementField(operand.entityId, operand.fieldId));
    if (operand.ref === "CALCULATION") {
      const definition = definitionMap(pack).get(operand.calculationId);
      if (definition?.kind === "calculation") {
        for (const binding of calculationFieldBindings(definition.bindings)) requirements.push(requirementField(binding.entityId, binding.fieldId));
      }
    }
  }
  return requirements;
}

function planInstances(entities: readonly string[], pack: CompiledDomainPack, index: EvidenceIndex, missing: string[]): InstancePlan[] | PartialEval {
  if (entities.length > 2) return blank(["CROSS_ENTITY"], missing);
  if (entities.length === 0) return [{ instances: new Map(), supportFactIds: [], supportRefs: [] }];
  if (entities.length === 1) {
    const ids = index.instances.get(entities[0]) ?? [];
    if (ids.length === 0) return { outcome: "NOT_ESTABLISHED", factIds: [], sourceRefs: [], missing, reasons: ["NO_INSTANCE", "FIELD_MISSING"] };
    return ids.map((instanceId) => ({ instances: new Map([[entities[0], instanceId]]), supportFactIds: [], supportRefs: [] }));
  }
  const [left, right] = entities;
  const relationships = pack.definitions.filter((definition) => definition.kind === "relationship" &&
    ((definition.fromEntityId === left && definition.toEntityId === right) ||
      (definition.fromEntityId === right && definition.toEntityId === left)));
  if (relationships.length === 0) return blank(["CROSS_ENTITY"], missing);
  if (relationships.length > 1) return blank(["AMBIGUOUS_RELATIONSHIP"], missing);
  const relationship = relationships[0];
  if (relationship.kind !== "relationship") return blank(["CROSS_ENTITY"], missing);
  const groups = new Map<string, VerifiedRelationshipFact[]>();
  for (const link of index.relationships) {
    if (link.relationshipId !== relationship.id || !sourced(link.sourceRefs)) continue;
    const fromKnown = (index.instances.get(relationship.fromEntityId) ?? []).includes(link.fromInstanceId);
    const toKnown = (index.instances.get(relationship.toEntityId) ?? []).includes(link.toInstanceId);
    if (!fromKnown || !toKnown) continue;
    const key = link.fromInstanceId + "\0" + link.toInstanceId;
    const group = groups.get(key);
    if (group) group.push(link);
    else groups.set(key, [link]);
  }
  if (groups.size === 0) {
    return blank(["CROSS_ENTITY"], dedupe([...missing, "relationship:" + relationship.id]));
  }
  const plans: InstancePlan[] = [];
  for (const links of groups.values()) {
    const first = links[0];
    plans.push({
      instances: new Map([
        [relationship.fromEntityId, first.fromInstanceId],
        [relationship.toEntityId, first.toInstanceId],
      ]),
      supportFactIds: links.map((link) => link.id),
      supportRefs: links.flatMap(refsOf),
      ambiguous: links.length > 1,
    });
  }
  return plans.sort((a, b) => planKey(a).localeCompare(planKey(b)));
}

function planKey(plan: InstancePlan): string {
  return [...plan.instances.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([entity, instance]) => entity + "=" + instance).join("|");
}

function applyCoverage(partial: PartialEval, coverage: VerifiedCaseFacts["coverage"], kind: "check" | "calculation"): PartialEval {
  if (coverage !== "INCOMPLETE") return partial;
  if (kind === "calculation" && partial.outcome === "COMPUTED") {
    return { ...partial, reasons: dedupe([...partial.reasons, "INCOMPLETE_COVERAGE"]) };
  }
  if (kind === "check" && (partial.outcome === "ESTABLISHED" || partial.outcome === "NOT_SATISFIED" || partial.outcome === "NOT_ESTABLISHED")) {
    return {
      ...partial,
      outcome: "NOT_ESTABLISHED",
      reasons: dedupe([...partial.reasons, "INCOMPLETE_COVERAGE"]),
      daysBetween: undefined,
      computedValue: undefined,
      computedUnit: undefined,
      scalar: undefined,
    };
  }
  return partial;
}

function toRow(
  kind: "check" | "calculation",
  ruleId: string,
  plan: InstancePlan | null,
  partial: PartialEval,
  operator?: PackCalculationOperator,
): DomainRuleResult {
  let outcome = partial.outcome;
  const reasons = [...partial.reasons];
  if (kind === "check" && !CHECK_OUTCOMES.has(outcome)) {
    outcome = "NOT_EVALUATED";
    reasons.push("CALCULATION_UNSUPPORTED");
  }
  // A missing or unsourced date is not a negative finding and is not a day count.
  if (kind === "calculation" && outcome === "NOT_ESTABLISHED") {
    outcome = "NOT_EVALUATED";
  }
  // A relationship identifies the joined instances. It is not field, document, or calculation evidence.
  const joinIds = plan?.supportFactIds ?? [];
  const joined = new Set(joinIds);
  const substantiveIds = partial.factIds.filter((id) => !joined.has(id));
  if (kind === "check" && (outcome === "ESTABLISHED" || outcome === "NOT_SATISFIED") && substantiveIds.length === 0) {
    outcome = "NOT_EVALUATED";
    reasons.push("SOURCE_MISSING");
  }
  const instances = plan
    ? [...plan.instances.entries()].map(([entityId, instanceId]) => ({ entityId, instanceId })).sort((a, b) => a.entityId.localeCompare(b.entityId))
    : [];
  const row: DomainRuleResult = {
    kind,
    ruleId,
    instanceId: instances.length === 1 ? instances[0].instanceId : null,
    instances,
    outcome,
    supportingFactIds: dedupe([...substantiveIds, ...joinIds]).sort(),
    sourceRefs: dedupeRefs([...partial.sourceRefs, ...(plan?.supportRefs ?? [])]),
    missingRequirements: dedupe(partial.missing).sort(),
    reasonCodes: dedupe(reasons),
  };
  if (operator) row.operator = operator;
  if (kind === "calculation" && outcome === "COMPUTED" && partial.daysBetween !== undefined) row.daysBetween = partial.daysBetween;
  if (kind === "calculation" && outcome === "COMPUTED" && partial.computedValue !== undefined) {
    row.computedValue = partial.computedValue;
    row.computedUnit = partial.computedUnit ?? "";
  }
  return row;
}

function dedupeRefs(refs: readonly VerifiedSourceRef[]): VerifiedSourceRef[] {
  const seen = new Set<string>();
  const result: VerifiedSourceRef[] = [];
  for (const ref of refs) {
    const key = ref.documentId + "\0" + (ref.page ?? "") + "\0" + (ref.excerptId ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result.sort((a, b) => (a.documentId + (a.page ?? "")).localeCompare(b.documentId + (b.page ?? "")));
}

function validateEvidence(raw: VerifiedCaseFacts, pack: CompiledDomainPack): DomainRuleIssue[] {
  const issues: DomainRuleIssue[] = [];
  if (!isRecord(raw)) return [fail("evidence_invalid", "$", "Verified facts must be an object.")];
  exactKeys(raw as unknown as Record<string, unknown>, ["schema", "coverage", "facts", "documents", "relationships", "conflicts"], "$", issues);
  if (raw.schema !== VERIFIED_CASE_FACTS_SCHEMA) issues.push(fail("schema_invalid", "$.schema", "Unsupported verified-fact schema."));
  if (raw.coverage !== "COMPLETE" && raw.coverage !== "INCOMPLETE") issues.push(fail("coverage_invalid", "$.coverage", "Coverage must be complete or incomplete."));
  if (!Array.isArray(raw.facts) || !Array.isArray(raw.documents) || !Array.isArray(raw.relationships) || !Array.isArray(raw.conflicts)) {
    issues.push(fail("evidence_invalid", "$", "Facts, documents, relationships and conflicts must be arrays."));
    return issues;
  }
  const ids = new Set<string>();
  raw.facts.forEach((fact, index) => validateFact(fact, index, pack, ids, issues));
  raw.documents.forEach((document, index) => validateDocument(document, index, ids, issues));
  raw.relationships.forEach((link, index) => validateLink(link, index, ids, issues));
  raw.conflicts.forEach((conflict, index) => {
    const path = "$.conflicts[" + index + "]";
    if (!isRecord(conflict)) {
      issues.push(fail("conflict_invalid", path, "Conflict must name one field."));
      return;
    }
    exactKeys(conflict, ["entityId", "instanceId", "fieldId"], path, issues);
    if (!nonempty(conflict.entityId) || !nonempty(conflict.instanceId) || !nonempty(conflict.fieldId)) {
      issues.push(fail("conflict_invalid", path, "Conflict must name one field."));
    }
  });
  return issues;
}

function validateFact(fact: VerifiedFact, index: number, pack: CompiledDomainPack, ids: Set<string>, issues: DomainRuleIssue[]): void {
  const path = "$.facts[" + index + "]";
  if (!isRecord(fact)) {
    issues.push(fail("fact_invalid", path, "Fact must be an object."));
    return;
  }
  exactKeys(fact, ["id", "status", "entityId", "instanceId", "fieldId", "value", "sourceRefs"], path, issues);
  if (fact.status !== "VERIFIED") issues.push(fail("unverified_input", path + ".status", "Only verified facts can enter the rule engine."));
  if (!nonempty(fact.id) || ids.has(fact.id)) issues.push(fail("fact_id", path + ".id", "Fact ID must be unique."));
  else ids.add(fact.id);
  if (!nonempty(fact.entityId) || !nonempty(fact.instanceId) || !nonempty(fact.fieldId)) {
    issues.push(fail("fact_binding", path, "Fact needs an entity, an instance and a field."));
  }
  const entity = pack.definitions.find((definition) => definition.id === fact.entityId && definition.kind === "entity");
  if (!entity || entity.kind !== "entity" || !entity.fields.some((field) => field.id === fact.fieldId)) {
    issues.push(fail("fact_unbound", path, "Fact does not name a field on the compiled pack."));
  }
  validateValue(fact.value, path + ".value", issues);
  validateRefs(fact.sourceRefs, path + ".sourceRefs", issues);
}

function validateValue(value: VerifiedScalar, path: string, issues: DomainRuleIssue[]): void {
  if (!isRecord(value) || typeof value.value !== "string" || !["TEXT", "NUMBER", "DATE", "BOOLEAN", "MONEY", "QUANTITY"].includes(String(value.valueType))) {
    issues.push(fail("value_invalid", path, "Fact value must be an explicit typed scalar."));
    return;
  }
  if (value.valueType === "MONEY") exactKeys(value, ["valueType", "value", "currency"], path, issues);
  else if (value.valueType === "QUANTITY") exactKeys(value, ["valueType", "value", "unit"], path, issues);
  else exactKeys(value, ["valueType", "value"], path, issues);
}

function validateRefs(refs: readonly VerifiedSourceRef[], path: string, issues: DomainRuleIssue[]): void {
  if (!Array.isArray(refs)) {
    issues.push(fail("source_invalid", path, "Source references must be an array."));
    return;
  }
  refs.forEach((ref, index) => {
    if (!isRecord(ref)) {
      issues.push(fail("source_invalid", path + "[" + index + "]", "Source reference must be an object."));
      return;
    }
    exactKeys(ref, ["documentId", "page", "excerptId"], path + "[" + index + "]", issues);
    if (!nonempty(ref.documentId)) issues.push(fail("source_invalid", path + "[" + index + "].documentId", "Source reference needs a document ID."));
  });
}

function validateDocument(document: VerifiedDocumentFact, index: number, ids: Set<string>, issues: DomainRuleIssue[]): void {
  const path = "$.documents[" + index + "]";
  if (!isRecord(document)) {
    issues.push(fail("document_invalid", path, "Document fact must be an object."));
    return;
  }
  exactKeys(document, ["id", "status", "documentKindId", "subject", "sourceRefs"], path, issues);
  if (document.status !== "VERIFIED") issues.push(fail("unverified_input", path + ".status", "Only verified documents can enter the rule engine."));
  if (!nonempty(document.id) || ids.has(document.id)) issues.push(fail("fact_id", path + ".id", "Document ID must be unique."));
  else ids.add(document.id);
  if (!nonempty(document.documentKindId)) issues.push(fail("document_invalid", path, "Document kind is required."));
  if (document.subject !== undefined) {
    if (!isRecord(document.subject)) issues.push(fail("document_subject", path + ".subject", "Document subject must name an instance."));
    else {
      exactKeys(document.subject, ["entityId", "instanceId"], path + ".subject", issues);
      if (!nonempty(document.subject.entityId) || !nonempty(document.subject.instanceId)) {
        issues.push(fail("document_subject", path + ".subject", "Document subject must name an instance."));
      }
    }
  }
  validateRefs(document.sourceRefs, path + ".sourceRefs", issues);
}

function validateLink(link: VerifiedRelationshipFact, index: number, ids: Set<string>, issues: DomainRuleIssue[]): void {
  const path = "$.relationships[" + index + "]";
  if (!isRecord(link)) {
    issues.push(fail("relationship_invalid", path, "Relationship fact must be an object."));
    return;
  }
  exactKeys(link, ["id", "status", "relationshipId", "fromInstanceId", "toInstanceId", "sourceRefs"], path, issues);
  if (link.status !== "VERIFIED") issues.push(fail("unverified_input", path + ".status", "Only verified relationships can enter the rule engine."));
  if (!nonempty(link.id) || ids.has(link.id)) issues.push(fail("fact_id", path + ".id", "Relationship ID must be unique."));
  else ids.add(link.id);
  if (!nonempty(link.relationshipId) || !nonempty(link.fromInstanceId) || !nonempty(link.toInstanceId)) {
    issues.push(fail("relationship_invalid", path, "Relationship endpoints are required."));
  }
  validateRefs(link.sourceRefs, path + ".sourceRefs", issues);
}

function buildIndex(evidence: VerifiedCaseFacts): EvidenceIndex {
  const instances = new Map<string, Set<string>>();
  const add = (entityId: string, instanceId: string) => {
    const set = instances.get(entityId) ?? new Set<string>();
    set.add(instanceId);
    instances.set(entityId, set);
  };
  for (const fact of evidence.facts) add(fact.entityId, fact.instanceId);
  for (const document of evidence.documents) {
    if (document.subject) add(document.subject.entityId, document.subject.instanceId);
  }
  const conflicts = new Set(evidence.conflicts.map((conflict) => fieldKey(conflict.entityId, conflict.instanceId, conflict.fieldId)));
  return {
    facts: evidence.facts,
    documents: evidence.documents,
    relationships: evidence.relationships,
    conflicts,
    instances: new Map([...instances.entries()].map(([entityId, ids]) => [entityId, [...ids].sort()])),
  };
}

function emitPlans(
  kind: "check" | "calculation",
  ruleId: string,
  entities: readonly string[],
  missing: string[],
  pack: CompiledDomainPack,
  index: EvidenceIndex,
  coverage: VerifiedCaseFacts["coverage"],
  operator: PackCalculationOperator | undefined,
  run: (plan: InstancePlan) => PartialEval,
): DomainRuleResult[] {
  const planned = planInstances(entities, pack, index, missing);
  if (!Array.isArray(planned)) return [toRow(kind, ruleId, null, applyCoverage(planned, coverage, kind), operator)];
  return planned.map((plan) => {
    const partial: PartialEval = plan.ambiguous
      ? { outcome: "NOT_EVALUATED", factIds: [], sourceRefs: [], missing: [], reasons: ["AMBIGUOUS_RELATIONSHIP"] }
      : run(plan);
    return toRow(kind, ruleId, plan, applyCoverage(partial, coverage, kind), operator);
  });
}

/**
 * Evaluates every check and calculation in a compiled pack against verified facts.
 * Unverified input fails closed and produces no verdicts.
 */
export function evaluateDomainRules(pack: CompiledDomainPack, evidence: VerifiedCaseFacts): DomainRuleEvaluation {
  if (!isRecord(pack) || pack.schema !== DOMAIN_PACK_RUNTIME_SCHEMA || !Array.isArray(pack.definitions) || !nonempty(pack.identity?.digest)) {
    return { ok: false, issues: [fail("pack_invalid", "$", "Rules run only on a compiled domain-pack runtime snapshot.")] };
  }
  const issues = validateEvidence(evidence, pack);
  if (issues.length > 0) return { ok: false, issues };
  const index = buildIndex(evidence);
  const results: DomainRuleResult[] = [];
  for (const definition of pack.definitions) {
    if (definition.kind === "calculation") {
      const fields = calculationFieldBindings(definition.bindings);
      const entities = unique(fields.map((binding) => binding.entityId));
      const missing = fields.map((binding) => requirementField(binding.entityId, binding.fieldId));
      if (definition.state !== "EXECUTABLE" || !definition.bindings) {
        const reason: DomainRuleReasonCode = definition.state !== "EXECUTABLE" ? "CALCULATION_NOT_EXECUTABLE" : "OPERAND_UNTYPED";
        results.push(toRow("calculation", definition.id, null, blank([reason]), definition.operator));
        continue;
      }
      results.push(...emitPlans("calculation", definition.id, entities, missing, pack, index, evidence.coverage, definition.operator, (plan) =>
        evaluateCalculation(definition, plan, index, pack)));
    }
    if (definition.kind === "check") {
      const entities = unique(entitiesInPredicate(definition.criterion, pack));
      results.push(...emitPlans("check", definition.id, entities, predicateRequirements(definition.criterion, pack), pack, index, evidence.coverage, undefined, (plan) =>
        evaluatePredicate(definition.criterion, plan, index, pack)));
    }
  }
  results.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || (a.instanceId ?? "").localeCompare(b.instanceId ?? "") || planKey({ instances: new Map(a.instances.map((item) => [item.entityId, item.instanceId])), supportFactIds: [], supportRefs: [] }).localeCompare(planKey({ instances: new Map(b.instances.map((item) => [item.entityId, item.instanceId])), supportFactIds: [], supportRefs: [] })));
  return {
    ok: true,
    schema: DOMAIN_PACK_RULE_EVALUATION_SCHEMA,
    packId: pack.identity.packId,
    packDigest: pack.identity.digest,
    results,
  };
}
