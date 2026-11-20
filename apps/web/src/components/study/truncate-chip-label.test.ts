import { describe, expect, it } from "vitest";

import { truncateChipLabel } from "./truncate-chip-label";

describe("truncateChipLabel", () => {
  it("cuts at a word boundary before the limit", () => {
    expect(truncateChipLabel("Initial Individualized Education Program", 24)).toBe(
      "Initial Individualized…",
    );
  });

  it("returns short labels unchanged", () => {
    expect(truncateChipLabel("Bank statement")).toBe("Bank statement");
  });
});