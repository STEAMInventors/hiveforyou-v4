import { describe, expect, it } from "vitest";

import { isNextNavigationError, safeNextPath } from "./redirects";

describe("safeNextPath", () => {
  it("blocks open redirects", () => {
    expect(safeNextPath("//evil.example")).toBe("/hives");
    expect(safeNextPath("https://evil.example")).toBe("/hives");
    expect(safeNextPath("")).toBe("/hives");
  });

  it("allows internal paths", () => {
    expect(safeNextPath("/hives/abc")).toBe("/hives/abc");
  });
});

describe("isNextNavigationError", () => {
  it("recognizes redirect and not-found digests", () => {
    expect(isNextNavigationError({ digest: "NEXT_REDIRECT;/hives" })).toBe(true);
    expect(isNextNavigationError({ digest: "NEXT_NOT_FOUND" })).toBe(true);
    expect(isNextNavigationError(new Error("nope"))).toBe(false);
    expect(isNextNavigationError({ type: "error" })).toBe(false);
  });
});
