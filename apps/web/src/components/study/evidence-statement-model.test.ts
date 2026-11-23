import type { StudyView, StudyViewSources } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { buildEvidenceStatementModel } from "./evidence-statement-model";

const DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const minimalView = {
  schema: "hive.study-view/1",
  sections: [],
  blocks: [],
} as StudyView;

const sourcesWithFact: StudyViewSources = {
  documents: {},
  facts: {
    f1: { sourceDocumentId: DOC, pageNumber: 2, quote: "verified quote on page" },
  },
};

describe("buildEvidenceStatementModel", () => {
  it("does not mark checked when citation context and resolved facts are missing", () => {
    const model = buildEvidenceStatementModel({
      chip: { sourceDocumentId: DOC, pageNumber: 2 },
      itemId: null,
      primaryContext: undefined,
      view: minimalView,
      sources: sourcesWithFact,
      canonicalStudy: null,
      openItems: [],
      topics: [],
      coverageGaps: [],
      readProblems: [],
      chipLabelFor: () => "Doc",
    });
    expect(model.status).toBe("uncertain");
    expect(model.headline).toBe("Statement");
  });

  it("marks checked when primary citation context is present", () => {
    const model = buildEvidenceStatementModel({
      chip: { sourceDocumentId: DOC, pageNumber: 2, factIds: ["f1"] },
      itemId: null,
      primaryContext: {
        supportingText: "Maya read 74 wcpm.",
        valueAsWritten: "74",
        verifiedQuote: "verified quote on page",
        factId: "f1",
      },
      view: minimalView,
      sources: sourcesWithFact,
      canonicalStudy: null,
      openItems: [],
      topics: [],
      coverageGaps: [],
      readProblems: [],
      chipLabelFor: () => "Doc",
    });
    expect(model.status).toBe("checked");
    expect(model.headline).toBe("Maya read 74 wcpm.");
  });

  it("marks checked when chip factIds resolve in studyViewSources", () => {
    const model = buildEvidenceStatementModel({
      chip: {
        sourceDocumentId: DOC,
        pageNumber: 2,
        factIds: ["f1"],
        quote: "verified quote on page",
      },
      itemId: null,
      primaryContext: undefined,
      view: minimalView,
      sources: sourcesWithFact,
      canonicalStudy: null,
      openItems: [],
      topics: [],
      coverageGaps: [],
      readProblems: [],
      chipLabelFor: () => "Doc",
    });
    expect(model.status).toBe("checked");
  });
});