/**
 * Typed applicability expressions for an effective Domain Pack.
 * Dimension names are data. This module has no jurisdiction, venue, or domain hierarchy.
 * TRUE, FALSE, and UNKNOWN use Kleene rules. A missing or unverified attribute never
 * becomes TRUE. Known absence is FALSE only for EXISTS.
 */
import { compareDecimal, decimalFromPlain, formatDecimal } from "../analysis/decimal-formula";
import { canonicalPackJson } from "./domain-pack-compiler";

export const APPLICABILITY_RESULTS = ["TRUE", "FALSE", "UNKNOWN"] as const;
export type ApplicabilityResult = (typeof APPLICABILITY_RESULTS)[number];

export const APPLICABILITY_VALUE_TYPES = ["TEXT", "NUMBER", "BOOLEAN", "DATE"] as const;
export type ApplicabilityValueType = (typeof APPLICABILITY_VALUE_TYPES)[number];

export type ApplicabilityScalar =
  | { type: "TEXT"; value: string }
  | { type: "NUMBER"; value: string }
  | { type: "BOOLEAN"; value: boolean }
  | { type: "DATE"; value: string };

export type ApplicabilityExpr =
  | { op: "AND"; args: ApplicabilityExpr[] }
  | { op: "OR"; args: ApplicabilityExpr[] }
  | { op: "NOT"; arg: ApplicabilityExpr }
  | { op: "EXISTS"; key: string }
  | { op: "EQ" | "NE"; key: string; value: ApplicabilityScalar }
  | { op: "LT" | "LTE" | "GT" | "GTE"; key: string; value: ApplicabilityScalar }
  | { op: "IN"; key: string; values: ApplicabilityScalar[] };

export type CaseAttribute = {
  key: string;
  value: ApplicabilityScalar;
  verification: "UNVERIFIED" | "REVIEWED";
};

export type ApplicabilityIssue = { code: string; path: string; message: string };

const KEY = /^[a-z][a-z0-9-]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;
const MAX_DEPTH = 8;
const MAX_NODES = 64;
const COMPARE_OPS = new Set(["EQ", "NE", "LT", "LTE", "GT", "GTE"]);
const ORDERED_OPS = new Set(["LT", "LTE", "GT", "GTE"]);

type ObjectMap = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);

/** Empty conjunction. An omitted extension condition inherits this from its parent. */
export const ALWAYS_APPLICABLE: ApplicabilityExpr = { op: "AND", args: [] };

export function parseApplicabilityExpr(raw: unknown, path: string, issues: ApplicabilityIssue[]): ApplicabilityExpr | null {
  const counter = { nodes: 0 };
  const parsed = parseNode(raw, path, issues, 0, counter);
  if (!parsed || issues.some((item) => item.path.startsWith(path))) return null;
  return canonicalizeApplicabilityExpr(parsed);
}

export function canonicalizeApplicabilityExpr(expr: ApplicabilityExpr): ApplicabilityExpr {
  if (expr.op === "AND" || expr.op === "OR") {
    const flat: ApplicabilityExpr[] = [];
    for (const arg of expr.args) {
      const child = canonicalizeApplicabilityExpr(arg);
      if (child.op === expr.op) flat.push(...child.args);
      else flat.push(child);
    }
    const unique = new Map<string, ApplicabilityExpr>();
    for (const arg of flat) unique.set(canonicalPackJson(arg), arg);
    const args = [...unique.values()].sort((left, right) => canonicalPackJson(left).localeCompare(canonicalPackJson(right)));
    return { op: expr.op, args };
  }
  if (expr.op === "NOT") return { op: "NOT", arg: canonicalizeApplicabilityExpr(expr.arg) };
  if (expr.op === "IN") {
    const unique = new Map<string, ApplicabilityScalar>();
    for (const value of expr.values) unique.set(canonicalPackJson(value), value);
    const values = [...unique.values()].sort((left, right) => canonicalPackJson(left).localeCompare(canonicalPackJson(right)));
    return { op: "IN", key: expr.key, values };
  }
  return expr;
}

export function parseCaseAttribute(raw: unknown, path: string, issues: ApplicabilityIssue[]): CaseAttribute | null {
  if (!isObject(raw)) {
    issue(issues, "attribute_invalid", path, "A case attribute must be an object.");
    return null;
  }
  exactKeys(raw, ["key", "value", "verification"], path, issues);
  const key = parseKey(raw.key, path + ".key", issues);
  const value = parseScalar(raw.value, path + ".value", issues);
  if (raw.verification !== "UNVERIFIED" && raw.verification !== "REVIEWED") {
    issue(issues, "attribute_verification", path + ".verification", "Verification must be UNVERIFIED or REVIEWED.");
  }
  if (!key || !value || (raw.verification !== "UNVERIFIED" && raw.verification !== "REVIEWED")) return null;
  return { key, value, verification: raw.verification };
}

export function evaluateApplicability(
  expr: ApplicabilityExpr,
  attributes: ReadonlyMap<string, CaseAttribute>,
): { ok: true; result: ApplicabilityResult } | { ok: false; code: string; message: string } {
  return evaluateNode(expr, attributes);
}

function issue(into: ApplicabilityIssue[], code: string, path: string, message: string): void {
  into.push({ code, path, message });
}

function exactKeys(value: ObjectMap, allowed: readonly string[], path: string, issues: ApplicabilityIssue[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) issue(issues, "unknown_field", path + "." + key, "Field is not part of an applicability expression.");
  }
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseScalar(raw: unknown, path: string, issues: ApplicabilityIssue[]): ApplicabilityScalar | null {
  if (!isObject(raw)) {
    issue(issues, "value_invalid", path, "A typed value is required.");
    return null;
  }
  exactKeys(raw, ["type", "value"], path, issues);
  if (raw.type === "TEXT") {
    if (typeof raw.value !== "string" || raw.value.length === 0 || raw.value.length > 200 || raw.value.trim() !== raw.value || CONTROL.test(raw.value)) {
      issue(issues, "value_invalid", path + ".value", "Text values are short plain labels.");
      return null;
    }
    return { type: "TEXT", value: raw.value };
  }
  if (raw.type === "NUMBER") {
    if (typeof raw.value !== "string") {
      issue(issues, "value_invalid", path + ".value", "Numbers are exact decimal strings.");
      return null;
    }
    const decimal = decimalFromPlain(raw.value);
    if (!decimal) {
      issue(issues, "value_invalid", path + ".value", "Number is not an exact decimal.");
      return null;
    }
    return { type: "NUMBER", value: formatDecimal(decimal) };
  }
  if (raw.type === "BOOLEAN") {
    if (typeof raw.value !== "boolean") {
      issue(issues, "value_invalid", path + ".value", "Boolean values are true or false.");
      return null;
    }
    return { type: "BOOLEAN", value: raw.value };
  }
  if (raw.type === "DATE") {
    if (typeof raw.value !== "string" || !validDate(raw.value)) {
      issue(issues, "value_invalid", path + ".value", "Dates are calendar dates.");
      return null;
    }
    return { type: "DATE", value: raw.value };
  }
  issue(issues, "value_type", path + ".type", "Value type is not supported.");
  return null;
}

function parseKey(raw: unknown, path: string, issues: ApplicabilityIssue[]): string | null {
  if (typeof raw !== "string" || !KEY.test(raw)) {
    issue(issues, "dimension_key", path, "Dimension keys are lowercase identifiers.");
    return null;
  }
  return raw;
}

function parseNode(
  raw: unknown,
  path: string,
  issues: ApplicabilityIssue[],
  depth: number,
  counter: { nodes: number },
): ApplicabilityExpr | null {
  counter.nodes += 1;
  if (counter.nodes > MAX_NODES) {
    issue(issues, "expression_limit", path, "Applicability expression is too large.");
    return null;
  }
  if (depth > MAX_DEPTH) {
    issue(issues, "expression_limit", path, "Applicability expression is too deep.");
    return null;
  }
  if (!isObject(raw) || typeof raw.op !== "string") {
    issue(issues, "expression_invalid", path, "An applicability expression must name an operator.");
    return null;
  }
  if (raw.op === "AND" || raw.op === "OR") {
    exactKeys(raw, ["op", "args"], path, issues);
    if (!Array.isArray(raw.args) || raw.args.length > 32) {
      issue(issues, "expression_invalid", path + ".args", "AND and OR take a bounded argument list.");
      return null;
    }
    const args: ApplicabilityExpr[] = [];
    raw.args.forEach((arg, index) => {
      const child = parseNode(arg, path + ".args[" + index + "]", issues, depth + 1, counter);
      if (child) args.push(child);
    });
    if (args.length !== raw.args.length) return null;
    return { op: raw.op, args };
  }
  if (raw.op === "NOT") {
    exactKeys(raw, ["op", "arg"], path, issues);
    const arg = parseNode(raw.arg, path + ".arg", issues, depth + 1, counter);
    return arg ? { op: "NOT", arg } : null;
  }
  if (raw.op === "EXISTS") {
    exactKeys(raw, ["op", "key"], path, issues);
    const key = parseKey(raw.key, path + ".key", issues);
    return key ? { op: "EXISTS", key } : null;
  }
  if (COMPARE_OPS.has(raw.op)) {
    exactKeys(raw, ["op", "key", "value"], path, issues);
    const key = parseKey(raw.key, path + ".key", issues);
    const value = parseScalar(raw.value, path + ".value", issues);
    if (!key || !value) return null;
    if (ORDERED_OPS.has(raw.op) && (value.type === "TEXT" || value.type === "BOOLEAN")) {
      issue(issues, "unsupported_comparison", path, "Text and boolean values support only equality.");
      return null;
    }
    return { op: raw.op as "EQ" | "NE" | "LT" | "LTE" | "GT" | "GTE", key, value };
  }
  if (raw.op === "IN") {
    exactKeys(raw, ["op", "key", "values"], path, issues);
    const key = parseKey(raw.key, path + ".key", issues);
    if (!Array.isArray(raw.values) || raw.values.length < 1 || raw.values.length > 32) {
      issue(issues, "expression_invalid", path + ".values", "IN requires a bounded nonempty value list.");
      return null;
    }
    const values: ApplicabilityScalar[] = [];
    raw.values.forEach((item, index) => {
      const value = parseScalar(item, path + ".values[" + index + "]", issues);
      if (value) values.push(value);
    });
    if (!key || values.length !== raw.values.length) return null;
    const type = values[0]?.type;
    if (values.some((value) => value.type !== type)) {
      issue(issues, "unsupported_predicate", path + ".values", "IN values must share one type.");
      return null;
    }
    return { op: "IN", key, values };
  }
  issue(issues, "unsupported_predicate", path + ".op", "Applicability operator is not supported.");
  return null;
}

function kleeneNot(result: ApplicabilityResult): ApplicabilityResult {
  if (result === "TRUE") return "FALSE";
  if (result === "FALSE") return "TRUE";
  return "UNKNOWN";
}

function kleeneAnd(results: readonly ApplicabilityResult[]): ApplicabilityResult {
  if (results.some((result) => result === "FALSE")) return "FALSE";
  if (results.some((result) => result === "UNKNOWN")) return "UNKNOWN";
  return "TRUE";
}

function kleeneOr(results: readonly ApplicabilityResult[]): ApplicabilityResult {
  if (results.some((result) => result === "TRUE")) return "TRUE";
  if (results.some((result) => result === "UNKNOWN")) return "UNKNOWN";
  return "FALSE";
}

function attributeState(
  attributes: ReadonlyMap<string, CaseAttribute>,
  key: string,
  expected: ApplicabilityValueType,
): { ok: true; state: "ABSENT" | "UNVERIFIED" | "REVIEWED"; value?: ApplicabilityScalar } | { ok: false; code: string; message: string } {
  const attribute = attributes.get(key);
  if (!attribute) return { ok: true, state: "ABSENT" };
  if (attribute.value.type !== expected) {
    return { ok: false, code: "attribute_type_mismatch", message: "Attribute type does not match the expression." };
  }
  if (attribute.verification === "UNVERIFIED") return { ok: true, state: "UNVERIFIED", value: attribute.value };
  return { ok: true, state: "REVIEWED", value: attribute.value };
}

function sameScalar(left: ApplicabilityScalar, right: ApplicabilityScalar): boolean | "MISMATCH" {
  if (left.type !== right.type) return "MISMATCH";
  if (left.type === "NUMBER" && right.type === "NUMBER") {
    const a = decimalFromPlain(left.value);
    const b = decimalFromPlain(right.value);
    if (!a || !b) return "MISMATCH";
    return compareDecimal(a, b) === 0;
  }
  return left.value === right.value;
}

function orderScalar(left: ApplicabilityScalar, right: ApplicabilityScalar): number | "MISMATCH" | "UNORDERED" {
  if (left.type !== right.type) return "MISMATCH";
  if (left.type === "TEXT" || left.type === "BOOLEAN" || right.type === "TEXT" || right.type === "BOOLEAN") return "UNORDERED";
  if (left.type === "DATE" && right.type === "DATE") return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  if (left.type === "NUMBER" && right.type === "NUMBER") {
    const a = decimalFromPlain(left.value);
    const b = decimalFromPlain(right.value);
    if (!a || !b) return "MISMATCH";
    return compareDecimal(a, b);
  }
  return "MISMATCH";
}

function evaluateNode(
  expr: ApplicabilityExpr,
  attributes: ReadonlyMap<string, CaseAttribute>,
): { ok: true; result: ApplicabilityResult } | { ok: false; code: string; message: string } {
  if (expr.op === "AND" || expr.op === "OR") {
    const results: ApplicabilityResult[] = [];
    for (const arg of expr.args) {
      const child = evaluateNode(arg, attributes);
      if (!child.ok) return child;
      results.push(child.result);
    }
    return { ok: true, result: expr.op === "AND" ? kleeneAnd(results) : kleeneOr(results) };
  }
  if (expr.op === "NOT") {
    const child = evaluateNode(expr.arg, attributes);
    if (!child.ok) return child;
    return { ok: true, result: kleeneNot(child.result) };
  }
  if (expr.op === "EXISTS") {
    const attribute = attributes.get(expr.key);
    if (!attribute) return { ok: true, result: "FALSE" };
    if (attribute.verification !== "REVIEWED") return { ok: true, result: "UNKNOWN" };
    return { ok: true, result: "TRUE" };
  }
  if (expr.op === "IN") {
    const expected = expr.values[0]?.type;
    if (!expected) return { ok: false, code: "unsupported_predicate", message: "IN requires a value." };
    const state = attributeState(attributes, expr.key, expected);
    if (!state.ok) return state;
    if (state.state !== "REVIEWED" || !state.value) return { ok: true, result: "UNKNOWN" };
    for (const candidate of expr.values) {
      const compared = sameScalar(state.value, candidate);
      if (compared === "MISMATCH") return { ok: false, code: "attribute_type_mismatch", message: "IN value type does not match." };
      if (compared) return { ok: true, result: "TRUE" };
    }
    return { ok: true, result: "FALSE" };
  }
  const state = attributeState(attributes, expr.key, expr.value.type);
  if (!state.ok) return state;
  if (state.state !== "REVIEWED" || !state.value) return { ok: true, result: "UNKNOWN" };
  if (expr.op === "EQ" || expr.op === "NE") {
    const compared = sameScalar(state.value, expr.value);
    if (compared === "MISMATCH") return { ok: false, code: "attribute_type_mismatch", message: "Compared values do not share a type." };
    const equal = compared === true;
    return { ok: true, result: expr.op === "EQ" ? (equal ? "TRUE" : "FALSE") : (equal ? "FALSE" : "TRUE") };
  }
  const order = orderScalar(state.value, expr.value);
  if (order === "MISMATCH") return { ok: false, code: "attribute_type_mismatch", message: "Compared values do not share a type." };
  if (order === "UNORDERED") return { ok: false, code: "unsupported_comparison", message: "This value type cannot be ordered." };
  const result = expr.op === "LT" ? order < 0
    : expr.op === "LTE" ? order <= 0
      : expr.op === "GT" ? order > 0
        : order >= 0;
  return { ok: true, result: result ? "TRUE" : "FALSE" };
}
