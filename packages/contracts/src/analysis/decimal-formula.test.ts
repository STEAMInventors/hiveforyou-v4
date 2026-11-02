import { describe, expect, it } from "vitest";

import {
  decimalFromPlain,
  evaluateFormula,
  formatDecimal,
  matchesStatedPrecision,
  parseFormula,
  parseWrittenNumber,
} from "./decimal-formula";

const d = (text: string) => {
  const value = decimalFromPlain(text);
  if (!value) throw new Error(text);
  return value;
};

function evaluate(raw: unknown, values: Record<string, string> = {}) {
  const parsed = parseFormula(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return evaluateFormula(parsed.value, (leaf) => ("param" in leaf ? (values[leaf.param] ? d(values[leaf.param]) : null) : null));
}

describe("parseWrittenNumber", () => {
  it.each([
    ["$1,234.50", "1234.5"],
    ["45%", "45"],
    ["12 minutes per session", "12"],
    ["-3", "-3"],
    ["(250)", "-250"],
    ["1.5x", "1.5"],
  ])("reads %s as %s", (text, expected) => {
    expect(formatDecimal(parseWrittenNumber(text) as never)).toBe(expected);
  });

  it.each(["", "none", "3/14/2025", "12 to 15", "1,23,4"])("rejects %s", (text) => {
    expect(parseWrittenNumber(text)).toBeNull();
  });
});

describe("evaluateFormula", () => {
  it("adds, subtracts and multiplies exactly without floating point", () => {
    const result = evaluate({ op: "+", args: [{ value: "0.1" }, { value: "0.2" }] });
    expect(result.ok && formatDecimal(result.value)).toBe("0.3");
    const product = evaluate({ op: "*", args: [{ value: "1.25" }, { param: "hours" }] }, { hours: "8" });
    expect(product.ok && formatDecimal(product.value)).toBe("10");
  });

  it("divides to twelve places and rounds half away from zero", () => {
    const third = evaluate({ op: "/", args: [{ value: "1" }, { value: "3" }] });
    expect(third.ok && formatDecimal(third.value)).toBe("0.333333333333");
    const rounded = evaluate({ op: "round", args: [{ value: "2.345" }], places: 2 });
    expect(rounded.ok && formatDecimal(rounded.value)).toBe("2.35");
    const negative = evaluate({ op: "round", args: [{ value: "-2.5" }], places: 0 });
    expect(negative.ok && formatDecimal(negative.value)).toBe("-3");
  });

  it("supports min and max", () => {
    const result = evaluate({ op: "max", args: [{ value: "4" }, { op: "min", args: [{ value: "9" }, { value: "7" }] }] });
    expect(result.ok && formatDecimal(result.value)).toBe("7");
  });

  it("reports division by zero and missing inputs as not calculable", () => {
    expect(evaluate({ op: "/", args: [{ value: "1" }, { value: "0" }] })).toEqual({ ok: false, reason: "division_by_zero" });
    expect(evaluate({ op: "+", args: [{ param: "missing" }, { value: "1" }] })).toEqual({ ok: false, reason: "unresolved_input" });
  });

  it.each([
    [{ op: "^", args: [{ value: "2" }, { value: "3" }] }, "formula_operator"],
    [{ op: "-", args: [{ value: "1" }] }, "formula_arity"],
    [{ op: "round", args: [{ value: "1" }], places: 9 }, "formula_round_places"],
    [{ value: "1e9" }, "formula_literal"],
    [{ value: "1", extra: true }, "formula_operator"],
    ["1 + 2", "formula_shape"],
  ])("rejects %j", (raw, reason) => {
    expect(parseFormula(raw)).toEqual({ ok: false, reason });
  });

  it("rejects formulas that are too deep", () => {
    let node: unknown = { value: "1" };
    for (let i = 0; i < 13; i += 1) node = { op: "round", args: [node], places: 0 };
    expect(parseFormula(node)).toEqual({ ok: false, reason: "formula_too_deep" });
  });
});

describe("matchesStatedPrecision", () => {
  it("accepts a result written to fewer places and rejects a wrong one", () => {
    expect(matchesStatedPrecision(d("33.333333"), d("33.3"))).toBe(true);
    expect(matchesStatedPrecision(d("33.6"), d("34"))).toBe(true);
    expect(matchesStatedPrecision(d("33.6"), d("33"))).toBe(false);
    expect(matchesStatedPrecision(d("10"), d("10.5"))).toBe(false);
  });
});
