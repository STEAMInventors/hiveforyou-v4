/**
 * Deterministic decimal arithmetic for Canonical Study calculation checks and Writer scenarios
 * (D-041). Values are exact scaled BigInts; there is no floating point anywhere. The formula
 * language is a small tree: + - * / min max round over leaves. Anything outside it is rejected,
 * never repaired.
 */

export type Decimal = { readonly units: bigint; readonly scale: number };

export const FORMULA_OPERATORS = ["+", "-", "*", "/", "min", "max", "round"] as const;
export type FormulaOperator = (typeof FORMULA_OPERATORS)[number];

/**
 * `input` indexes the calculation's own inputs (Study); `ref` names a verified calculation or a
 * previous scenario result (Writer); `param` names a scenario parameter; `value` is a literal.
 */
export type FormulaNode =
  | { readonly value: string }
  | { readonly input: number }
  | { readonly ref: string }
  | { readonly param: string }
  | { readonly op: FormulaOperator; readonly args: readonly FormulaNode[]; readonly places?: number };

export const FORMULA_MAX_NODES = 64;
export const FORMULA_MAX_DEPTH = 12;
const DIVISION_SCALE = 12;
const MAX_SCALE = 24;
const MAX_DIGITS = 40;
const MAX_ROUND_PLACES = 6;

export type FormulaParseResult = { ok: true; value: FormulaNode } | { ok: false; reason: string };

const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.units * pow10(scale - a.scale), b.units * pow10(scale - b.scale), scale];
}

function normalizeDecimal(value: Decimal): Decimal {
  let { units, scale } = value;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return { units, scale };
}

/** Half away from zero, the rule people use on paper. */
function roundTo(value: Decimal, places: number): Decimal {
  if (value.scale <= places) return value;
  const divisor = pow10(value.scale - places);
  const negative = value.units < 0n;
  const magnitude = negative ? -value.units : value.units;
  let quotient = magnitude / divisor;
  if ((magnitude % divisor) * 2n >= divisor) quotient += 1n;
  return normalizeDecimal({ units: negative ? -quotient : quotient, scale: places });
}

export function decimalFromPlain(text: string): Decimal | null {
  if (!PLAIN_DECIMAL.test(text) || text.replace(/[-.]/g, "").length > MAX_DIGITS) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const units = BigInt(`${whole}${fraction}`);
  return normalizeDecimal({ units: negative ? -units : units, scale: fraction.length });
}

/**
 * Reads a single number as a person wrote it: `$1,234.50`, `45%`, `-3`, `12 minutes`, `1.5x`.
 * Returns null when there is no number, more than one number, or a malformed grouping. A percent
 * sign is kept as written (45% reads as 45), so percentage-point arithmetic stays literal.
 */
export function parseWrittenNumber(text: string): Decimal | null {
  const matches = text.match(/-?\(?[$€£]?\s?\d(?:[\d,]*\d)?(\.\d+)?/g);
  if (!matches || matches.length !== 1) return null;
  const raw = matches[0];
  const negative = raw.startsWith("-") || (raw.includes("(") && text.includes(")"));
  const digits = raw.replace(/[-($€£\s]/g, "");
  const [whole, fraction] = digits.split(".");
  if (whole.includes(",") && !/^\d{1,3}(,\d{3})+$/.test(whole)) return null;
  const plain = `${negative ? "-" : ""}${whole.replace(/,/g, "")}${fraction !== undefined ? `.${fraction}` : ""}`;
  return decimalFromPlain(plain);
}

export function formatDecimal(value: Decimal): string {
  const { units, scale } = normalizeDecimal(value);
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? "" : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  const [left, right] = align(a, b);
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * True when `stated` is `computed` written to the precision the writer chose: "33.3" matches
 * 33.3333…, "33" matches 33.4 but not 33.6. A stated value with more precision must match exactly.
 */
export function matchesStatedPrecision(computed: Decimal, stated: Decimal): boolean {
  return compareDecimal(roundTo(computed, stated.scale), stated) === 0;
}

export function parseFormula(raw: unknown): FormulaParseResult {
  let nodes = 0;
  const visit = (value: unknown, depth: number): FormulaNode => {
    nodes += 1;
    if (nodes > FORMULA_MAX_NODES) throw new Error("formula_too_large");
    if (depth > FORMULA_MAX_DEPTH) throw new Error("formula_too_deep");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("formula_shape");
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && typeof record.value === "string") {
      if (!decimalFromPlain(record.value)) throw new Error("formula_literal");
      return { value: record.value };
    }
    if (keys.length === 1 && typeof record.input === "number") {
      if (!Number.isInteger(record.input) || record.input < 0) throw new Error("formula_input");
      return { input: record.input };
    }
    if (keys.length === 1 && typeof record.ref === "string") {
      if (!/^[A-Za-z0-9.]{1,32}$/.test(record.ref)) throw new Error("formula_ref");
      return { ref: record.ref };
    }
    if (keys.length === 1 && typeof record.param === "string") {
      if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(record.param)) throw new Error("formula_param");
      return { param: record.param };
    }
    const op = record.op;
    if (typeof op !== "string" || !(FORMULA_OPERATORS as readonly string[]).includes(op)) {
      throw new Error("formula_operator");
    }
    if (keys.some((key) => key !== "op" && key !== "args" && key !== "places")) throw new Error("formula_shape");
    if (!Array.isArray(record.args)) throw new Error("formula_shape");
    const args = record.args.map((arg) => visit(arg, depth + 1));
    const arity =
      op === "round" ? args.length === 1 : op === "-" || op === "/" ? args.length === 2 : args.length >= 2;
    if (!arity) throw new Error("formula_arity");
    if (op === "round") {
      const places = record.places;
      if (typeof places !== "number" || !Number.isInteger(places) || places < 0 || places > MAX_ROUND_PLACES) {
        throw new Error("formula_round_places");
      }
      return { op, args, places };
    }
    if (record.places !== undefined) throw new Error("formula_shape");
    return { op: op as FormulaOperator, args };
  };
  try {
    return { ok: true, value: visit(raw, 1) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "formula_shape" };
  }
}

export type FormulaLeafResolver = (leaf: Exclude<FormulaNode, { op: FormulaOperator }>) => Decimal | null;

export type FormulaEvaluation =
  | { ok: true; value: Decimal }
  | { ok: false; reason: "unresolved_input" | "division_by_zero" | "out_of_range" };

/** Evaluates a parsed formula. A leaf the resolver cannot supply makes the result noncalculable. */
export function evaluateFormula(node: FormulaNode, resolve: FormulaLeafResolver): FormulaEvaluation {
  const run = (current: FormulaNode): Decimal => {
    if (!("op" in current)) {
      const leaf = "value" in current ? decimalFromPlain(current.value) : resolve(current);
      if (!leaf) throw new Error("unresolved_input");
      return leaf;
    }
    const args = current.args.map(run);
    let result: Decimal;
    switch (current.op) {
      case "+":
      case "-": {
        result = args.slice(1).reduce((total, next) => {
          const [left, right, scale] = align(total, next);
          return { units: current.op === "+" ? left + right : left - right, scale };
        }, args[0]);
        break;
      }
      case "*":
        result = args.slice(1).reduce(
          (total, next) => ({ units: total.units * next.units, scale: total.scale + next.scale }),
          args[0],
        );
        break;
      case "/": {
        const [numerator, denominator] = align(args[0], args[1]);
        if (denominator === 0n) throw new Error("division_by_zero");
        const scaled = numerator * pow10(DIVISION_SCALE + 1);
        const quotient = { units: scaled / denominator, scale: DIVISION_SCALE + 1 };
        result = roundTo(quotient, DIVISION_SCALE);
        break;
      }
      case "min":
      case "max":
        result = args.reduce((best, next) => {
          const order = compareDecimal(next, best);
          return (current.op === "min" ? order < 0 : order > 0) ? next : best;
        });
        break;
      case "round":
        result = roundTo(args[0], current.places ?? 0);
        break;
    }
    result = normalizeDecimal(result);
    if (result.scale > MAX_SCALE) result = roundTo(result, MAX_SCALE);
    const magnitude = result.units < 0n ? -result.units : result.units;
    if (magnitude.toString().length > MAX_DIGITS) throw new Error("out_of_range");
    return result;
  };
  try {
    return { ok: true, value: run(node) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "out_of_range";
    return {
      ok: false,
      reason: reason === "division_by_zero" || reason === "unresolved_input" ? reason : "out_of_range",
    };
  }
}

/** Every leaf of a formula, in order; used to check references before evaluating. */
export function formulaLeaves(node: FormulaNode): Exclude<FormulaNode, { op: FormulaOperator }>[] {
  return "op" in node ? node.args.flatMap(formulaLeaves) : [node];
}
