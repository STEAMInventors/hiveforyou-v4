import { describe, expect, it } from "vitest";
import { isValidCorrelationId } from "./validate-correlation-id";

describe("isValidCorrelationId", () => {
  it("accepts UUID v4", () => {
    expect(isValidCorrelationId("2eb8421a-b784-4bf8-ac2b-540299b61d13")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isValidCorrelationId("not-a-uuid")).toBe(false);
    expect(isValidCorrelationId("")).toBe(false);
  });
});
