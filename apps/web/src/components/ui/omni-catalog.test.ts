import { describe, expect, it } from "vitest";

import { highlightPieces, omniHasMatches, omniHits, type OmniCatalog } from "./omni-catalog";

const catalog: OmniCatalog = {
  suggestions: ["What is still to come?", "Where do the totals come from?", "Extra", "Fourth"],
  statements: [
    { id: "s1", text: "A transfer of 2023 left the account.", topic: "Transfers", pageLabel: "p.2", ref: null },
    { id: "s2", text: "Nothing about a later year.", topic: "Dates", pageLabel: "p.1", ref: null },
  ],
  openItems: [
    { id: "i1", title: "Statement for 2023", kind: "missing", detail: "Still to come", ref: null },
  ],
  documents: [
    { id: "d1", role: "Account statement", typeLabel: "PDF", period: "2023", pages: 4, ref: null },
  ],
};

describe("omniHits", () => {
  it("finds nothing for an empty query: the box only finds, the chat holds suggestions", () => {
    expect(omniHits(catalog, "  ")).toEqual([]);
    expect(omniHasMatches(omniHits(catalog, ""))).toBe(false);
  });

  it("filters statements, open items and documents and caps each group", () => {
    const hits = omniHits(catalog, "2023");
    expect(hits.map((hit) => hit.kind)).toEqual(["statement", "item", "document"]);
    expect(omniHasMatches(hits)).toBe(true);
    expect(omniHasMatches(omniHits({ ...catalog, statements: [], openItems: [], documents: [] }, "zzzz"))).toBe(false);
  });

  it("never matches the chat's suggestions", () => {
    expect(omniHits(catalog, "still to come").map((hit) => hit.kind)).toEqual(["item"]);
  });
});

describe("highlightPieces", () => {
  it("marks the matched span", () => {
    expect(highlightPieces("Year 2023 filing", "2023")).toEqual([
      { text: "Year ", match: false },
      { text: "2023", match: true },
      { text: " filing", match: false },
    ]);
  });
});
