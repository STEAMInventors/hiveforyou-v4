import { describe, expect, it } from "vitest";

import { coveredAreasParagraph } from "./front-page";

describe("coveredAreasParagraph", () => {
  it("joins pack titles without changing their capitalization", () => {
    expect(coveredAreasParagraph(["Chapter 13 bankruptcy", "IEP records"])).toBe(
      "Built for Chapter 13 bankruptcy and IEP records. Each area has its own rulebook for what to ask for and what to check.",
    );
  });
});