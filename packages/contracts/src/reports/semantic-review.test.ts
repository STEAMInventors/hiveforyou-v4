import { describe, expect, it } from "vitest";

import type { WriterReport } from "./writer-report-contracts";
import {
  buildSemanticReviewRepairMessage,
  collectReportAssertionUnits,
  prepareSemanticReviewClaimContext,
  reviewWriterReportSemantics,
  semanticReviewHasBlockingFindings,
  semanticReviewInvalidReviewerResponseFinding,
} from "./semantic-review";

const minimalReport: WriterReport = {
  schema: "hive.writer-report/1",
  audience: "CUSTOMER",
  title: "Review",
  summary: [{ type: "INTERPRETATION", text: "Summary text.", claimRefs: ["P1.F0"] }],
  sections: [
    {
      id: "S1",
      heading: "Section",
      blocks: [{ type: "DOCUMENTED", text: "Fact block.", claimRefs: ["P1.F0"] }],
    },
  ],
  scenarios: [],
  view: [],
};

describe("semantic-review", () => {
  it("collects summary and section assertion units", () => {
    const units = collectReportAssertionUnits(minimalReport);
    expect(units.map((u) => u.field)).toEqual(["summary[0]", "sections[0].blocks[0]"]);
  });

  it("prepares slim claim context for reviewer input", () => {
    const ctx = prepareSemanticReviewClaimContext([
      {
        id: "P1.F0",
        kind: "FACT",
        text: "Recorded value.",
        quotes: ["value 12"],
        refs: [{ sourceDocumentId: "doc", pageNumber: 1 }],
        planQuestionId: "P1",
        questionIds: ["P1"],
      },
    ]);
    expect(ctx[0]).toMatchObject({
      id: "P1.F0",
      kind: "FACT",
      refs: [{ sourceDocumentId: "doc", pageNumber: 1 }],
    });
  });

  it("fails closed when no external reviewer is configured", async () => {
    const result = await reviewWriterReportSemantics(minimalReport, {
      audience: "CUSTOMER",
      claims: [],
      externalReviewer: null,
    });
    expect(result.ok).toBe(false);
    expect(semanticReviewHasBlockingFindings(result.findings)).toBe(true);
  });

  it("treats invalid reviewer JSON as a blocking finding", () => {
    const finding = semanticReviewInvalidReviewerResponseFinding("bad json");
    expect(finding.impact).toBe("HIGH");
    expect(semanticReviewHasBlockingFindings([finding])).toBe(true);
  });

  it("builds patch_editorial_plan repair guidance from findings", () => {
    const message = buildSemanticReviewRepairMessage([
      {
        field: "summary[0]",
        error: "writer_citation_misattributed",
        impact: "HIGH",
        message: "Mismatch.",
        hint: "Rewrite or recite claims.",
        citedClaimIds: ["P1.F0"],
        candidateClaimIds: ["P2.F0"],
      },
    ]);
    expect(message).toContain("patch_editorial_plan");
    expect(message).toContain("summary[0]");
    expect(message).toContain("P2.F0");
  });
});
