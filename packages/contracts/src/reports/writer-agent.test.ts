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
  mayaWriterComposeTurns,
  mayaWriterOutput,
  mayaWriterPresentationPlan,
} from "../testing/maya-fixture";
import { A2UI_COMPONENTS, buildReport } from "./application-view-contracts";
import {
  estimateWriterAgentUsd,
  formatWriterAgentBudgetDiagnosticField,
  parseWriterAgentBudgetDiagnosticField,
  WRITER_AGENT_BUDGET,
  WRITER_AGENT_TOOL_NAMES,
  WRITER_AGENT_TOOLS,
  WRITER_COMPOSE_TOOL_NAMES,
  WRITER_COMPOSE_TOOLS,
  WRITER_PRESENTATION_PLAN_SCHEMA,
  WriterAgentLedger,
  WriterCompiler,
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

function exec(ledger: WriterAgentLedger, name: string, args: unknown, id?: string): Record<string, unknown> & { ok: boolean } {
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
    });
    expect("maxInvalidCalls" in WRITER_AGENT_BUDGET).toBe(false);
    expect(estimateWriterAgentUsd(100_000, 10_000)).toBeCloseTo(0.45, 5);

    const field = formatWriterAgentBudgetDiagnosticField({
      dimension: "rounds",
      roundsUsed: 5,
      roundsAllowed: 5,
      toolCalls: 14,
      rejectedUnits: 3,
      sectionsRecorded: 2,
      viewComponentsRecorded: 5,
    });
    expect(field).toBe("budget.rounds:r5/5:tc14:inv3:s2:v5");
    expect(parseWriterAgentBudgetDiagnosticField(field)).toEqual({
      dimension: "rounds",
      roundsUsed: 5,
      roundsAllowed: 5,
      toolCalls: 14,
      rejectedUnits: 3,
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
      ungroundedValue: "74",
      candidateClaimIds: expect.arrayContaining(["P1.F2"]),
      hint: expect.stringContaining('"74"'),
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
      ungroundedValue: "81",
      candidateClaimIds: [],
      hint: expect.stringContaining('Remove "81"'),
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

describe("WriterCompiler structured composition and targeted unit correction (D-047)", () => {
  it("defines compose_writer_report and apply_writer_correction with closed object parameter schemas", () => {
    expect(WRITER_COMPOSE_TOOLS.map((tool) => tool.function.name)).toEqual([...WRITER_COMPOSE_TOOL_NAMES]);
    expect(WRITER_COMPOSE_TOOL_NAMES).toEqual(["compose_writer_report", "apply_writer_correction"]);
    for (const tool of WRITER_COMPOSE_TOOLS) {
      expect(tool.function.parameters).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it.each(["CUSTOMER", "PRO"] as const)(
    "completes %s report generation with presentation planning and dynamic A2UI selection in a single compose_writer_report call",
    (audience) => {
      const compiler = new WriterCompiler({
        reportRunId: REPORT_RUN_ID,
        audience,
        claims: CLAIMS,
        fileNames: FILE_NAMES,
      });
      const [turn] = mayaWriterComposeTurns(audience);
      const res = compiler.execute(turn![0]!);

      expect(res.ok).toBe(true);
      expect(compiler.finished).toBe(true);
      expect(compiler.currentPresentationPlan).toEqual({
        schema: WRITER_PRESENTATION_PLAN_SCHEMA,
        ...mayaWriterPresentationPlan(audience),
      });

      const assembled = compiler.assemble();
      expect(assembled).toEqual(mayaWriterOutput(audience));

      const built = buildReport(assembled, { audience, claims: CLAIMS, fileNames: FILE_NAMES });
      expect(built.ok).toBe(true);
    },
  );

  it("supports variable section counts, zero scenarios, and dynamic A2UI component selection without artificial constraints", () => {
    const compiler = createLedger("PRO");
    const state = compiler.compileUnits({
      presentationPlan: {
        summaryDetailLevel: "CONCISE",
        priorityFindings: [{ claimId: "P1.C0", priority: "HIGH" }],
        sections: [{ id: "s1", heading: "Concise synthesis", priority: "HIGH", claimIds: ["P1.F0", "P1.F2", "P1.U0", "P3"] }],
        components: [
          { component: "Narrative", sectionId: "summary", claimIds: ["P1.F0", "P1.F2", "P1.C0"] },
          { component: "Comparison", claimIds: ["P1.F0", "P1.F2"] },
          { component: "IssueList", claimIds: ["P1.U0", "P3"] },
        ],
      },
      title: "Focused IEP synthesis",
      summary: [
        {
          type: "DOCUMENTED",
          text: "Fluency increased from 62 to 74 words correct per minute ({{calc:P1.C0}} words gained).",
          claimRefs: ["P1.F0", "P1.F2", "P1.C0"],
        },
      ],
      sections: [
        {
          id: "s1",
          heading: "Concise synthesis",
          blocks: [
            {
              type: "INTERPRETATION",
              text: "Maya is improving toward the 90-word target.",
              claimRefs: ["P1.A0", "P1.F1"],
            },
          ],
        },
      ],
      scenarios: [],
      view: [
        { component: "Narrative", props: { sectionId: "summary" } },
        {
          component: "Comparison",
          props: {
            title: "Fluency progression",
            leftLabel: "Baseline",
            rightLabel: "November 2025",
            items: [{ label: "Words correct per minute", left: "62", right: "74", claimRefs: ["P1.F0", "P1.F2"] }],
          },
        },
        {
          component: "IssueList",
          props: {
            title: "Open evidence gaps",
            issues: [
              { text: "Only one progress measurement after the baseline was available.", severity: "MEDIUM", claimRefs: ["P1.U0"] },
              { text: "No reading comprehension score was reported in the evaluation.", severity: "HIGH", claimRefs: ["P3"] },
            ],
          },
        },
      ],
    });

    expect(state.ok).toBe(true);
    expect(state.acceptedSectionIds).toEqual(["s1"]);
    expect(state.acceptedScenarioIds).toEqual([]);
    const built = buildReport(state.report, { audience: "PRO", claims: CLAIMS, fileNames: FILE_NAMES });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.view.components.map((c) => c.component)).toEqual([
      "Narrative",
      "Comparison",
      "IssueList",
      "Narrative",
      "SourceReferences",
    ]);
  });

  it("preserves accepted sections, scenarios and view components when one section fails, and finishes via apply_writer_correction", () => {
    const compiler = createLedger("CUSTOMER");
    const base = mayaWriterOutput("CUSTOMER");
    const badDraft = structuredClone(base);
    // Corrupt only s2 with an ungrounded number 999; s1, s3, summary, S1, and non-s2 view components are valid.
    badDraft.sections[1]!.blocks[0]!.text = "Maya received 999 of 480 required speech minutes.";

    const first = exec(compiler, "compose_writer_report", {
      presentationPlan: mayaWriterPresentationPlan("CUSTOMER"),
      title: badDraft.title,
      summary: badDraft.summary,
      sections: badDraft.sections,
      scenarios: badDraft.scenarios,
      view: badDraft.view,
    });

    expect(first.ok).toBe(false);
    expect(first).toMatchObject({
      error: "writer_number_ungrounded",
      ungroundedValue: "999",
      acceptedSectionIds: ["s1", "s3"],
      acceptedScenarioIds: ["S1"],
      acceptedViewComponentCount: 7,
      pendingViewComponents: [
        {
          index: 4,
          component: "Narrative",
          waitingOn: { kind: "section", id: "s2" },
        },
      ],
      rejectedUnits: 1,
    });
    expect(compiler.completedSectionCount).toBe(2);
    expect(compiler.rejectedUnits).toBe(1);

    // Apply targeted correction for ONLY s2; pending Narrative(s2) at slot 4 revalidates automatically and preserves original ordering!
    const corrected = exec(compiler, "apply_writer_correction", {
      sections: [base.sections[1]!],
    });

    expect(corrected.ok).toBe(true);
    expect(compiler.finished).toBe(true);
    const finalReport = compiler.assemble();
    expect(finalReport.sections.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(finalReport.view).toEqual(base.view);
    expect(buildReport(finalReport, { audience: "CUSTOMER", claims: CLAIMS, fileNames: FILE_NAMES }).ok).toBe(true);
  });

  it("reproduces and resolves the Customer failure budget.invalid_calls:r2/5:tc20:inv9:s5:v10 without terminating on rejectedUnits", () => {
    const compiler = createLedger("CUSTOMER");
    const base = mayaWriterOutput("CUSTOMER");

    // 5 planned sections (s1..s5) and 10 planned view components (indices 0..9).
    // In Turn 1, s2 and s4 fail validation, and 4 view components (indices 3, 5, 7, 9) have independent errors,
    // while view[4] (Narrative s2) and view[8] (Narrative s4) depend on the failed sections.
    // Total independent rejected units in Turn 1 = 6; in Turn 2, 3 partial repairs fail (total rejectedUnits = 9 > old maxInvalidCalls=8),
    // and Turn 3 completes the remaining fixes so the report finishes with 5 sections and 10 view components in exact order.
    const sectionsTurn1 = [
      base.sections[0]!,
      {
        id: "s2",
        heading: "Speech services",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "Maya received 999 of 480 required speech minutes.",
            claimRefs: ["P2.F0", "P2.F1"],
          },
        ],
      },
      base.sections[2]!,
      {
        id: "s4",
        heading: "Progress interpretation",
        blocks: [
          {
            type: "UNCERTAINTY" as const,
            text: "Maya is improving toward the fluency goal.",
            claimRefs: ["P1.A0"], // ASSESSMENT not allowed in UNCERTAINTY block
          },
        ],
      },
      {
        id: "s5",
        heading: "Questions for the IEP team",
        blocks: [
          {
            type: "QUESTION" as const,
            text: "Whether the gain from 62 to 74 words correct per minute is sufficient is decided by the IEP team.",
            claimRefs: ["P1.D0", "P1.F0", "P1.F2"],
          },
        ],
      },
    ];

    const viewTurn1 = [
      { component: "Narrative", props: { sectionId: "summary" } }, // 0: valid
      { component: "Metric", props: { label: "Reading gain", binding: "{{calc:P1.C0}}", unit: "words per minute" } }, // 1: valid
      { component: "Narrative", props: { sectionId: "s1" } }, // 2: valid
      {
        // 3: fails with broad ANSWER P1 when atomic facts exist
        component: "Timeline",
        props: {
          title: "Key dates",
          events: [{ date: "March 4, 2025", text: "Reading goal of 90 words correct per minute set", claimRefs: ["P1"] }],
        },
      },
      { component: "Narrative", props: { sectionId: "s2" } }, // 4: pending on s2 (NOT counted as independent rejection)
      {
        // 5: fails with claim_kind (UNCERTAINTY P1.U0 in Checklist, which requires page-backed EVIDENCE_GRANULAR_KINDS)
        component: "Checklist",
        props: {
          title: "Meeting preparation",
          items: [{ text: "Bring progress monitoring records.", claimRefs: ["P1.U0"] }],
        },
      },
      { component: "ScenarioExplorer", props: { scenarioId: "S1" } }, // 6: valid
      {
        // 7: fails with ungrounded number 888 in Comparison
        component: "Comparison",
        props: {
          title: "Speech minutes",
          leftLabel: "Delivered",
          rightLabel: "Required",
          items: [{ label: "Minutes", left: "360", right: "888", claimRefs: ["P2.F0", "P2.F1"] }],
        },
      },
      { component: "Narrative", props: { sectionId: "s4" } }, // 8: pending on s4 (NOT counted as independent rejection)
      {
        // 9: fails with pageless claim in EvidencePanel
        component: "EvidencePanel",
        props: {
          title: "Supporting quotes",
          claimIds: ["P1.D0"], // DETERMINATION has refs, let's also include P1.U0 which is not allowed in EvidencePanel
        },
      },
    ];
    // Make view[9] cite P1.U0 so it fails with writer_claim_kind on EvidencePanel
    viewTurn1[9] = {
      component: "EvidencePanel",
      props: {
        title: "Supporting quotes",
        claimIds: ["P1.U0"],
      },
    };

    const turn1Res = exec(compiler, "compose_writer_report", {
      presentationPlan: mayaWriterPresentationPlan("CUSTOMER"),
      title: base.title,
      summary: base.summary,
      sections: sectionsTurn1,
      scenarios: base.scenarios,
      view: viewTurn1,
    });

    expect(turn1Res.ok).toBe(false);
    // 2 sections (s2, s4) + 4 independent view components (3, 5, 7, 9) = 6 rejectedUnits.
    // Pending Narrative(s2) at index 4 and Narrative(s4) at index 8 are NOT counted as failures!
    expect(compiler.rejectedUnits).toBe(6);
    expect(turn1Res.acceptedSectionIds).toEqual(["s1", "s3", "s5"]);
    expect(turn1Res.acceptedViewComponentCount).toBe(4); // indices 0, 1, 2, 6
    expect(turn1Res.pendingViewComponents).toEqual([
      { index: 4, component: "Narrative", waitingOn: { kind: "section", id: "s2" } },
      { index: 8, component: "Narrative", waitingOn: { kind: "section", id: "s4" } },
    ]);

    const rejections1 = turn1Res.rejections as {
      unit: string;
      id?: string;
      index?: number;
      error: string;
      field?: string;
      ungroundedValue?: string;
      hint?: string;
      candidateClaimIds?: string[];
    }[];
    expect(rejections1).toHaveLength(6);
    // Verify precise feedback on each rejection:
    const rS2 = rejections1.find((r) => r.unit === "section" && r.id === "s2")!;
    expect(rS2).toMatchObject({
      error: "writer_number_ungrounded",
      ungroundedValue: "999",
      field: "sections[1].blocks[0]@num[0]:quantity",
      hint: expect.stringContaining('"999"'),
    });
    const rView3 = rejections1.find((r) => r.unit === "view" && r.index === 3)!;
    expect(rView3).toMatchObject({
      error: "writer_claim_kind",
      candidateClaimIds: expect.arrayContaining(["P1.F1"]),
      hint: expect.stringContaining("Allowed claim kinds for Timeline"),
    });
    const rView5 = rejections1.find((r) => r.unit === "view" && r.index === 5)!;
    expect(rView5).toMatchObject({
      error: "writer_claim_kind",
      hint: expect.stringContaining("Allowed claim kinds for Checklist"),
      candidateClaimIds: expect.arrayContaining(["P1.F0", "P1.F1", "P1.F2"]),
    });
    expect(rView5.candidateClaimIds).not.toContain("P1.U0"); // P1.U0 has no pages and wrong kind
    const rView7 = rejections1.find((r) => r.unit === "view" && r.index === 7)!;
    expect(rView7).toMatchObject({
      error: "writer_number_ungrounded",
      ungroundedValue: "888",
      field: "view[7].items[0].right@num[0]:quantity",
    });

    // Turn 2: fix s2 and s4 (which automatically resolves pending view[4] and view[8]!),
    // fix view[3], but still have 3 rejected units on view[5], view[7], view[9] -> total rejectedUnits reaches 9!
    const turn2Res = exec(compiler, "apply_writer_correction", {
      sections: [
        base.sections[1]!,
        {
          id: "s4",
          heading: "Progress interpretation",
          blocks: [
            {
              type: "INTERPRETATION",
              text: "Maya is improving toward the fluency goal.",
              claimRefs: ["P1.A0"],
            },
          ],
        },
      ],
      view: [
        {
          index: 3,
          component: "Timeline",
          props: {
            title: "Key dates",
            events: [{ date: "March 4, 2025", text: "Reading goal of 90 words correct per minute set", claimRefs: ["P1.F1"] }],
          },
        },
        // Still invalid on 5, 7, 9 to push rejectedUnits to 9 (which previously triggered budget.invalid_calls:r2/5:tc20:inv9:s5:v10):
        viewTurn1[5]!,
        viewTurn1[7]!,
        viewTurn1[9]!,
      ].map((v, idx) => (idx === 0 ? v : { ...v, index: [3, 5, 7, 9][idx]! })),
    });

    expect(turn2Res.ok).toBe(false);
    expect(compiler.rejectedUnits).toBe(9);
    expect(compiler.completedSectionCount).toBe(5);
    expect(turn2Res.pendingViewComponents).toEqual([]);
    // Accepted view components now include 0, 1, 2, 3, 4 (revalidated s2!), 6, 8 (revalidated s4!) = 7 components
    expect(turn2Res.acceptedViewComponentCount).toBe(7);

    // Turn 3: repair remaining view slots 5, 7, 9 -> report completes with all 5 sections and 10 view components in exact slot order!
    const turn3Res = exec(compiler, "apply_writer_correction", {
      view: [
        {
          index: 5,
          component: "Checklist",
          props: {
            title: "Meeting preparation",
            items: [{ text: "Bring the November 2025 progress report showing 74 words correct per minute.", claimRefs: ["P1.F2"] }],
          },
        },
        {
          index: 7,
          component: "Comparison",
          props: {
            title: "Speech minutes",
            leftLabel: "Delivered",
            rightLabel: "Required",
            items: [{ label: "Minutes", left: "360", right: "480", claimRefs: ["P2.F0", "P2.F1"] }],
          },
        },
        {
          index: 9,
          component: "EvidencePanel",
          props: {
            title: "Supporting quotes",
            claimIds: ["P1.F2", "P2.F0"],
          },
        },
      ],
    });

    expect(turn3Res.ok).toBe(true);
    expect(compiler.finished).toBe(true);
    expect(compiler.rejectedUnits).toBe(9);
    const finalReport = compiler.assemble();
    expect(finalReport.sections.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(finalReport.view).toHaveLength(10);
    expect(finalReport.view.map((v) => v.component)).toEqual([
      "Narrative",
      "Metric",
      "Narrative",
      "Timeline",
      "Narrative",
      "Checklist",
      "ScenarioExplorer",
      "Comparison",
      "Narrative",
      "EvidencePanel",
    ]);
    // Verify slot 1 (Metric) and slot 6 (ScenarioExplorer) were never overwritten by targeted repairs of 3, 5, 7, 9
    expect(finalReport.view[1]).toEqual(viewTurn1[1]);
    expect(finalReport.view[4]).toEqual({ component: "Narrative", props: { sectionId: "s2" } });
    expect(finalReport.view[6]).toEqual(viewTurn1[6]);
    expect(finalReport.view[8]).toEqual({ component: "Narrative", props: { sectionId: "s4" } });

    const built = buildReport(finalReport, { audience: "CUSTOMER", claims: CLAIMS, fileNames: FILE_NAMES });
    expect(built.ok).toBe(true);

    // 8. When a pending component references a dependency that is NEVER resolved, compileUnits returns ok: false
    //    and finish_report refuses to publish unresolved dependencies.
    const unresolvedCompiler = createLedger("CUSTOMER");
    const unresolvedDraft = structuredClone(base);
    unresolvedDraft.sections[1]!.blocks[0]!.text = "Maya received 999 of 480 required speech minutes.";
    const unresolvedTurn1 = exec(unresolvedCompiler, "compose_writer_report", {
      presentationPlan: mayaWriterPresentationPlan("CUSTOMER"),
      title: unresolvedDraft.title,
      summary: unresolvedDraft.summary,
      sections: unresolvedDraft.sections,
      scenarios: unresolvedDraft.scenarios,
      view: unresolvedDraft.view,
    });
    expect(unresolvedTurn1.ok).toBe(false);
    expect(unresolvedTurn1.pendingViewComponents).toEqual([
      { index: 4, component: "Narrative", waitingOn: { kind: "section", id: "s2" } },
    ]);
    // Correction patch that does NOT repair s2 leaves view[4] pending and refuses publication.
    const unresolvedTurn2 = exec(unresolvedCompiler, "apply_writer_correction", {
      title: base.title,
    });
    expect(unresolvedTurn2.ok).toBe(false);
    expect(unresolvedCompiler.finished).toBe(false);
    expect(unresolvedTurn2.pendingViewComponents).toEqual([
      { index: 4, component: "Narrative", waitingOn: { kind: "section", id: "s2" } },
    ]);
    expect(unresolvedTurn2.rejections).toEqual([
      expect.objectContaining({
        unit: "view",
        error: "view_props_invalid",
        field: "view[4]",
      }),
    ]);

    // 9. When a pending component's dependency is corrected, the pending component is revalidated and rejected if its own props are invalid.
    const pendingInvalidCompiler = createLedger("CUSTOMER");
    const badScenarioDraft = structuredClone(base);
    // Corrupt S1 so Metric bound to {{result:S1.R2}} becomes pending on S1, while also giving that Metric an invalid empty label!
    badScenarioDraft.scenarios[0]!.parameters[0]!.value = "999";
    badScenarioDraft.view[1] = {
      component: "Metric",
      props: { label: "", binding: "{{result:S1.R2}}", unit: "minutes" },
    };
    const pendingInvalidTurn1 = exec(pendingInvalidCompiler, "compose_writer_report", {
      presentationPlan: mayaWriterPresentationPlan("CUSTOMER"),
      title: badScenarioDraft.title,
      summary: badScenarioDraft.summary,
      sections: badScenarioDraft.sections,
      scenarios: badScenarioDraft.scenarios,
      view: badScenarioDraft.view,
    });
    expect(pendingInvalidTurn1.ok).toBe(false);
    expect(pendingInvalidTurn1.pendingViewComponents).toEqual([
      { index: 1, component: "Metric", waitingOn: { kind: "scenario", id: "S1" } },
      { index: 5, component: "ScenarioExplorer", waitingOn: { kind: "scenario", id: "S1" } },
    ]);
    // Repair S1 -> ScenarioExplorer at index 5 succeeds, while Metric at index 1 is revalidated and fails on its empty label!
    const pendingInvalidTurn2 = exec(pendingInvalidCompiler, "apply_writer_correction", {
      scenarios: [base.scenarios[0]!],
    });
    expect(pendingInvalidTurn2.ok).toBe(false);
    expect(pendingInvalidTurn2.pendingViewComponents).toEqual([]);
    expect(pendingInvalidTurn2.rejections).toEqual([
      expect.objectContaining({
        unit: "view",
        index: 1,
        error: "view_props_invalid",
        field: "view[1].label",
      }),
    ]);
  });

  it("rejects unknown claims or invalid components in presentationPlan", () => {
    const compiler = createLedger("CUSTOMER");
    expect(() =>
      compiler.recordPresentationPlan({
        summaryDetailLevel: "BALANCED",
        priorityFindings: [{ claimId: "P99.F0", priority: "HIGH" }],
        sections: [],
        components: [],
      }),
    ).toThrow(expect.objectContaining({ diagnosticReason: "writer_claim_unknown" }));
  });
});
