import { describe, expect, it } from "vitest";

import { studyClaimCatalog, verifyStudyInvestigation } from "../analysis/study-verification";
import {
  MAYA_FILE_NAMES,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaStudyOutput,
  mayaWriterOutput,
} from "../testing/maya-fixture";
import { buildReport } from "./application-view-contracts";
import { recomputeScenario, validateWriterReport } from "./writer-report-contracts";

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
});
