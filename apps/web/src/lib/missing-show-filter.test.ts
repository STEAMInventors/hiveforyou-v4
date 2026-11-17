import { describe, expect, it } from "vitest";

import {
  itemMatchesShowFilter,
  missingShowFilterFromParam,
  parseMissingShowParam,
} from "./missing-show-filter";

describe("parseMissingShowParam", () => {
  it("accepts needs, changed, and missing", () => {
    expect(parseMissingShowParam("needs")).toBe("needs");
    expect(parseMissingShowParam("CHANGED")).toBe("changed");
    expect(parseMissingShowParam(" missing ")).toBe("missing");
  });

  it("falls back to null for unknown values", () => {
    expect(parseMissingShowParam("all")).toBeNull();
    expect(parseMissingShowParam("nope")).toBeNull();
    expect(parseMissingShowParam(null)).toBeNull();
  });
});

describe("missingShowFilterFromParam", () => {
  it("maps null to all", () => {
    expect(missingShowFilterFromParam(null)).toBe("all");
  });
});

describe("itemMatchesShowFilter", () => {
  it("shows every item for all", () => {
    expect(itemMatchesShowFilter("missing", "all")).toBe(true);
  });

  it("filters to a single state", () => {
    expect(itemMatchesShowFilter("needs", "needs")).toBe(true);
    expect(itemMatchesShowFilter("missing", "needs")).toBe(false);
  });
});