import { describe, expect, it } from "vitest";

import { findingsChipLabel } from "./document-labels";

describe("findingsChipLabel", () => {
  it("truncates role labels at 24 characters with an ellipsis and keeps the full string available for titles", () => {
    const long = "Individualized education program annual review";
    const chip = findingsChipLabel(long);
    expect(chip.length).toBeLessThanOrEqual(24);
    expect(chip.endsWith("…")).toBe(true);
    expect(long.length).toBeGreaterThan(24);
  });
});