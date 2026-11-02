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

  it("requires uncertainties and missing evidence to be surfaced", () => {
    const hidden = writer((o) => {
      o.sections[2].blocks = [{ type: "GENERAL_INFORMATION", text: "Ask for progress data.", claimRefs: [] }];
    });
    expect(validateWriterReport(hidden, { audience: "CUSTOMER", claims })).toMatchObject({ diagnosticReason: "writer_uncertainty_hidden" });
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
});
