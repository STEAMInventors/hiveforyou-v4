import { describe, expect, it } from "vitest";

import { buildWriteAudienceText, WRITE_AUDIENCE_BASE } from "./write-audience";

describe("buildWriteAudienceText", () => {
  it("appends stated audience text for Customer reports", () => {
    expect(buildWriteAudienceText("CUSTOMER", { statedAudience: "A first-time reader" })).toBe(
      `${WRITE_AUDIENCE_BASE.CUSTOMER}; A first-time reader`,
    );
  });

  it("uses the Pro baseline and optional professional perspective", () => {
    expect(buildWriteAudienceText("PRO", { professionalPerspective: "Insurance adjuster" })).toBe(
      `${WRITE_AUDIENCE_BASE.PRO}; Insurance adjuster`,
    );
  });
});
