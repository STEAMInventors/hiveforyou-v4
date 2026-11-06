import type { StudyViewRow } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { amountDifference, conflictSides, parseAmount, sidesDifference } from "./ComparisonCard";

describe("parseAmount", () => {
  it("reads a value that is only an amount", () => {
    expect(parseAmount("$4,850.00")).toEqual({ value: 4850, decimals: 2, prefix: "$", suffix: "" });
    expect(parseAmount("21,400 gallons")).toEqual({ value: 21400, decimals: 0, prefix: "", suffix: "gallons" });
    expect(parseAmount("15%")).toEqual({ value: 15, decimals: 0, prefix: "", suffix: "%" });
  });

  it("rejects values with other words or numbers around the amount", () => {
    expect(parseAmount("$640.00 per month for 60 months")).toBeNull();
    expect(parseAmount("about $5")).toBeNull();
    expect(parseAmount("May 14, 2026")).toBeNull();
  });
});

describe("amountDifference", () => {
  it("computes the difference of two amounts in the same unit, formatted like them", () => {
    expect(amountDifference("$9,600.00", "$12,180.00")).toBe("$2,580.00");
    expect(amountDifference("$386.50", "$468.50")).toBe("$82.00");
    expect(amountDifference("12%", "15%")).toBe("3%");
    expect(amountDifference("804 kWh", "912 KWH")).toBe("108 kWh");
    expect(amountDifference("0.1", "0.3")).toBe("0.2");
  });

  it("refuses amounts in different units", () => {
    expect(amountDifference("$100.00", "€100.00")).toBeNull();
    expect(amountDifference("$100.00", "100 hours")).toBeNull();
    expect(amountDifference("12%", "15")).toBeNull();
    expect(amountDifference("$100.00", "one hundred dollars")).toBeNull();
  });
});

describe("conflictSides", () => {
  const value = (factId: string, documentId: string, valueAsWritten: string, quote: string, pageNumber = 1) => ({
    factId,
    valueAsWritten,
    sourceRef: { sourceDocumentId: documentId, pageNumber, quote },
  });

  it("groups values by document and computes a difference only for two single-amount sides", () => {
    const row: StudyViewRow = {
      id: "C1",
      statement: "Two amounts",
      values: [value("F1", "a", "$100.00", "Fee $100.00"), value("F2", "b", "$120.00", "Due $120.00"), value("F3", "a", "$100.00", "Fee $100.00", 2)],
    };
    const sides = conflictSides(row);
    expect(sides.map((side) => [side.sourceDocumentId, side.values.map((v) => v.text), side.refs.length])).toEqual([
      ["a", ["$100.00"], 2],
      ["b", ["$120.00"], 1],
    ]);
    expect(sidesDifference(sides)).toBe("$20.00");

    const three = conflictSides({ ...row, values: [...row.values, value("F4", "c", "$90.00", "q")] });
    expect(sidesDifference(three)).toBeNull();
  });
});
