import { describe, expect, it } from "vitest";

import { MAYA_DOCS, MAYA_PAGES, MAYA_PLAN_QUESTION_IDS, MAYA_RUN_ID, mayaStudyOutput } from "../testing/maya-fixture";
import { studyClaimCatalog, verifyStudyInvestigation } from "./study-verification";

type Output = ReturnType<typeof mayaStudyOutput>;

const context = { processingRunId: MAYA_RUN_ID, planQuestionIds: MAYA_PLAN_QUESTION_IDS, pages: new Map(Object.entries(MAYA_PAGES)) };

function verify(mutate: (output: ReturnType<typeof mayaStudyOutput>) => void = () => {}) {
  const output = mayaStudyOutput();
  mutate(output);
  return verifyStudyInvestigation(output, context);
}

describe("verifyStudyInvestigation", () => {
  it("accepts Maya's study and classifies every calculation", () => {
    const result = verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verification.calculations).toEqual([
      { claimId: "P1.C0", status: "VERIFIED", reason: "RECOMPUTED_MATCH", computedValue: "12", statedValue: "12" },
      { claimId: "P1.C1", status: "UNVERIFIED", reason: "RESULT_MISMATCH", computedValue: "16", statedValue: "18" },
      { claimId: "P2.C0", status: "VERIFIED", reason: "RECOMPUTED_MATCH", computedValue: "75", statedValue: "75" },
    ]);
    expect(result.value.verification.claimIds).toEqual(
      expect.arrayContaining(["P1", "P1.F0", "P1.F2", "P1.C1", "P1.A0", "P1.U0", "P1.D0", "P3.L0"]),
    );
    expect(result.value.verification.counts).toMatchObject({ answers: 3, calculations: 3, verifiedCalculations: 2 });
    expect(result.value.investigation.answers[0].calculations[0].formula).toBeDefined();
  });

  it("normalizes only line endings and whitespace runs in quotes", () => {
    expect(verify().ok).toBe(true);
    const changed = verify((output) => {
      output.answers[0].facts[0].evidence[0].quote = "Baseline: 62 words correct a minute.";
    });
    expect(changed).toMatchObject({ ok: false, diagnosticReason: "quotation_mismatch" });
  });

  it("rejects a quote from a page that was not authorized", () => {
    const result = verify((output) => {
      output.answers[0].evidence[0].pageNumber = 7;
    });
    expect(result).toMatchObject({ ok: false, diagnosticReason: "study_evidence_unauthorized" });
  });

  it("requires every plan question exactly once", () => {
    expect(verify((output) => output.answers.pop())).toMatchObject({ ok: false, diagnosticReason: "study_question_missing" });
    expect(verify((output) => output.answers.push(output.answers[0]))).toMatchObject({
      ok: false,
      diagnosticReason: "study_question_duplicate",
    });
    expect(
      verify((output) => {
        output.answers[2].planQuestionId = "P9";
      }),
    ).toMatchObject({ ok: false, diagnosticReason: "study_question_unknown" });
  });

  it("rejects another run's output and out-of-range fact indexes", () => {
    expect(verify((output) => (output.processingRunId = MAYA_DOCS.iep2025))).toMatchObject({ ok: false, diagnosticReason: "study_run_mismatch" });
    expect(
      verify((output) => {
        output.answers[0].assessments[0].factIndexes = [5];
      }),
    ).toMatchObject({ ok: false, diagnosticReason: "study_fact_index_invalid" });
  });

  it("marks calculations without a formula unverified and non-numeric inputs noncalculable", () => {
    const result = verify((output) => {
      delete (output.answers[1].calculations[0] as { formula?: unknown }).formula;
      output.answers[0].calculations[0].inputs[0].valueAsWritten = "seventy-four";
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verification.calculations.map((item) => [item.claimId, item.status, item.reason])).toEqual([
      ["P1.C0", "NONCALCULABLE", "INPUT_NOT_NUMERIC"],
      ["P1.C1", "UNVERIFIED", "RESULT_MISMATCH"],
      ["P2.C0", "UNVERIFIED", "NO_FORMULA"],
    ]);
  });

  // The provider structured-output schema omits these canonical constraints; this verifier is what enforces them.
  it.each([
    ["evidence document id format", (o: Output) => (o.answers[0].facts[0].evidence[0].sourceDocumentId = "doc-1"), "study_evidence_invalid"],
    ["evidence page minimum", (o: Output) => (o.answers[0].facts[0].evidence[0].pageNumber = 0), "study_evidence_invalid"],
    ["empty quote", (o: Output) => (o.answers[0].facts[0].evidence[0].quote = " "), "study_output_shape"],
    ["quote length", (o: Output) => (o.answers[0].facts[0].evidence[0].quote = "q".repeat(601)), "study_output_shape"],
    ["answer length", (o: Output) => (o.answers[0].answer = "a".repeat(4001)), "study_output_shape"],
    ["fact without evidence", (o: Output) => (o.answers[0].facts[0].evidence = []), "study_output_shape"],
    ["calculation without inputs", (o: Output) => (o.answers[0].calculations[0].inputs = []), "study_output_shape"],
    ["assessment without facts", (o: Output) => (o.answers[0].assessments[0].factIndexes = []), "study_output_shape"],
    ["negative fact index", (o: Output) => (o.answers[0].assessments[0].factIndexes = [-1]), "study_fact_index_invalid"],
    [
      "conflict with one quote",
      (o: Output) => {
        (o.answers[0] as { conflicts: unknown[] }).conflicts = [
          { description: "Conflict", evidence: [o.answers[0].facts[0].evidence[0]] },
        ];
      },
      "study_output_shape",
    ],
    [
      "ignored instruction on a page outside the run",
      (o: Output) => {
        (o as { instructionsIgnored: unknown[] }).instructionsIgnored = [
          { sourceDocumentId: MAYA_DOCS.iep2025, pageNumber: 0, description: "Ignored" },
        ];
      },
      "study_evidence_unauthorized",
    ],
  ])("rejects %s", (_label, mutate, diagnosticReason) => {
    expect(verify(mutate)).toMatchObject({ ok: false, diagnosticReason });
  });

  it("marks formulas outside the canonical formula grammar unverified", () => {
    const deep = (depth: number): unknown => (depth === 1 ? { input: 0 } : { op: "round", places: 0, args: [deep(depth - 1)] });
    const cases: unknown[] = [
      { op: "-", args: [{ input: 0 }, { value: "1,000" }] },
      { op: "round", places: 7, args: [{ input: 0 }] },
      { op: "+", args: [] },
      { op: "-", args: [{ input: 0 }, {}] },
      deep(13),
    ];
    for (const formula of cases) {
      const result = verify((output) => {
        (output.answers[0].calculations[0] as { formula?: unknown }).formula = formula;
      });
      expect(result.ok && result.value.verification.calculations[0]).toMatchObject({ status: "UNVERIFIED", reason: "FORMULA_INVALID" });
    }
  });

  it("marks an input value that its quote does not contain as unverified", () => {
    const result = verify((output) => {
      output.answers[1].calculations[0].inputs[0].evidence = [output.answers[1].facts[1].evidence[0]];
    });
    expect(result.ok && result.value.verification.calculations[2]).toMatchObject({ status: "UNVERIFIED", reason: "INPUT_NOT_QUOTED" });
  });
});

describe("studyClaimCatalog", () => {
  it("lists claims with refs, quotes, assessment provenance and numeric statuses without quoting fact statements", () => {
    const result = verify();
    if (!result.ok) throw new Error(result.message);
    const claims = studyClaimCatalog(result.value);
    expect(claims.find((claim) => claim.id === "P1.C1")).toMatchObject({ kind: "CALCULATION", numericStatus: "UNVERIFIED" });
    expect(claims.find((claim) => claim.id === "P3")).toMatchObject({ kind: "ANSWER", answerStatus: "MISSING_EVIDENCE" });
    expect(claims.find((claim) => claim.id === "P1.F1")?.refs).toEqual([{ sourceDocumentId: MAYA_DOCS.iep2025, pageNumber: 1 }]);
    const assessment = claims.find((claim) => claim.id === "P1.A0");
    expect(assessment).toMatchObject({
      kind: "ASSESSMENT",
      criterion: "Compare the latest measurement with the baseline and the goal.",
      criterionSource: "GENERAL_KNOWLEDGE",
    });
    expect(assessment?.quotes).not.toContain("The baseline was 62 words correct per minute.");
    expect(assessment?.quotes).toContain("Baseline: 62 words correct per minute.");
  });
});
