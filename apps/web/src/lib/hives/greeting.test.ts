import { describe, expect, it } from "vitest";

import { greetingLine } from "./greeting";

describe("greetingLine", () => {
  it("includes the first name when provided", () => {
    const line = greetingLine("Dana");
    expect(line).toMatch(/^Good (morning|afternoon|evening), Dana$/);
  });

  it("omits the name when display name is empty", () => {
    const line = greetingLine(null);
    expect(line).toMatch(/^Good (morning|afternoon|evening)$/);
    expect(line).not.toContain(",");
  });
});