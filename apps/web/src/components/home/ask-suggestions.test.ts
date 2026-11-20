import { describe, expect, it } from "vitest";

import { askSuggestions } from "./ask-suggestions";

describe("askSuggestions", () => {
  it("offers nothing before any document is in", () => {
    expect(askSuggestions({ viewer: "staff", documentsIn: 0, stillToCome: 2, toReview: 1 })).toEqual([]);
    expect(askSuggestions({ viewer: "staff" })).toEqual([]);
  });

  it("leaves out lines whose data is zero", () => {
    expect(askSuggestions({ viewer: "staff", documentsIn: 3, stillToCome: 0, toReview: 0 })).toEqual([
      "What do the documents show?",
    ]);
  });

  it("builds staff lines from what is still to come and what needs review", () => {
    expect(askSuggestions({ viewer: "staff", documentsIn: 3, stillToCome: 2, toReview: 4 })).toEqual([
      "What is still to come?",
      "What needs review?",
      "What do the documents show?",
    ]);
  });

  it("speaks in the first person for a client and never offers review", () => {
    expect(askSuggestions({ viewer: "client", documentsIn: 3, stillToCome: 1, toReview: 5 })).toEqual([
      "What do I still need to send?",
      "What do my documents show?",
    ]);
  });
});
