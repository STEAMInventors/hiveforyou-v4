import { describe, expect, it } from "vitest";

import { truncateChipLabel } from "./truncate-chip-label";

describe("truncateChipLabel", () => {
  it("cuts at a word boundary before the limit", () => {
    expect(truncateChipLabel("Quarterly operating statement packet", 24)).toBe("Quarterly operating…");
  });

  it("returns short labels unchanged", () => {
    expect(truncateChipLabel("Bank statement")).toBe("Bank statement");
  });
});
