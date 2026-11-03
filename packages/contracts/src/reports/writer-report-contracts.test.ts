import { describe, expect, it } from "vitest";

import { studyClaimCatalog, verifyStudyInvestigation } from "../analysis/study-verification";
import { buildFailureDiagnostic } from "../errors/failure-diagnostic";
import {
  MAYA_FILE_NAMES,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaStudyOutput,
  mayaWriterOutput,
} from "../testing/maya-fixture";
import { buildReport } from "./application-view-contracts";
import { numbersIn, numericTokensIn, recomputeScenario, validateWriterReport } from "./writer-report-contracts";

function mayaClaims() {
  const study = verifyStudyInvestigation(mayaStudyOutput(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: MAYA_PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(MAYA_PAGES)),
  });
  if (!study.ok) throw new Error(study.message);
  return studyClaimCatalog(study.value);
}

const claims = mayaClaims();
const fileNames = new Map(Object.entries(MAYA_FILE_NAMES));

function writer(mutate: (output: ReturnType<typeof mayaWriterOutput>) => void = () => {}, audience: "CUSTOMER" | "PRO" = "CUSTOMER") {
  const output = mayaWriterOutput(audience);
  mutate(output);
  return output;
}

describe("validateWriterReport", () => {
  it("accepts Maya's customer and pro reports from the same Study", () => {
    expect(validateWriterReport(writer(), { audience: "CUSTOMER", claims }).ok).toBe(true);
    expect(validateWriterReport(writer(undefined, "PRO"), { audience: "PRO", claims }).ok).toBe(true);
  });

  it("rejects the other audience's report", () => {
    expect(validateWriterReport(writer(undefined, "PRO"), { audience: "CUSTOMER", claims })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_audience_mismatch",
    });
  });

  it("rejects unknown claims and numbers the sources do not contain", () => {
    expect(validateWriterReport(writer((o) => (o.summary[0].claimRefs = ["P9.F0"])), { audience: "CUSTOMER", claims })).toMatchObject({
      diagnosticReason: "writer_claim_unknown",
    });
    expect(
      validateWriterReport(writer((o) => (o.summary[0].text = "Maya read 81 words correct per minute.")), { audience: "CUSTOMER", claims }),
    ).toMatchObject({ diagnosticReason: "writer_number_ungrounded" });
  });

  it("never presents an unverified calculation as a documented finding", () => {
    const asDocumented = writer((o) => {
      o.sections[0].blocks[2].type = "DOCUMENTED";
      o.sections[0].blocks[2].claimRefs = ["P1.C1"];
    });
    expect(validateWriterReport(asDocumented, { audience: "CUSTOMER", claims })).toMatchObject({
      diagnosticReason: "writer_unverified_number",
    });
    const bound = writer((o) => (o.summary[0].text = "The gap is {{calc:P1.C1}} words."));
    expect(validateWriterReport(bound, { audience: "CUSTOMER", claims })).toMatchObject({ diagnosticReason: "writer_unverified_number" });
  });

  it("rejects incompatible block types and claim kinds, including sections[2].blocks[3]", () => {
    const assessmentInUncertainty = writer((o) => {
      o.sections[2].blocks.push({
        type: "UNCERTAINTY",
        text: "Maya is improving but has not reached the goal yet.",
        claimRefs: ["P1.A0"],
      });
    });
    expect(validateWriterReport(assessmentInUncertainty, { audience: "CUSTOMER", claims })).toEqual({
      ok: false,
      message: "The report draft did not pass our checks against the Study.",
      diagnosticReason: "writer_claim_kind",
      diagnosticField: "sections[2].blocks[3]",
    });

    const uncertaintyInInterpretation = writer((o) => {
      o.sections[2].blocks.push({
        type: "INTERPRETATION",
        text: "Only one progress measurement was available after the baseline.",
        claimRefs: ["P1.U0"],
      });
    });
    expect(validateWriterReport(uncertaintyInInterpretation, { audience: "CUSTOMER", claims })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_claim_kind",
      diagnosticField: "sections[2].blocks[3]",
    });

    const limitationInDocumented = writer((o) => {
      o.sections[2].blocks.push({
        type: "DOCUMENTED",
        text: "Comprehension cannot be assessed from these records.",
        claimRefs: ["P3.L0"],
      });
    });
    expect(validateWriterReport(limitationInDocumented, { audience: "CUSTOMER", claims })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_claim_kind",
      diagnosticField: "sections[2].blocks[3]",
    });
  });

  it("requires uncertainties and missing evidence to be visibly surfaced", () => {
    const hidden = writer((o) => {
      o.sections[2].blocks = [{ type: "GENERAL_INFORMATION", text: "Ask for progress data.", claimRefs: [] }];
    });
    expect(validateWriterReport(hidden, { audience: "CUSTOMER", claims })).toMatchObject({ diagnosticReason: "writer_uncertainty_hidden" });

    // Citing an uncertainty only in a QUESTION block or scenario does not visibly surface it.
    const onlyInQuestion = writer((o) => {
      o.sections[2].blocks = [{ type: "QUESTION", text: "Can the team share a reading comprehension score?", claimRefs: ["P3"] }];
    });
    expect(validateWriterReport(onlyInQuestion, { audience: "CUSTOMER", claims })).toMatchObject({
      diagnosticReason: "writer_uncertainty_hidden",
    });

    // A structured IssueList whose content visibly states the missing evidence satisfies coverage without duplicating it in prose.
    const surfacedInIssueList = writer((o) => {
      o.sections[2].blocks = [{ type: "QUESTION", text: "Can the team share a reading comprehension score?", claimRefs: ["P3.F0"] }];
      o.view.push({
        component: "IssueList",
        props: {
          title: "Gaps in the record",
          issues: [{ text: "No reading comprehension score was reported in the evaluation.", severity: "HIGH", claimRefs: ["P3"] }],
        },
      } as never);
    });
    expect(validateWriterReport(surfacedInIssueList, { audience: "CUSTOMER", claims }).ok).toBe(true);

    // A structured component that attaches the claim ID to unrelated text does not count as surfacing the uncertainty.
    const disguisedInIssueList = writer((o) => {
      o.sections[2].blocks = [{ type: "GENERAL_INFORMATION", text: "Ask for progress data.", claimRefs: [] }];
      o.view.push({
        component: "IssueList",
        props: {
          title: "Notes",
          issues: [{ text: "Maya participates in small-group reading.", severity: "LOW", claimRefs: ["P3"] }],
        },
      } as never);
    });
    expect(validateWriterReport(disguisedInIssueList, { audience: "CUSTOMER", claims })).toMatchObject({
      diagnosticReason: "writer_uncertainty_hidden",
    });
  });

  it("rejects a documented scenario value that its claim does not contain", () => {
    const wrong = writer((o) => (o.scenarios[0].parameters[0].value = "500"));
    expect(validateWriterReport(wrong, { audience: "CUSTOMER", claims })).toMatchObject({ diagnosticReason: "writer_number_ungrounded" });
  });

  it("rejects scenario formulas outside the allowed language or over unverified calculations", () => {
    const pow = writer((o) => {
      (o.scenarios[0].results[0] as { formula: unknown }).formula = { op: "^", args: [{ param: "required" }, { value: "2" }] };
    });
    expect(validateWriterReport(pow, { audience: "CUSTOMER", claims })).toMatchObject({ diagnosticReason: "writer_formula_invalid" });
    const unverified = writer((o) => {
      (o.scenarios[0].results[0] as { formula: unknown }).formula = { op: "+", args: [{ ref: "P1.C1" }, { value: "1" }] };
    });
    expect(validateWriterReport(unverified, { audience: "CUSTOMER", claims })).toMatchObject({ diagnosticReason: "writer_unverified_number" });
  });
});

describe("buildReport", () => {
  it("computes scenarios in code and binds the view to verified values only", () => {
    const built = buildReport(writer(), { audience: "CUSTOMER", claims, fileNames });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const [scenario] = built.value.scenarioAnalysis.scenarios;
    expect(scenario.results.map((r) => [r.id, r.status, r.value, r.usesAssumptions])).toEqual([
      ["R1", "CALCULATED", "120", false],
      ["R2", "CALCULATED", "15", true],
    ]);
    const view = built.value.view;
    expect(view.layout).toBe("PROPOSED");
    expect(view.components.map((c) => c.component)).toEqual([
      "Narrative",
      "Metric",
      "Narrative",
      "Timeline",
      "Narrative",
      "ScenarioExplorer",
      "Narrative",
      "KeyFindings",
      "SourceReferences",
    ]);
    expect(view.components[0]).toMatchObject({ blocks: [{ text: expect.stringContaining("a gain of 12 words") }] });
    expect(view.components[1]).toMatchObject({ component: "Metric", value: "12", status: "VERIFIED" });
    const sources = view.components.at(-1);
    expect(sources).toMatchObject({ component: "SourceReferences" });
    expect(JSON.stringify(sources)).toContain("Maya IEP 2025.pdf");
  });

  it("marks a scenario result that cannot be computed as noncalculable", () => {
    const zeroWeeks = writer((o) => (o.scenarios[0].parameters[2].value = "0"));
    const built = buildReport(zeroWeeks, { audience: "CUSTOMER", claims, fileNames });
    expect(built.ok && built.value.scenarioAnalysis.scenarios[0].results[1]).toMatchObject({
      status: "NONCALCULABLE",
      value: null,
      reason: "DIVISION_BY_ZERO",
    });
  });

  it("rejects components outside the catalog and metrics bound to unverified numbers", () => {
    const unknown = writer((o) => o.view.push({ component: "Iframe", props: { src: "https://example.com" } } as never));
    expect(buildReport(unknown, { audience: "CUSTOMER", claims, fileNames })).toMatchObject({ diagnosticReason: "view_component_unknown" });
    const metric = writer((o) => o.view.push({ component: "Metric", props: { label: "Gap", binding: "{{calc:P1.C1}}" } } as never));
    expect(buildReport(metric, { audience: "CUSTOMER", claims, fileNames })).toMatchObject({ diagnosticReason: "writer_unverified_number" });
  });

  it("falls back to a default layout and keeps every section", () => {
    const built = buildReport(writer((o) => (o.view = [])), { audience: "CUSTOMER", claims, fileNames });
    expect(built.ok && built.value.view.layout).toBe("FALLBACK");
    expect(built.ok && built.value.view.components.filter((c) => c.component === "Narrative")).toHaveLength(4);
  });

  it("recomputes a what-if from edited assumptions without touching documented values", () => {
    const built = buildReport(writer(), { audience: "CUSTOMER", claims, fileNames });
    if (!built.ok) throw new Error(built.message);
    const scenario = built.value.scenarioAnalysis.scenarios[0];
    const results = recomputeScenario(scenario, { weeks: "4", required: "999" }, claims);
    expect(results.map((r) => r.value)).toEqual(["120", "30"]);
  });

  it("requires specific supporting claims for Timeline, Checklist, RecordTable and Comparison and rejects broad ANSWER claims", () => {
    const broadTimeline = writer((o) => {
      o.view.push({
        component: "Timeline",
        props: {
          title: "All dates",
          events: [{ date: "March 4, 2025", text: "Reading fluency rose from 62 to 74", claimRefs: ["P1"] }],
        },
      } as never);
    });
    expect(buildReport(broadTimeline, { audience: "CUSTOMER", claims, fileNames })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_claim_kind",
      diagnosticField: "view[8].events[0].claimRefs[0]",
    });

    const emptyChecklist = writer((o) => {
      o.view.push({
        component: "Checklist",
        props: {
          title: "Next steps",
          items: [{ text: "Bring progress records", claimRefs: [] }],
        },
      } as never);
    });
    expect(buildReport(emptyChecklist, { audience: "CUSTOMER", claims, fileNames })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_claim_missing",
      diagnosticField: "view[8].items[0].claimRefs",
    });

    const unreferencedChecklist = writer((o) => {
      o.view.push({
        component: "Checklist",
        props: {
          title: "Next steps",
          items: [{ text: "Ask for a second progress measurement", claimRefs: ["P1.U0"] }],
        },
      } as never);
    });
    expect(buildReport(unreferencedChecklist, { audience: "CUSTOMER", claims, fileNames })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_claim_kind",
      diagnosticField: "view[8].items[0].claimRefs[0]",
    });

    const broadTable = writer((o) => {
      o.view.push({
        component: "RecordTable",
        props: {
          title: "Speech log",
          columns: ["Item", "Minutes"],
          rows: [{ cells: ["Delivered", "360"], claimRefs: ["P2"] }],
        },
      } as never);
    });
    expect(buildReport(broadTable, { audience: "CUSTOMER", claims, fileNames })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_claim_kind",
      diagnosticField: "view[8].rows[0].claimRefs[0]",
    });

    const broadComparison = writer((o) => {
      o.view.push({
        component: "Comparison",
        props: {
          title: "Reading scores",
          leftLabel: "Baseline",
          rightLabel: "Current",
          items: [{ label: "Fluency", left: "62", right: "74", claimRefs: ["P1"] }],
        },
      } as never);
    });
    expect(buildReport(broadComparison, { audience: "CUSTOMER", claims, fileNames })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_claim_kind",
      diagnosticField: "view[8].items[0].claimRefs[0]",
    });

    const precise = writer((o) => {
      o.view.push(
        {
          component: "Timeline",
          props: {
            title: "Progress dates",
            events: [
              { date: "March 4, 2025", text: "Goal of 90 words correct per minute set", claimRefs: ["P1.F1"] },
              { date: "November 2025", text: "Fluency measured at 74 words correct per minute", claimRefs: ["P1.F2"] },
            ],
          },
        } as never,
        {
          component: "Checklist",
          props: {
            title: "Before the meeting",
            items: [{ text: "Review the 360 delivered speech minutes log", claimRefs: ["P2.F0"] }],
          },
        } as never,
      );
    });
    const built = buildReport(precise, { audience: "CUSTOMER", claims, fileNames });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const timeline = built.value.view.components.find((c) => c.component === "Timeline" && c.title === "Progress dates");
    expect(timeline && timeline.component === "Timeline" && timeline.events.map((e) => e.refs.map((r) => r.fileName))).toEqual([
      ["Maya IEP 2025.pdf"],
      ["Progress report Nov 2025.pdf"],
    ]);
    const checklist = built.value.view.components.find((c) => c.component === "Checklist");
    expect(checklist && checklist.component === "Checklist" && checklist.items[0]?.refs.map((r) => r.fileName)).toEqual([
      "Speech service log.xlsx",
    ]);
  });

  it("carries criterionSource and criterion into BoundClaim and BoundBlock without quoting fact statements", () => {
    const withAssessment = writer((o) => {
      o.view.push({
        component: "EvidencePanel",
        props: { title: "Assessment basis", claimIds: ["P1.A0", "P1.F0"] },
      } as never);
    }, "PRO");
    const built = buildReport(withAssessment, { audience: "PRO", claims, fileNames });
    if (!built.ok) throw new Error(built.message);
    const s1 = built.value.view.components.find((c) => c.component === "Narrative" && c.heading === "Reading progress");
    expect(s1 && s1.component === "Narrative" && s1.blocks[1]).toMatchObject({
      type: "INTERPRETATION",
      criterion: "Compare the latest measurement with the baseline and the goal.",
      criterionSource: "GENERAL_KNOWLEDGE",
    });
    const panel = built.value.view.components.find((c) => c.component === "EvidencePanel");
    expect(panel && panel.component === "EvidencePanel" && panel.claims[0]).toMatchObject({
      id: "P1.A0",
      kind: "ASSESSMENT",
      criterion: "Compare the latest measurement with the baseline and the goal.",
      criterionSource: "GENERAL_KNOWLEDGE",
    });
    expect(panel && panel.component === "EvidencePanel" ? panel.claims[0]?.quotes : []).not.toContain(
      "The baseline was 62 words correct per minute.",
    );
  });

  it("deduplicates repeated Narrative sections and removes narrative blocks that duplicate structured components", () => {
    const duplicated = writer((o) => {
      o.sections[2].blocks.push({
        type: "NEXT_STEP",
        text: "Review the 360 delivered speech minutes log.",
        claimRefs: ["P2.F0"],
      });
      o.view.push(
        { component: "Narrative", props: { sectionId: "s1" } } as never,
        { component: "Narrative", props: { sectionId: "summary" } } as never,
        {
          component: "Checklist",
          props: {
            title: "Checklist",
            items: [{ text: "Compare the 360 delivered minutes with the IEP", claimRefs: ["P2.F0"] }],
          },
        } as never,
      );
    });
    const built = buildReport(duplicated, { audience: "CUSTOMER", claims, fileNames });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const narratives = built.value.view.components.filter((c) => c.component === "Narrative");
    expect(narratives.map((n) => (n.component === "Narrative" ? n.heading : null))).toEqual([
      null,
      "Reading progress",
      "Speech services",
      "What is missing",
    ]);
    const s3 = narratives.find((n) => n.component === "Narrative" && n.heading === "What is missing");
    expect(s3 && s3.component === "Narrative" && s3.blocks.some((b) => b.type === "NEXT_STEP")).toBe(false);
  });

  it("distinguishes canonical claim IDs and formatting list markers from factual numbers and does not convert number words into digits", () => {
    expect(numbersIn("Across P1, P1.F0, P1.F2, P2.C0, P1.A0, P1.U0, P1.K0, P1.D0 and P3.L0, see {{calc:P1.C0}} and {{result:S1.R1}}.")).toEqual(
      [],
    );
    expect(numbersIn("Only one progress measurement across four days a week.")).toEqual([]);
    expect(
      numbersIn(
        "1. Review the baseline.\n2) Compare the progress report.\n(3) Ask who decides.\nStep 4: Request comprehension data.\n- 5. Confirm minutes.",
      ),
    ).toEqual([]);
    expect(
      numericTokensIn("1. On March 4, 2025 (p. 2, Section 3), P1.F0 rose 75% to 74.5 across 360 minutes."),
    ).toEqual([
      { normalized: "1", position: 0, category: "list_marker" },
      { normalized: "4", position: 1, category: "date" },
      { normalized: "2025", position: 2, category: "date" },
      { normalized: "2", position: 3, category: "page_ref" },
      { normalized: "3", position: 4, category: "identifier" },
      { normalized: "75", position: 5, category: "percent" },
      { normalized: "74.5", position: 6, category: "decimal" },
      { normalized: "360", position: 7, category: "quantity" },
    ]);
    expect(
      numericTokensIn("2) Second item\n(3) Third item\nStep 4: Fourth item"),
    ).toEqual([
      { normalized: "2", position: 0, category: "list_marker" },
      { normalized: "3", position: 1, category: "list_marker" },
      { normalized: "4", position: 2, category: "list_marker" },
    ]);
    // Misleading punctuation, ordinals, mid-sentence "step N", colons/semicolons and sentence-ending periods are NOT list markers.
    expect(
      numericTokensIn("The score was 74. Ratio: 2:1; (3) items were missing at step 4 and the 2nd review in 2026."),
    ).toEqual([
      { normalized: "74", position: 0, category: "quantity" },
      { normalized: "2", position: 1, category: "quantity" },
      { normalized: "1", position: 2, category: "quantity" },
      { normalized: "3", position: 3, category: "quantity" },
      { normalized: "4", position: 4, category: "quantity" },
      { normalized: "2", position: 5, category: "quantity" },
      { normalized: "2026", position: 6, category: "date" },
    ]);
  });

  it("exempts genuine formatting list markers in Customer and Pro reports while rejecting ungrounded factual numbers", () => {
    // Legitimate formatting list markers at sections[2].blocks[1] (and A2UI items) pass in both Customer and Pro reports.
    for (const audience of ["CUSTOMER", "PRO"] as const) {
      const withListMarkers = writer((o) => {
        o.sections[2].blocks.push(
          {
            type: "QUESTION",
            text: "1. What reading comprehension assessment will the IEP team review?",
            claimRefs: ["P3.F0"],
          },
          {
            type: "NEXT_STEP",
            text: "2) Request the speech log showing 360 delivered minutes.\n(3) Compare against the 480 required minutes.\nStep 4: Ask who decides whether progress is sufficient.",
            claimRefs: ["P2.F0", "P2.F1", "P1.D0"],
          },
        );
        o.view.push({
          component: "Checklist",
          props: {
            title: "Preparation steps",
            items: [
              { text: "1. Bring the November 2025 progress report (74 words correct per minute)", claimRefs: ["P1.F2"] },
              { text: "2) Bring the speech log (360 delivered minutes)", claimRefs: ["P2.F0"] },
              { text: "(3) Confirm the 90 words correct per minute goal for March 4, 2026", claimRefs: ["P1.F1"] },
              { text: "Step 4: Ask who decides whether progress is sufficient", claimRefs: ["P1.D0"] },
            ],
          },
        } as never);
      }, audience);

      expect(validateWriterReport(withListMarkers, { audience, claims }).ok).toBe(true);
      expect(buildReport(withListMarkers, { audience, claims, fileNames }).ok).toBe(true);

      // A list marker in a block does NOT ground that same digit as a factual quantity later in the block.
      const listMarkerDoesNotSelfGround = writer((o) => {
        o.sections[2].blocks[1] = {
          type: "QUESTION",
          text: "1. Ask why only 1 comprehension test was given.",
          claimRefs: ["P3.F0"],
        };
      }, audience);
      expect(validateWriterReport(listMarkerDoesNotSelfGround, { audience, claims })).toEqual({
        ok: false,
        message: "The report draft did not pass our checks against the Study.",
        diagnosticReason: "writer_number_ungrounded",
        diagnosticField: "sections[2].blocks[1]@num[1]:quantity",
      });

      // Misleading punctuation (sentence-final number, mid-sentence "(3)", "step 4" in prose, ordinal "2nd", ratio "2:1", deadline/date/identifier) is still rejected.
      const misleadingPunctuation = writer((o) => {
        o.sections[2].blocks[1] = {
          type: "NEXT_STEP",
          text: "1. Request the (3) missing logs at step 4 before the 2nd review.",
          claimRefs: ["P3.F0"],
        };
      }, audience);
      expect(validateWriterReport(misleadingPunctuation, { audience, claims })).toEqual({
        ok: false,
        message: "The report draft did not pass our checks against the Study.",
        diagnosticReason: "writer_number_ungrounded",
        diagnosticField: "sections[2].blocks[1]@num[1]:quantity",
      });
    }
  });

  it("enforces strict claim-level numeric grounding across Pro summary[1], Customer sections[4].blocks[2] and A2UI", () => {
    // 1. Claim IDs in prose are not treated as factual numbers in Pro summary[1] or A2UI.
    const proClaimIdsInProse = writer((o) => {
      o.summary.push({
        type: "INTERPRETATION",
        text: "Per P1.A0 (supported by P1.F0 and P1.F2), Maya is improving toward the target but has not yet reached it.",
        claimRefs: ["P1.A0"],
      });
    }, "PRO");
    expect(validateWriterReport(proClaimIdsInProse, { audience: "PRO", claims }).ok).toBe(true);
    expect(buildReport(proClaimIdsInProse, { audience: "PRO", claims, fileNames }).ok).toBe(true);

    // 2. Assessment plus compatible atomic FACT and VERIFIED CALCULATION references pass in Pro summary[1].
    const proGroundedInterpretation = writer((o) => {
      o.summary.push({
        type: "INTERPRETATION",
        text: "Rising from 62 to 74 words correct per minute ({{calc:P1.C0}} words gained) toward the 90-word March 2026 goal shows progress.",
        claimRefs: ["P1.A0", "P1.F0", "P1.F1", "P1.F2", "P1.C0"],
      });
    }, "PRO");
    expect(validateWriterReport(proGroundedInterpretation, { audience: "PRO", claims }).ok).toBe(true);
    expect(buildReport(proGroundedInterpretation, { audience: "PRO", claims, fileNames }).ok).toBe(true);

    // 3. Customer sections[4].blocks[2]: UNCERTAINTY, QUESTION and NEXT_STEP blocks can cite specific supporting facts.
    const customerGroundedSection4Block2 = writer((o) => {
      o.sections.push(
        {
          id: "s4",
          heading: "Service delivery details",
          blocks: [{ type: "DOCUMENTED", text: "360 of 480 required speech minutes were delivered.", claimRefs: ["P2.F0", "P2.F1"] }],
        },
        {
          id: "s5",
          heading: "Preparing for the meeting",
          blocks: [
            {
              type: "UNCERTAINTY",
              text: "Only one progress measurement (74 words correct per minute in November 2025) was available after the 62-word baseline.",
              claimRefs: ["P1.U0", "P1.F0", "P1.F2"],
            },
            {
              type: "QUESTION",
              text: "Whether the gain from 62 to 74 words correct per minute is sufficient is decided by the IEP team.",
              claimRefs: ["P1.D0", "P1.F0", "P1.F2"],
            },
            {
              type: "NEXT_STEP",
              text: "Bring the November 2025 progress report showing 74 words correct per minute before the March 2026 review.",
              claimRefs: ["P1.D0", "P1.F1", "P1.F2"],
            },
          ],
        },
      );
    }, "CUSTOMER");
    expect(validateWriterReport(customerGroundedSection4Block2, { audience: "CUSTOMER", claims }).ok).toBe(true);
    expect(buildReport(customerGroundedSection4Block2, { audience: "CUSTOMER", claims, fileNames }).ok).toBe(true);

    // 4. A measurement supported only by another claim (even in the same plan question P1) fails — no question-wide expansion.
    const sameQuestionUncitedFact = writer((o) => {
      o.sections[0].blocks[2] = {
        type: "UNCERTAINTY",
        text: "Only one measurement (74 words correct per minute in November 2025) was available after the baseline.",
        claimRefs: ["P1.U0"],
      };
    }, "CUSTOMER");
    expect(validateWriterReport(sameQuestionUncitedFact, { audience: "CUSTOMER", claims })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_number_ungrounded",
      diagnosticField: "sections[0].blocks[2]@num[0]:quantity",
    });

    const unrelatedClaimMeasurement = writer((o) => {
      o.summary.push({
        type: "INTERPRETATION",
        text: "Maya received 360 of 480 speech minutes.",
        claimRefs: ["P1.A0", "P1.F0"],
      });
    }, "PRO");
    expect(validateWriterReport(unrelatedClaimMeasurement, { audience: "PRO", claims })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_number_ungrounded",
      diagnosticField: "summary[1]@num[0]:quantity",
    });

    // 5. Number words in source claims ("one" in P1.U0) do not ground digit "1" in prose.
    const digitFromWord = writer((o) => {
      o.summary.push({
        type: "UNCERTAINTY",
        text: "Only 1 progress measurement was available after the baseline.",
        claimRefs: ["P1.U0"],
      });
    }, "PRO");
    expect(validateWriterReport(digitFromWord, { audience: "PRO", claims })).toMatchObject({
      ok: false,
      diagnosticReason: "writer_number_ungrounded",
      diagnosticField: "summary[1]@num[0]:quantity",
    });

    // 6. Ungrounded dates, percentages, identifiers, page refs and quantities at Customer sections[4].blocks[2] and Pro summary[1]
    //    report safe token position + category without leaking the numeric value or prose.
    const ungroundedCustomerBlock = writer((o) => {
      o.sections.push(
        {
          id: "s4",
          heading: "Service delivery details",
          blocks: [{ type: "DOCUMENTED", text: "360 of 480 required speech minutes were delivered.", claimRefs: ["P2.F0", "P2.F1"] }],
        },
        {
          id: "s5",
          heading: "Preparing for the meeting",
          blocks: [
            { type: "QUESTION", text: "Who decides whether progress is sufficient?", claimRefs: ["P1.D0"] },
            { type: "NEXT_STEP", text: "Bring the November 2025 progress report.", claimRefs: ["P1.F2"] },
            {
              type: "NEXT_STEP",
              text: "2. Ask the IEP team for 2 updated fluency checks after the 62 wcpm baseline.",
              claimRefs: ["P1.D0", "P1.F0"],
            },
          ],
        },
      );
    }, "CUSTOMER");
    const customerRejected = validateWriterReport(ungroundedCustomerBlock, { audience: "CUSTOMER", claims });
    expect(customerRejected).toEqual({
      ok: false,
      message: "The report draft did not pass our checks against the Study.",
      diagnosticReason: "writer_number_ungrounded",
      diagnosticField: "sections[4].blocks[2]@num[1]:quantity",
    });

    const proPercentRejected = validateWriterReport(
      writer((o) => {
        o.summary.push({
          type: "INTERPRETATION",
          text: "Fluency rose from 62 to 74 words correct per minute, reaching 82.2% of the goal.",
          claimRefs: ["P1.A0", "P1.F0", "P1.F2"],
        });
      }, "PRO"),
      { audience: "PRO", claims },
    );
    expect(proPercentRejected).toMatchObject({
      ok: false,
      diagnosticReason: "writer_number_ungrounded",
      diagnosticField: "summary[1]@num[2]:percent",
    });
    if (!proPercentRejected.ok) {
      const diag = buildFailureDiagnostic({
        component: "writer",
        operation: "validate_writer",
        task: "writer",
        stage: "VALIDATING",
        errorCode: "MODEL_OUTPUT_INVALID",
        diagnosticReason: proPercentRejected.diagnosticReason,
        diagnosticField: proPercentRejected.diagnosticField,
        retryable: true,
        attempt: 1,
      });
      expect(diag).toMatchObject({
        diagnosticReason: "writer_number_ungrounded",
        diagnosticField: "summary[1]@num[2]:percent",
      });
      expect(JSON.stringify(diag)).not.toContain("82.2");
    }

    // 7. A2UI numerical grounding matches Writer validation (ignores claim IDs in prose, rejects ungrounded numbers with position + category).
    const a2uiWithClaimId = writer((o) => {
      o.view.push({
        component: "Checklist",
        props: {
          title: "Meeting checklist",
          items: [{ text: "Review the 360 delivered speech minutes (P2.F0)", claimRefs: ["P2.F0"] }],
        },
      } as never);
    }, "CUSTOMER");
    expect(buildReport(a2uiWithClaimId, { audience: "CUSTOMER", claims, fileNames }).ok).toBe(true);

    const a2uiUngrounded = writer((o) => {
      o.view.push({
        component: "RecordTable",
        props: {
          title: "Speech log",
          columns: ["Item", "Minutes"],
          rows: [{ cells: ["Delivered (P2.F0)", "360 on p. 9"], claimRefs: ["P2.F0"] }],
        },
      } as never);
    }, "CUSTOMER");
    expect(buildReport(a2uiUngrounded, { audience: "CUSTOMER", claims, fileNames })).toMatchObject({
      ok: false,
      component: "a2ui",
      diagnosticReason: "writer_number_ungrounded",
      diagnosticField: "view[8].rows[0].cells[1]@num[1]:page_ref",
    });
  });
});
