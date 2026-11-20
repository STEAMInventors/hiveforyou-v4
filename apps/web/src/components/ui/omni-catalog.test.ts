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
  yourQuestions: [
    { id: "q1", question: "Earlier question", answer: "Earlier answer", refs: [] },
  ],
  clientQuestions: [
    { id: "c1", question: "Client question", answer: "Client answer", refs: [] },
  ],
  clientName: "Ada",
};

describe("omniHits", () => {
  it("leads with ask, then suggestions and questions, when the query is empty", () => {
    const hits = omniHits(catalog, "  ");
    expect(hits[0]).toEqual({ kind: "ask", id: "ask" });
    expect(hits.filter((hit) => hit.kind === "suggestion")).toHaveLength(3);
    expect(hits.some((hit) => hit.kind === "question" && hit.audience === "yours")).toBe(true);
    expect(hits.some((hit) => hit.kind === "question" && hit.audience === "client")).toBe(true);
  });

  it("filters statements, open items and documents and caps each group", () => {
    const hits = omniHits(catalog, "2023");
    expect(hits.map((hit) => hit.kind)).toEqual(["ask", "statement", "item", "document"]);
    expect(omniHasMatches(hits)).toBe(true);
    expect(omniHasMatches(omniHits({ ...catalog, statements: [], openItems: [], documents: [] }, "zzzz"))).toBe(false);
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
