import { describe, expect, it } from "vitest";

import { buildStateSentence } from "./state-sentence";

describe("buildStateSentence", () => {
  it("joins checklist, review and still-to-come counts", () => {
    expect(
      buildStateSentence({
        documentsIn: 9,
        checklistSize: 14,
        toReview: 8,
        stillToCome: 5,
        lastWrote: { name: "Ada", when: "today at 9:13 AM" },
      }),
    ).toEqual({
      lead: "9 of 14 documents are in. 8 things to review, and 5 records are still to come.",
      trailing: "Ada last wrote today at 9:13 AM.",
    });
  });

  it("uses the singular thing to review", () => {
    expect(
      buildStateSentence({
        documentsIn: 4,
        checklistSize: 6,
        toReview: 1,
        stillToCome: 0,
      }).lead,
    ).toBe("4 of 6 documents are in. 1 thing to review.");
  });

  it("omits zero parts and uses the no-checklist form", () => {
    expect(
      buildStateSentence({
        documentsIn: 3,
        checklistSize: null,
        toReview: 0,
        stillToCome: 1,
      }).lead,
    ).toBe("3 documents are in. 1 record is still to come.");
  });

  it("says nothing is waiting when every count is zero", () => {
    expect(
      buildStateSentence({
        documentsIn: 0,
        checklistSize: null,
        toReview: 0,
        stillToCome: 0,
      }).lead,
    ).toBe("Nothing is waiting on you.");
  });
});
