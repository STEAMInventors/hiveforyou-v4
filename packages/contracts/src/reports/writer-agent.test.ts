import { describe, expect, it } from "vitest";

import { studyClaimCatalog, verifyStudyInvestigation } from "../analysis/study-verification";
import { buildFailureDiagnostic } from "../errors/failure-diagnostic";
import {
  MAYA_FILE_NAMES,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaStudyOutput,
  mayaWriterAgentTurns,
  mayaWriterOutput,
} from "../testing/maya-fixture";
import { A2UI_COMPONENTS, buildReport } from "./application-view-contracts";
import {
  estimateWriterAgentUsd,
  formatWriterAgentBudgetDiagnosticField,
  parseWriterAgentBudgetDiagnosticField,
  WRITER_AGENT_BUDGET,
  WRITER_AGENT_TOOL_NAMES,
  WRITER_AGENT_TOOLS,
  WriterAgentLedger,
  type WriterAgentToolCall,
} from "./writer-agent";
import type { ReportAudience } from "./writer-report-contracts";

const REPORT_RUN_ID = "cccccccc-0000-4000-8000-000000000001";
const FILE_NAMES = new Map(Object.entries(MAYA_FILE_NAMES));

function mayaClaims() {
  const verified = verifyStudyInvestigation(mayaStudyOutput(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: MAYA_PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(MAYA_PAGES)),
  });
  if (!verified.ok) throw new Error(verified.message);
  return studyClaimCatalog(verified.value);
}

const CLAIMS = mayaClaims();

function createLedger(audience: ReportAudience = "CUSTOMER") {
  return new WriterAgentLedger({
    reportRunId: REPORT_RUN_ID,
    audience,
    claims: CLAIMS,
    fileNames: FILE_NAMES,
  });
}

let callSeq = 0;
function makeCall(name: string, args: unknown, id = `wt_${(callSeq += 1)}`): WriterAgentToolCall {
  return {
    id,
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
  };
}

function exec(ledger: WriterAgentLedger, name: string, args: unknown, id?: string) {
  const result = ledger.execute(makeCall(name, args, id));
  return { ...(JSON.parse(result.content) as Record<string, unknown>), ok: result.ok };
}

describe("writer agent tool definitions and budgets", () => {
  it("defines the five fixed tools with closed object parameter schemas", () => {
    expect(WRITER_AGENT_TOOLS.map((tool) => tool.function.name)).toEqual([...WRITER_AGENT_TOOL_NAMES]);
    expect(WRITER_AGENT_TOOL_NAMES).toEqual([
      "set_report_outline",
      "record_section",
      "record_scenario",
      "record_view_component",
      "finish_report",
    ]);
    for (const tool of WRITER_AGENT_TOOLS) {
      expect(tool.function.parameters).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("enforces the configured Writer execution budgets and formats safe diagnostics", () => {
    expect(WRITER_AGENT_BUDGET).toMatchObject({
      wallClockMs: 235_000,
      maxRounds: 5,
      maxToolCalls: 48,
      maxInvalidCalls: 8,
    });
    expect(estimateWriterAgentUsd(100_000, 10_000)).toBeCloseTo(0.45, 5);

    const field = formatWriterAgentBudgetDiagnosticField({
      dimension: "rounds",
      roundsUsed: 5,
      roundsAllowed: 5,
      toolCalls: 14,
      invalidCalls: 3,
      sectionsRecorded: 2,
      viewComponentsRecorded: 5,
    });
    expect(field).toBe("budget.rounds:r5/5:tc14:inv3:s2:v5");
    expect(parseWriterAgentBudgetDiagnosticField(field)).toEqual({
      dimension: "rounds",
      roundsUsed: 5,
      roundsAllowed: 5,
      toolCalls: 14,
      invalidCalls: 3,
      sectionsRecorded: 2,
      viewComponentsRecorded: 5,
    });
    const diagnostic = buildFailureDiagnostic({
      component: "writer",
      operation: "write_report",
      task: "writer",
      stage: "WRITING",
      errorCode: "MODEL_OUTPUT_INVALID",
      diagnosticReason: "writer_agent_budget_exhausted",
      diagnosticField: field,
      retryable: false,
      attempt: 1,
    });
    expect(diagnostic?.diagnosticField).toBe(field);
  });
});

describe("WriterAgentLedger", () => {
  it.each(["CUSTOMER", "PRO"] as const)(
    "completes a clean %s report in one batched turn and matches hive.writer-report/1 and buildReport()",
    (audience) => {
      const ledger = createLedger(audience);
      const [turn] = mayaWriterAgentTurns(audience);
      const results = turn!.map((call) => ledger.execute(call));

      expect(results.every((r) => r.ok)).toBe(true);
      expect(ledger.finished).toBe(true);
      expect(ledger.invalidCalls).toBe(0);
      expect(ledger.toolCalls).toBe(turn!.length);

      const assembled = ledger.assemble();
      expect(assembled).toEqual(mayaWriterOutput(audience));

      const built = buildReport(assembled, { audience, claims: CLAIMS, fileNames: FILE_NAMES });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(built.value.view.audience).toBe(audience);
      for (const component of built.value.view.components) {
        expect(A2UI_COMPONENTS).toContain(component.component);
      }
    },
  );

  it("recovers from a writer_claim_kind error on sections[2].blocks[3] by correcting only that section", () => {
    const ledger = createLedger("CUSTOMER");
    const base = mayaWriterOutput("CUSTOMER");

    // Turn 1: outline, s1, s2 succeed; s3 has an incompatible UNCERTAINTY block citing P1.A0; finish_report is blocked.
    ledger.beginTurn();
    expect(exec(ledger, "set_report_outline", { title: base.title, summary: base.summary }).ok).toBe(true);
    expect(exec(ledger, "record_section", base.sections[0]).ok).toBe(true);
    expect(exec(ledger, "record_section", base.sections[1]).ok).toBe(true);

    const badS3 = {
      ...base.sections[2]!,
      blocks: [
        ...base.sections[2]!.blocks,
        {
          type: "UNCERTAINTY" as const,
          text: "Maya is improving but has not reached the goal yet.",
          claimRefs: ["P1.A0"],
        },
      ],
    };
    const rejectedS3 = exec(ledger, "record_section", badS3);
    expect(rejectedS3).toMatchObject({
      ok: false,
      error: "writer_claim_kind",
      field: "sections[2].blocks[3]",
      hint: expect.stringContaining("ASSESSMENT"),
    });
    expect(ledger.completedSectionCount).toBe(2);

    // Even if scenarios and non-s3 view components are recorded in Turn 1, finish_report refuses until s3 is fixed.
    expect(exec(ledger, "record_scenario", base.scenarios[0]).ok).toBe(true);
    const blockedFinish = exec(ledger, "finish_report", {});
    expect(blockedFinish).toMatchObject({
      ok: false,
      error: "turn_had_rejected_calls",
    });
    expect(ledger.finished).toBe(false);
    // Blocking finish_report due to an earlier rejected call in the same turn does not double-count invalidCalls.
    expect(ledger.invalidCalls).toBe(1);

    // Turn 2: model re-records only s3 (splitting or removing the incompatible block), records view, and finishes.
    ledger.beginTurn();
    expect(exec(ledger, "record_section", base.sections[2]).ok).toBe(true);
    for (const component of base.view) {
      expect(exec(ledger, "record_view_component", component).ok).toBe(true);
    }
    expect(exec(ledger, "finish_report", {}).ok).toBe(true);
    expect(ledger.finished).toBe(true);
    expect(ledger.assemble()).toEqual(base);
  });

  it("recovers from writer_number_ungrounded by citing the suggested candidate claim, while rejecting unsupported numbers", () => {
    const ledger = createLedger("PRO");
    const base = mayaWriterOutput("PRO");

    // 1. Summary UNCERTAINTY block mentions 74 while citing only P1.U0 (which has no numbers) -> rejected with candidateClaimIds including P1.F2.
    const missingRefOutline = exec(ledger, "set_report_outline", {
      title: base.title,
      summary: [
        {
          type: "UNCERTAINTY",
          text: "Only one progress measurement of 74 words correct per minute was available after the baseline.",
          claimRefs: ["P1.U0"],
        },
      ],
    });
    expect(missingRefOutline).toMatchObject({
      ok: false,
      error: "writer_number_ungrounded",
      field: "summary[0]@num[0]:quantity",
      candidateClaimIds: expect.arrayContaining(["P1.F2"]),
    });

    // 2. Summary block mentions 81 (not in any Study claim) -> rejected with empty candidateClaimIds.
    const inventedNumberOutline = exec(ledger, "set_report_outline", {
      title: base.title,
      summary: [
        {
          type: "DOCUMENTED",
          text: "Maya read 81 words correct per minute.",
          claimRefs: ["P1.F0", "P1.F2"],
        },
      ],
    });
    expect(inventedNumberOutline).toMatchObject({
      ok: false,
      error: "writer_number_ungrounded",
      field: "summary[0]@num[0]:quantity",
      candidateClaimIds: [],
      hint: expect.stringContaining("Remove the unsupported number"),
    });

    // 3. Corrected summary citing ["P1.U0", "P1.F2"] succeeds.
    expect(
      exec(ledger, "set_report_outline", {
        title: base.title,
        summary: [
          {
            type: "UNCERTAINTY",
            text: "Only one progress measurement of 74 words correct per minute was available after the baseline.",
            claimRefs: ["P1.U0", "P1.F2"],
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it("enforces atomic claim references and ordering in A2UI view components and allows index replacement", () => {
    const ledger = createLedger("CUSTOMER");
    const base = mayaWriterOutput("CUSTOMER");

    // Referencing section s1 before it is recorded fails.
    expect(exec(ledger, "record_view_component", { component: "Narrative", props: { sectionId: "s1" } })).toMatchObject({
      ok: false,
      error: "view_props_invalid",
    });

    // Referencing scenario S1 before it is recorded fails.
    expect(exec(ledger, "record_view_component", { component: "ScenarioExplorer", props: { scenarioId: "S1" } })).toMatchObject({
      ok: false,
      error: "view_props_invalid",
    });

    // Record outline, sections, and scenario.
    expect(exec(ledger, "set_report_outline", { title: base.title, summary: base.summary }).ok).toBe(true);
    for (const section of base.sections) expect(exec(ledger, "record_section", section).ok).toBe(true);
    const scenarioRes = exec(ledger, "record_scenario", base.scenarios[0]);
    expect(scenarioRes).toMatchObject({
      ok: true,
      scenarioId: "S1",
      results: [
        { id: "R1", status: "CALCULATED", value: "120" },
        { id: "R2", status: "CALCULATED", value: "15" },
      ],
    });

    // Citing broad ANSWER claim P1 in a granular Timeline component when atomic P1.F* exist fails with candidateClaimIds.
    const broadTimeline = exec(ledger, "record_view_component", {
      component: "Timeline",
      props: {
        title: "Key dates",
        events: [{ date: "March 4, 2025", text: "Reading goal of 90 words correct per minute set", claimRefs: ["P1"] }],
      },
    });
    expect(broadTimeline).toMatchObject({
      ok: false,
      error: "writer_claim_kind",
      candidateClaimIds: expect.arrayContaining(["P1.F1"]),
    });
    expect(ledger.recordedViewComponentCount).toBe(0);

    // Next turn: record valid components, then replace index 1 with a Metric bound to scenario result S1.R2.
    ledger.beginTurn();
    expect(exec(ledger, "record_view_component", { component: "Narrative", props: { sectionId: "summary" } }).ok).toBe(true);
    expect(
      exec(ledger, "record_view_component", {
        component: "Metric",
        props: { label: "Reading gain", binding: "{{calc:P1.C0}}", unit: "words per minute" },
      }).ok,
    ).toBe(true);
    expect(
      exec(ledger, "record_view_component", {
        index: 1,
        component: "Metric",
        props: { label: "Weekly catch-up needed", binding: "{{result:S1.R2}}", unit: "minutes" },
      }).ok,
    ).toBe(true);
    expect(
      exec(ledger, "record_view_component", {
        component: "Timeline",
        props: {
          title: "Key dates",
          events: [{ date: "March 4, 2025", text: "Reading goal of 90 words correct per minute set", claimRefs: ["P1.F1"] }],
        },
      }).ok,
    ).toBe(true);
    expect(ledger.recordedViewComponentCount).toBe(3);

    expect(exec(ledger, "finish_report", {}).ok).toBe(true);
    expect(ledger.assemble().view[1]).toEqual({
      component: "Metric",
      props: { label: "Weekly catch-up needed", binding: "{{result:S1.R2}}", unit: "minutes" },
    });
  });

  it("refuses finish_report when a mandatory uncertainty is missing and succeeds after the missing uncertainty is recorded", () => {
    const ledger = createLedger("CUSTOMER");
    const base = mayaWriterOutput("CUSTOMER");

    expect(exec(ledger, "set_report_outline", { title: base.title, summary: base.summary }).ok).toBe(true);
    expect(exec(ledger, "record_section", base.sections[0]).ok).toBe(true);
    expect(exec(ledger, "record_section", base.sections[1]).ok).toBe(true);

    // Omit s3 (which surfaces P3 MISSING_EVIDENCE) -> finish_report refuses with writer_uncertainty_hidden.
    const missingUncertainty = exec(ledger, "finish_report", {});
    expect(missingUncertainty).toMatchObject({
      ok: false,
      error: "writer_uncertainty_hidden",
      candidateClaimIds: ["P3"],
    });
    expect(ledger.finished).toBe(false);

    // Record s3 surfacing P3 and call finish_report again -> succeeds.
    expect(exec(ledger, "record_section", base.sections[2]).ok).toBe(true);
    expect(exec(ledger, "finish_report", {}).ok).toBe(true);
    expect(ledger.finished).toBe(true);
  });

  it("preserves previously accepted state when a replacement fails and handles duplicate/conflicting toolCallIds", () => {
    const ledger = createLedger("CUSTOMER");
    const base = mayaWriterOutput("CUSTOMER");

    const outlineCall = makeCall("set_report_outline", { title: base.title, summary: base.summary }, "dup_1");
    const first = ledger.execute(outlineCall);
    expect(first.ok).toBe(true);
    expect(ledger.toolCalls).toBe(1);

    // Exact replay of dup_1 is idempotent and does not increment toolCalls.
    const replay = ledger.execute(outlineCall);
    expect(replay).toEqual(first);
    expect(ledger.toolCalls).toBe(1);
    expect(ledger.invalidCalls).toBe(0);

    // Conflicting replay with the same toolCallId is rejected and increments invalidCalls.
    const conflict = ledger.execute(makeCall("finish_report", {}, "dup_1"));
    expect(conflict.ok).toBe(false);
    expect(JSON.parse(conflict.content)).toMatchObject({ error: "tool_call_conflict" });
    expect(ledger.invalidCalls).toBe(1);

    // Record valid s1, then attempt to overwrite s1 with an invalid block -> s1 retains its valid state.
    expect(exec(ledger, "record_section", base.sections[0]).ok).toBe(true);
    const badOverwrite = exec(ledger, "record_section", {
      id: "s1",
      heading: "Reading progress",
      blocks: [{ type: "DOCUMENTED", text: "Invented 999 words.", claimRefs: ["P1.F0"] }],
    });
    expect(badOverwrite.ok).toBe(false);

    ledger.beginTurn();
    expect(exec(ledger, "record_section", base.sections[1]).ok).toBe(true);
    expect(exec(ledger, "record_section", base.sections[2]).ok).toBe(true);
    expect(exec(ledger, "finish_report", {}).ok).toBe(true);
    expect(ledger.assemble().sections[0]).toEqual(base.sections[0]);
  });
});
