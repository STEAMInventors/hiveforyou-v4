import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirects";

describe("safeNextPath", () => {
  it("blocks open redirects", () => {
    expect(safeNextPath("//evil.com")).toBe("/hives");
    expect(safeNextPath("https://evil.com")).toBe("/hives");
    expect(safeNextPath("")).toBe("/hives");
  });

  it("allows internal paths", () => {
    expect(safeNextPath("/hives/abc")).toBe("/hives/abc");
  });
});
