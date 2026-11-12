import { describe, expect, it } from "vitest";

import type { StudyView } from "@hiveforyou/contracts";

import { bankruptcyC13Fixture } from "./fixtures/bankruptcy-c13";
import { mayaIepFixture } from "./fixtures/maya-iep";

const OBLIGATION = /\b(?:must|required)\b/i;

function renderedText(view: StudyView): string {
  const parts: string[] = [];
  for (const block of view.blocks) {
    for (const row of block.rows) {
      if (row.statement) parts.push(row.statement);
      if (row.kind) parts.push(String(row.kind));
      for (const value of row.values) parts.push(value.valueAsWritten);
    }
  }
  for (const component of view.components ?? []) {
    for (const item of component.items) {
      parts.push(item.title, item.why);
    }
  }
  return parts.join("\n");
}

describe("study obligation wording lint", () => {
  it("Customer and Professional study renders avoid must/required in document reasons and checklist notes", () => {
    for (const audience of ["CUSTOMER", "PRO"] as const) {
      const fixture = mayaIepFixture(audience);
      expect(renderedText(fixture.view)).not.toMatch(OBLIGATION);
      const bankruptcy = bankruptcyC13Fixture(audience);
      expect(renderedText(bankruptcy.view)).not.toMatch(OBLIGATION);
    }
  });
});
