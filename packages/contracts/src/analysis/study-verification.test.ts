import { describe, expect, it } from "vitest";

import {
  L001_INITIAL_IEP_DOC_ID,
  L001_INITIAL_IEP_PAGES,
  L001_INITIAL_IEP_PLAN_QUESTION_IDS,
  l001InitialIepStudyAgentTurns,
  MAYA_DOCS,
  MAYA_LIN_VARIANT_IEP_DOC_ID,
  MAYA_LIN_VARIANT_IEP_PAGES,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_REVISION_6_PAGES,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaLinVariantDocumentCenteredStudyAgentTurns,
  mayaRevision6StudyOutput,
  mayaStudyOutput,
} from "../testing/maya-fixture";
import { StudyAgentLedger } from "./study-agent";
import { assessDocumentCenteredStudy, firstUngroundedFindingNumber, parseFindingDateTokenToIso, studyClaimCatalog, verifyStudyInvestigation } from "./study-verification";

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

  it("preserves revision 6 backward compatibility without modification and verifies document-centered output and negative checks", () => {
    const rev6 = verifyStudyInvestigation(mayaRevision6StudyOutput(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
      pages: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
    });
    expect(rev6.ok).toBe(true);
    if (!rev6.ok) return;
    expect(rev6.value.investigation.documents).toBeUndefined();
    expect(rev6.value.investigation.documentFindings).toBeUndefined();
    const rev6Claims = studyClaimCatalog(rev6.value);
    expect(rev6Claims.every((c) => c.planQuestionId !== null)).toBe(true);

    // Build document-centered Study from Maya Lin variant ledger and run negative verifier checks
    const iepPages = Object.entries(MAYA_LIN_VARIANT_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const docLedger = new StudyAgentLedger({
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
      pages: iepPages,
    });
    for (const turn of mayaLinVariantDocumentCenteredStudyAgentTurns()) {
      for (const call of turn) docLedger.execute(call);
    }
    const baseDocOutput = docLedger.assemble();
    const iepContext = {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
      pages: new Map(Object.entries(MAYA_LIN_VARIANT_IEP_PAGES)),
    };
    expect(verifyStudyInvestigation(baseDocOutput, iepContext).ok).toBe(true);

    // Cross-document evidence on a documentFinding -> study_finding_cross_document_evidence
    const crossDocFinding = structuredClone(baseDocOutput);
    crossDocFinding.documentFindings![0]!.evidence.push({
      sourceDocumentId: MAYA_DOCS.progressNov,
      pageNumber: 1,
      quote: "Goal 1 reading fluency: 74 words correct per minute.",
    });
    expect(verifyStudyInvestigation(crossDocFinding, iepContext)).toMatchObject({
      ok: false,
      diagnosticReason: "study_finding_cross_document_evidence",
    });

    // Unsupported number on a documentFinding -> study_finding_number_ungrounded
    const ungroundedFinding = structuredClone(baseDocOutput);
    ungroundedFinding.documentFindings![2]!.valueAsWritten = "5";
    expect(verifyStudyInvestigation(ungroundedFinding, iepContext)).toMatchObject({
      ok: false,
      diagnosticReason: "study_finding_number_ungrounded",
    });

    // Bad relatedFindingIds reference -> study_finding_ref_invalid
    const badRelated = structuredClone(baseDocOutput);
    badRelated.documentFindings![13]!.relatedFindingIds = ["DF999"];
    expect(verifyStudyInvestigation(badRelated, iepContext)).toMatchObject({
      ok: false,
      diagnosticReason: "study_finding_ref_invalid",
    });

    // Bad answer findingIds reference -> study_finding_ref_invalid
    const badAnswerRef = structuredClone(baseDocOutput);
    badAnswerRef.answers[0]!.findingIds = ["DF999"];
    expect(verifyStudyInvestigation(badAnswerRef, iepContext)).toMatchObject({
      ok: false,
      diagnosticReason: "study_finding_ref_invalid",
    });

    // Incomplete page reads on PRIMARY document -> study_primary_document_unread_pages
    const unreadPrimary = structuredClone(baseDocOutput);
    unreadPrimary.documents![0]!.declaredReadCoverage = "PARTIAL_DOCUMENT_READ";
    unreadPrimary.documents![0]!.pagesRead = [1, 2];
    expect(verifyStudyInvestigation(unreadPrimary, iepContext)).toMatchObject({
      ok: false,
      diagnosticReason: "study_primary_document_unread_pages",
    });

    // Misleading coverage claim (declaring FULL_DOCUMENT_READ when pagesRead is incomplete) -> study_coverage_claim_misleading
    const misleadingDoc = structuredClone(baseDocOutput);
    misleadingDoc.documents![0]!.role = "SUPPORTING";
    misleadingDoc.documents![0]!.declaredReadCoverage = "FULL_DOCUMENT_READ";
    misleadingDoc.documents![0]!.pagesRead = [1, 2];
    expect(verifyStudyInvestigation(misleadingDoc, iepContext)).toMatchObject({
      ok: false,
      diagnosticReason: "study_coverage_claim_misleading",
    });

    // Citing evidence from a page not in pagesRead -> study_page_not_read
    const citedUnreadPage = structuredClone(baseDocOutput);
    citedUnreadPage.documents![0]!.role = "SUPPORTING";
    citedUnreadPage.documents![0]!.declaredReadCoverage = "PARTIAL_DOCUMENT_READ";
    citedUnreadPage.documents![0]!.pagesRead = [1, 2];
    expect(verifyStudyInvestigation(citedUnreadPage, iepContext)).toMatchObject({
      ok: false,
      diagnosticReason: "study_page_not_read",
    });
    expect(MAYA_LIN_VARIANT_IEP_DOC_ID).toBeDefined();

    // Independent L001 08_initial_iep.pdf golden (Maya Carter) verifies cleanly and enforces strict quote/number grounding
    const l001Pages = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const l001Ledger = new StudyAgentLedger({
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS,
      pages: l001Pages,
    });
    for (const turn of l001InitialIepStudyAgentTurns()) {
      for (const call of turn) l001Ledger.execute(call);
    }
    const l001Output = l001Ledger.assemble();
    const l001Context = {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS,
      pages: new Map(Object.entries(L001_INITIAL_IEP_PAGES)),
    };
    expect(verifyStudyInvestigation(l001Output, l001Context).ok).toBe(true);
    expect(L001_INITIAL_IEP_DOC_ID).toBeDefined();

    // V4-004I Gate 4C: verify empty optional strings and numeric normalization false-positive fixes in verifyStudyInvestigation
    const normalizedOptionalOutput = structuredClone(l001Output);
    normalizedOptionalOutput.documents![0]!.titleAsPrinted = "" as unknown as null;
    normalizedOptionalOutput.documents![0]!.issuer = "   " as unknown as null;
    normalizedOptionalOutput.documentFindings![0]!.unit = "" as unknown as null;
    normalizedOptionalOutput.documentFindings![0]!.per = "  " as unknown as null;
    normalizedOptionalOutput.documentFindings![0]!.attributedTo = "" as unknown as null;
    const verifiedNormalized = verifyStudyInvestigation(normalizedOptionalOutput, l001Context);
    expect(verifiedNormalized.ok).toBe(true);
    if (verifiedNormalized.ok) {
      expect(verifiedNormalized.value.investigation.documents![0]!.titleAsPrinted).toBeNull();
      expect(verifiedNormalized.value.investigation.documents![0]!.issuer).toBeNull();
      expect(verifiedNormalized.value.investigation.documentFindings![0]!.unit).toBeNull();
      expect(verifiedNormalized.value.investigation.documentFindings![0]!.per).toBeNull();
      expect(verifiedNormalized.value.investigation.documentFindings![0]!.attributedTo).toBeNull();
    }

    // Numeric normalization: English number word "three" in quote grounds "3", ordinal/day-first dates normalize to ISO, while invented numbers/dates fail
    expect(parseFindingDateTokenToIso("November 1st, 2024")).toBe("2024-11-01");
    expect(parseFindingDateTokenToIso("12 November 2024")).toBe("2024-11-12");
    expect(
      firstUngroundedFindingNumber({
        valueAsWritten: "3 consecutive probes",
        statement: "In L001 (E20, p. 2), mastery requires 3 consecutive probes as of 2024-11-12.",
        dates: ["2024-11-12"],
        modality: "PLANNED",
        quotes: ["Mastery Criterion: across three consecutive probes", "Date: 12 November 2024"],
      }),
    ).toBeNull();
    expect(
      firstUngroundedFindingNumber({
        valueAsWritten: "4 consecutive probes",
        statement: "Mastery requires 4 consecutive probes.",
        dates: [],
        modality: "PLANNED",
        quotes: ["Mastery Criterion: across three consecutive probes"],
      }),
    ).toBe("4");
    expect(
      firstUngroundedFindingNumber({
        valueAsWritten: "2024-11-15",
        statement: "Date is 2024-11-15.",
        dates: ["2024-11-15"],
        modality: "STATED",
        quotes: ["Date: 12 November 2024"],
      }),
    ).toBe("11");
  });
});

describe("assessDocumentCenteredStudy", () => {
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const otherId = "44444444-4444-4444-8444-444444444444";

  function finding(overrides: Record<string, unknown> = {}) {
    return {
      id: "DF1",
      sourceDocumentId: sourceId,
      category: "balance",
      subject: "account",
      attribute: "amount due",
      valueAsWritten: "12",
      statement: "The amount due is 12.",
      modality: "STATED",
      evidence: [{ sourceDocumentId: sourceId, pageNumber: 1, quote: "Amount due 12" }],
      ...overrides,
    };
  }

  function inventory(overrides: Record<string, unknown> = {}) {
    return {
      documents: [
        {
          sourceDocumentId: sourceId,
          role: "PRIMARY",
          documentType: "notice",
          roleReasoning: "It states the amount due.",
          pagesRead: [1, 2, 3],
        },
      ],
      documentFindings: [finding()],
      ...overrides,
    };
  }

  it("accepts one source and one atomic finding without a fixed count or category list", () => {
    expect(assessDocumentCenteredStudy(inventory())).toEqual({ ok: true, sourceCount: 1, documentFindingCount: 1 });
    const openCategory = inventory({
      documents: [
        { sourceDocumentId: sourceId, role: "SUPPORTING", documentType: "letter", roleReasoning: "It names the sender." },
        { sourceDocumentId: otherId, role: "REFERENCE", documentType: "schedule", roleReasoning: "It lists dates." },
      ],
      documentFindings: [
        finding({ category: "sprocket" }),
        finding({
          id: "DF2",
          sourceDocumentId: otherId,
          category: "calendar",
          statement: "The date is 4 March.",
          evidence: [{ sourceDocumentId: otherId, pageNumber: 2, quote: "4 March" }],
        }),
      ],
    });
    expect(assessDocumentCenteredStudy(openCategory)).toEqual({ ok: true, sourceCount: 2, documentFindingCount: 2 });
    expect(assessDocumentCenteredStudy(inventory())).not.toHaveProperty("extractionCompletenessStatus");
  });

  it("rejects a missing inventory, missing findings, and a finding that is not atomic evidence", () => {
    expect(assessDocumentCenteredStudy({ documentFindings: [finding()] })).toMatchObject({
      ok: false,
      diagnosticReason: "study_documents_missing",
    });
    expect(assessDocumentCenteredStudy(inventory({ documentFindings: [] }))).toMatchObject({
      ok: false,
      diagnosticReason: "study_findings_missing",
    });
    expect(assessDocumentCenteredStudy(inventory({ documentFindings: [finding({ evidence: [] })] }))).toMatchObject({
      ok: false,
      diagnosticReason: "study_finding_unusable",
    });
    expect(
      assessDocumentCenteredStudy(
        inventory({
          documentFindings: [
            finding({
              evidence: [{ sourceDocumentId: otherId, pageNumber: 1, quote: "Amount due 12" }],
            }),
          ],
        }),
      ),
    ).toMatchObject({ ok: false, diagnosticReason: "study_finding_unusable" });
  });
});
