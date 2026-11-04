import { describe, expect, it } from "vitest";

import { resolveCanonicalFindings } from "../analysis/canonical-finding-resolver";
import { StudyAgentLedger } from "../analysis/study-agent";
import { studyClaimCatalog, verifyStudyInvestigation } from "../analysis/study-verification";
import { buildFailureDiagnostic } from "../errors/failure-diagnostic";
import {
  L001_INITIAL_IEP_DOC_ID,
  L001_INITIAL_IEP_FILE_NAMES,
  L001_INITIAL_IEP_PAGES,
  L001_INITIAL_IEP_PLAN_QUESTION_IDS,
  l001InitialIepStudyAgentTurns,
  MAYA_FILE_NAMES,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_REVISION_6_PAGES,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaRevision6StudyOutput,
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

    expect(() =>
      compiler.recordPresentationPlan({
        audienceObjective: "   ",
        summaryDetailLevel: "BALANCED",
        priorityFindings: [],
        sections: [],
        components: [],
      }),
    ).toThrow(
      expect.objectContaining({
        diagnosticReason: "writer_output_shape",
        diagnosticField: "presentationPlan.audienceObjective",
      }),
    );

    expect(() =>
      compiler.recordPresentationPlan({
        audienceObjective: "Prepare for the meeting.",
        summaryDetailLevel: "BALANCED",
        priorityFindings: [],
        sections: [
          {
            id: "s1",
            heading: "Reading progress",
            priority: "HIGH",
            goalIds: ["BAD_GOAL"],
            claimIds: ["P1.F0"],
          },
        ],
        components: [],
      }),
    ).toThrow(
      expect.objectContaining({
        diagnosticReason: "writer_output_shape",
        diagnosticField: "presentationPlan.sections[0].goalIds[0]",
      }),
    );

    expect(() =>
      compiler.recordPresentationPlan({
        audienceObjective: "Prepare for the meeting.",
        summaryDetailLevel: "BALANCED",
        priorityFindings: [],
        sections: [
          {
            id: "s1",
            heading: "Reading progress",
            priority: "HIGH",
            specialistQuestionIds: ["P1"],
            claimIds: ["P1.F0"],
          },
        ],
        components: [],
      }),
    ).toThrow(
      expect.objectContaining({
        diagnosticReason: "writer_output_shape",
        diagnosticField: "presentationPlan.sections[0].specialistQuestionIds[0]",
      }),
    );
  });

  it("validates meaningfully different Customer vs Pro and objective-specific presentation plans and A2UI compositions over the identical verified Study claims (V4-004G)", () => {
    const customerPlan = mayaWriterPresentationPlan("CUSTOMER");
    const proPlan = mayaWriterPresentationPlan("PRO");

    // 1. Customer vs Pro plans over the exact same Study claims differ in audienceObjective, detail level,
    //    priority findings, section headings/purpose/goal alignment, and A2UI component selection.
    expect(customerPlan.audienceObjective).not.toBe(proPlan.audienceObjective);
    expect(customerPlan.summaryDetailLevel).toBe("BALANCED");
    expect(proPlan.summaryDetailLevel).toBe("COMPREHENSIVE");
    expect(customerPlan.priorityFindings[0]?.claimId).toBe("P1.C0");
    expect(proPlan.priorityFindings[0]?.claimId).toBe("P2.C0");
    expect(customerPlan.sections.map((s) => s.heading)).not.toEqual(proPlan.sections.map((s) => s.heading));
    expect(customerPlan.components.map((c) => c.component)).toContain("ScenarioExplorer");
    expect(proPlan.components.map((c) => c.component)).toEqual(
      expect.arrayContaining(["Comparison", "RecordTable", "EvidencePanel", "IssueList"]),
    );

    // 2. Compile a full Pro audit deliverable that follows proPlan's structure over the exact same CLAIMS.
    const proCompiler = createLedger("PRO");
    const proState = proCompiler.compileUnits({
      presentationPlan: proPlan,
      title: "Special education evidentiary audit and service compliance review",
      summary: [
        {
          type: "DOCUMENTED",
          text: "The service log documents 360 of 480 required speech-language therapy minutes ({{calc:P2.C0}}%), while reading fluency rose from 62 to 74 words correct per minute ({{calc:P1.C0}} words gained).",
          claimRefs: ["P2.F0", "P2.F1", "P2.C0", "P1.F0", "P1.F2", "P1.C0"],
        },
      ],
      sections: [
        {
          id: "s1",
          heading: "Service delivery compliance and shortfall analysis",
          blocks: [
            {
              type: "DOCUMENTED",
              text: "Between September and November 2025, 360 of 480 required speech therapy minutes ({{calc:P2.C0}}%) were delivered.",
              claimRefs: ["P2.F0", "P2.F1", "P2.C0"],
            },
          ],
        },
        {
          id: "s2",
          heading: "Fluency trajectory, assessment criteria, and open determinations",
          blocks: [
            {
              type: "INTERPRETATION",
              text: "Applying the general-knowledge criterion of comparing the latest measurement (74 words correct per minute) with the 62-word baseline and 90-word target indicates positive trajectory ({{calc:P1.C0}} words gained).",
              claimRefs: ["P1.A0", "P1.F0", "P1.F1", "P1.F2", "P1.C0"],
            },
            {
              type: "QUESTION",
              text: "Whether progress from 62 to 74 words correct per minute is sufficient is reserved for the IEP team.",
              claimRefs: ["P1.D0", "P1.F0", "P1.F2"],
            },
          ],
        },
        {
          id: "s3",
          heading: "Evidentiary gaps and unassessed areas",
          blocks: [
            {
              type: "UNCERTAINTY",
              text: "Only one post-baseline fluency measurement was available, the remaining gap calculation was not confirmed, and the psychoeducational evaluation reported no reading comprehension score.",
              claimRefs: ["P1.U0", "P1.C1", "P3"],
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
            title: "Mandated vs documented performance",
            leftLabel: "Mandated / Baseline",
            rightLabel: "Documented / Current",
            items: [
              { label: "Speech therapy minutes", left: "480 minutes", right: "360 minutes", claimRefs: ["P2.F1", "P2.F0"] },
              { label: "Reading fluency (wcpm)", left: "62", right: "74", claimRefs: ["P1.F0", "P1.F2"] },
            ],
          },
        },
        {
          component: "RecordTable",
          props: {
            title: "Verified case measurement ledger",
            columns: ["Measure", "Value", "Target / Requirement"],
            rows: [
              { cells: ["Reading fluency", "74 words correct per minute", "90 words correct per minute"], claimRefs: ["P1.F2", "P1.F1"] },
              { cells: ["Speech therapy", "360 minutes", "480 minutes"], claimRefs: ["P2.F0", "P2.F1"] },
            ],
          },
        },
        {
          component: "EvidencePanel",
          props: {
            title: "Criterion and determination provenance",
            claimIds: ["P1.A0", "P1.D0", "P2.C0"],
          },
        },
        {
          component: "IssueList",
          props: {
            title: "Evidentiary gaps and limitations",
            issues: [
              { text: "No reading comprehension score was reported in the evaluation.", severity: "HIGH", claimRefs: ["P3"] },
              { text: "Only one progress measurement after the baseline was available.", severity: "MEDIUM", claimRefs: ["P1.U0"] },
            ],
          },
        },
        { component: "Narrative", props: { sectionId: "s1" } },
        { component: "Narrative", props: { sectionId: "s2" } },
        { component: "Narrative", props: { sectionId: "s3" } },
      ],
    });

    expect(proState.ok).toBe(true);
    expect(proCompiler.currentPresentationPlan).toEqual({
      schema: WRITER_PRESENTATION_PLAN_SCHEMA,
      ...proPlan,
    });
    const builtPro = buildReport(proState.report, { audience: "PRO", claims: CLAIMS, fileNames: FILE_NAMES });
    expect(builtPro.ok).toBe(true);

    // 3. Same audience (CUSTOMER), different customer objective:
    //    Objective A = Meeting preparation & service catch-up (uses Checklist, QuestionList, ScenarioExplorer)
    //    Objective B = Reading progress check (uses Metric, Comparison, KeyFindings)
    const customerMeetingPrepCompiler = createLedger("CUSTOMER");
    const meetingPrepState = customerMeetingPrepCompiler.compileUnits({
      presentationPlan: {
        audienceObjective: "Prepare an action checklist, catch-up options, and concrete questions to bring to the March 2026 IEP meeting.",
        summaryDetailLevel: "CONCISE",
        priorityFindings: [
          { claimId: "P2.C0", priority: "HIGH" },
          { claimId: "P3", priority: "HIGH" },
          { claimId: "P1.D0", priority: "HIGH" },
        ],
        sections: [
          {
            id: "s1",
            heading: "Questions and missed service minutes for the meeting",
            priority: "HIGH",
            goalIds: ["G2"],
            specialistQuestionIds: ["I2", "I3"],
            purpose: "Give the parent concrete questions and a make-up calculator for the 120-minute speech gap and missing comprehension score.",
            claimIds: ["P2.F0", "P2.F1", "P2.C0", "P1.U0", "P3", "P1.D0"],
          },
        ],
        components: [
          { component: "Narrative", sectionId: "summary", claimIds: ["P2.F0", "P2.F1", "P2.C0"], purpose: "Lead with what to raise at the meeting." },
          { component: "Checklist", claimIds: ["P2.F0", "P2.F1", "P1.F2"], purpose: "Give a practical pre-meeting preparation checklist." },
          { component: "QuestionList", claimIds: ["P1.D0", "P3"], purpose: "List specific questions to ask the IEP team." },
          { component: "ScenarioExplorer", scenarioId: "S1", claimIds: ["P2.F0", "P2.F1"], purpose: "Explore weekly make-up minutes." },
          { component: "Narrative", sectionId: "s1", claimIds: ["P1.U0", "P3"], purpose: "Explain the open uncertainties before the meeting." },
        ],
      },
      title: "Preparing for Maya's IEP meeting",
      summary: [
        {
          type: "DOCUMENTED",
          text: "Before the meeting, the records show 360 of 480 required speech minutes were delivered ({{calc:P2.C0}}%).",
          claimRefs: ["P2.F0", "P2.F1", "P2.C0"],
        },
      ],
      sections: [
        {
          id: "s1",
          heading: "Questions and missed service minutes for the meeting",
          blocks: [
            {
              type: "UNCERTAINTY",
              text: "Only one reading measurement after the baseline was available, and the evaluation did not report a reading comprehension score.",
              claimRefs: ["P1.U0", "P3"],
            },
          ],
        },
      ],
      scenarios: mayaWriterOutput("CUSTOMER").scenarios,
      view: [
        { component: "Narrative", props: { sectionId: "summary" } },
        {
          component: "Checklist",
          props: {
            title: "What to bring to the meeting",
            items: [
              { text: "Bring the speech service log showing 360 of 480 required minutes delivered.", claimRefs: ["P2.F0", "P2.F1"] },
              { text: "Bring the November 2025 progress report showing 74 words correct per minute.", claimRefs: ["P1.F2"] },
            ],
          },
        },
        {
          component: "QuestionList",
          props: {
            title: "Questions to ask the IEP team",
            questions: [
              { text: "How will the IEP team determine whether Maya's reading progress is sufficient?", claimRefs: ["P1.D0"] },
              { text: "Can the team provide or conduct a reading comprehension assessment?", claimRefs: ["P3"] },
            ],
          },
        },
        { component: "ScenarioExplorer", props: { scenarioId: "S1" } },
        { component: "Narrative", props: { sectionId: "s1" } },
      ],
    });

    expect(meetingPrepState.ok).toBe(true);
    expect(meetingPrepState.presentationPlan?.audienceObjective).toContain("March 2026 IEP meeting");
    expect(meetingPrepState.presentationPlan?.sections[0]?.goalIds).toEqual(["G2"]);
    expect(meetingPrepState.presentationPlan?.components.map((c) => c.component)).toEqual([
      "Narrative",
      "Checklist",
      "QuestionList",
      "ScenarioExplorer",
      "Narrative",
    ]);
    expect(proState.presentationPlan?.components.map((c) => c.component)).not.toEqual(
      meetingPrepState.presentationPlan?.components.map((c) => c.component),
    );
  });
});

function revision6Context(asOf = "2026-11-04") {
  const verified = verifyStudyInvestigation(mayaRevision6StudyOutput(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
  });
  if (!verified.ok) throw new Error(verified.message);
  const claims = studyClaimCatalog(verified.value);
  const canonicalFindings = resolveCanonicalFindings(verified.value, claims, { asOf });
  return { study: verified.value, claims, canonicalFindings };
}

function createRevision6Ledger(audience: ReportAudience = "CUSTOMER", asOf = "2026-11-04") {
  const { study, claims, canonicalFindings } = revision6Context(asOf);
  const ledger = new WriterAgentLedger({
    reportRunId: REPORT_RUN_ID,
    audience,
    claims,
    fileNames: FILE_NAMES,
    canonicalFindings,
    asOf,
  });
  return { ledger, study, claims, canonicalFindings };
}

describe("Writer editorial synthesis and Canonical Finding Resolution integration (V4-004H Gate 2)", () => {
  it("synthesizes P1/P2/P7 baseline and goal into one model-planned insight with all original references and rejects duplicate priorityFindings", () => {
    const { ledger, claims, canonicalFindings } = createRevision6Ledger("CUSTOMER");

    // 1. Attempting to list P1.F0 and P2.F0 (same canonical finding group CF2) as separate priorityFindings is rejected.
    const dupPlanRes = exec(ledger, "compose_writer_report", {
      presentationPlan: {
        audienceObjective: "Understand Maya's reading progress and prepare for the March 3, 2026 meeting.",
        summaryDetailLevel: "BALANCED",
        insights: [
          {
            id: "INS1",
            meaning: "Reading fluency rose from the 62 wcpm baseline to 74 wcpm (+12 wcpm) in Nov 2025 and held at 74 wcpm in Jan 2026.",
            claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0", "P2.F1"],
            questionIds: ["P1", "P2", "P5", "P7"],
            role: "CENTRAL",
            reuseReason: "Synthesized in narrative and compared in structured table/timeline.",
          },
        ],
        priorityFindings: [
          { claimId: "P1.F0", priority: "HIGH", insightId: "INS1" },
          { claimId: "P2.F0", priority: "HIGH", insightId: "INS1" }, // Duplicate of P1.F0 in group CF2!
        ],
        sections: [
          {
            id: "s1",
            heading: "Reading fluency progress and goal conflict",
            priority: "HIGH",
            insightIds: ["INS1"],
            purpose: "Synthesize baseline, progress probes, and the 2024 vs 2025 target conflict.",
            claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0", "P1.K0", "P1"],
          },
        ],
        components: [
          { component: "Narrative", sectionId: "summary", claimIds: ["P1.F0", "P1.F2", "P1.C0"] },
          { component: "Narrative", sectionId: "s1", claimIds: ["P1.K0", "P1.U0", "P6.U0", "P6"] },
        ],
      },
      title: "Maya's IEP review",
      summary: [
        {
          type: "DOCUMENTED",
          text: "Maya's reading fluency rose from a baseline of 62 words correct per minute to 74 words correct per minute ({{calc:P1.C0}} words gained).",
          claimRefs: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P1.C0"],
        },
      ],
      sections: [
        {
          id: "s1",
          heading: "Reading fluency progress and open questions",
          blocks: [
            {
              type: "DOCUMENTED",
              text: "Across the November 14, 2025 and January 15, 2026 progress reports, reading fluency was 74 words correct per minute after the 62 words correct per minute baseline, while the 2024 and 2025 plans state different goals of 60 and 90 words correct per minute.",
              claimRefs: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.F3", "P2.F1", "P1.K0", "P1"],
            },
            {
              type: "UNCERTAINTY",
              text: "Comprehension probe data after November 2025 was not available in the record, and the evaluation did not report a reading comprehension score before the March 3, 2026 meeting.",
              claimRefs: ["P1.U0", "P6.U0", "P6", "P6.F0", "P6.F1"],
            },
          ],
        },
      ],
      scenarios: [],
      view: [
        { component: "Narrative", props: { sectionId: "summary" } },
        { component: "Narrative", props: { sectionId: "s1" } },
      ],
    });

    expect(dupPlanRes.ok).toBe(false);
    expect(dupPlanRes.error).toBe("writer_duplicate_finding");
    expect(dupPlanRes.field).toBe("presentationPlan.priorityFindings[1].claimId");
    // Meanwhile, valid outline, s1, and view were preserved!
    expect(dupPlanRes.acceptedSectionIds).toEqual(["s1"]);
    expect(dupPlanRes.acceptedViewComponentCount).toBe(2);

    // 2. Repair only the presentationPlan in Turn 2 via apply_writer_correction -> succeeds!
    const repaired = exec(ledger, "apply_writer_correction", {
      presentationPlan: {
        audienceObjective: "Understand Maya's reading progress and prepare for the March 3, 2026 meeting.",
        summaryDetailLevel: "BALANCED",
        insights: [
          {
            id: "INS1",
            meaning: "Reading fluency rose from the 62 wcpm baseline to 74 wcpm (+12 wcpm) in Nov 2025 and held at 74 wcpm in Jan 2026.",
            claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0", "P2.F1"],
            questionIds: ["P1", "P2", "P5", "P7"],
            role: "CENTRAL",
            reuseReason: "Synthesized in narrative and compared in structured table/timeline.",
          },
        ],
        priorityFindings: [
          { claimId: "P1.F0", priority: "HIGH", insightId: "INS1" },
          { claimId: "P1.C0", priority: "HIGH", insightId: "INS1" },
        ],
        sections: [
          {
            id: "s1",
            heading: "Reading fluency progress and goal conflict",
            priority: "HIGH",
            insightIds: ["INS1"],
            purpose: "Synthesize baseline, progress probes, and the 2024 vs 2025 target conflict.",
            claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0", "P1.K0", "P1"],
          },
        ],
        components: [
          { component: "Narrative", sectionId: "summary", claimIds: ["P1.F0", "P1.F2", "P1.C0"] },
          { component: "Narrative", sectionId: "s1", claimIds: ["P1.K0", "P1.U0", "P6.U0", "P6"] },
        ],
      },
    });

    expect(repaired.ok).toBe(true);
    expect(ledger.finished).toBe(true);
    expect(ledger.currentPresentationPlan?.insights?.[0]?.claimIds).toEqual([
      "P1.F0",
      "P2.F0",
      "P7.F0",
      "P1.F2",
      "P5.F0",
      "P1.C0",
      "P2.F1",
    ]);
    expect(ledger.currentPresentationPlan?.insights?.[0]?.questionIds).toEqual(["P1", "P2", "P5", "P7"]);
    expect(buildReport(ledger.assemble(), { audience: "CUSTOMER", claims, fileNames: FILE_NAMES, canonicalFindings }).ok).toBe(true);
  });

  it("allows P1/P6 monitoring concerns to form one synthesized uncertainty issue citing all original claims, while rejecting omitted or distinct overlapping uncertainties", () => {
    const { ledger, claims } = createRevision6Ledger("PRO");

    // 1. Omit P6.U0 while citing only P1.U0 -> rejected with writer_uncertainty_hidden listing P6.U0!
    const missingP6U0 = exec(ledger, "compose_writer_report", {
      presentationPlan: {
        summaryDetailLevel: "CONCISE",
        priorityFindings: [{ claimId: "P1.K0", priority: "HIGH" }],
        sections: [{ id: "s1", heading: "Audit", priority: "HIGH", claimIds: ["P1", "P1.K0", "P1.U0", "P6"] }],
        components: [{ component: "Narrative", sectionId: "s1", claimIds: ["P1", "P1.K0", "P1.U0", "P6"] }],
      },
      title: "IEP Evidence Audit",
      summary: [
        {
          type: "DOCUMENTED",
          text: "The 2024 and 2025 plans state conflicting reading goals of 60 vs 90 words correct per minute.",
          claimRefs: ["P1.F3", "P2.F1", "P1.K0", "P1"],
        },
      ],
      sections: [
        {
          id: "s1",
          heading: "Monitoring gaps",
          blocks: [
            {
              type: "UNCERTAINTY",
              text: "Comprehension probe data after November 2025 was not available, and the evaluation reported no comprehension score.",
              claimRefs: ["P1.U0", "P6"], // P6.U0 omitted!
            },
          ],
        },
      ],
      scenarios: [],
      view: [{ component: "Narrative", props: { sectionId: "s1" } }],
    });

    expect(missingP6U0.ok).toBe(false);
    expect(missingP6U0.error).toBe("writer_uncertainty_hidden");
    expect(missingP6U0.unsurfacedClaims).toEqual(["P6.U0"]);

    // 2. Patch s1 to cite both P1.U0 and P6.U0 (and P6) in the single synthesized uncertainty block -> succeeds!
    const fixed = exec(ledger, "apply_writer_correction", {
      sections: [
        {
          id: "s1",
          heading: "Monitoring gaps",
          blocks: [
            {
              type: "UNCERTAINTY",
              text: "Comprehension probe data after November 2025 was not available, and the evaluation reported no comprehension score.",
              claimRefs: ["P1.U0", "P6.U0", "P6"],
            },
          ],
        },
      ],
    });
    expect(fixed.ok).toBe(true);
    expect(ledger.finished).toBe(true);

    // 3. Verify that a distinct uncertainty with overlapping wording (e.g. P4.U0 about fluency probes vs comprehension probes)
    //    is not deduplicated away and causes writer_uncertainty_hidden if omitted.
    const claimsWithDistinctUncertainty = [
      ...claims,
      {
        id: "P4.U0",
        kind: "UNCERTAINTY" as const,
        planQuestionId: "P4",
        text: "Oral reading fluency probe data after January 2026 was not available in the record.",
        refs: [],
        quotes: [],
      },
    ];
    const ledgerDistinct = new WriterAgentLedger({
      reportRunId: REPORT_RUN_ID,
      audience: "PRO",
      claims: claimsWithDistinctUncertainty,
      fileNames: FILE_NAMES,
    });
    const omittedDistinctRes = exec(ledgerDistinct, "compose_writer_report", {
      presentationPlan: {
        summaryDetailLevel: "CONCISE",
        priorityFindings: [{ claimId: "P1.K0", priority: "HIGH" }],
        sections: [{ id: "s1", heading: "Audit", priority: "HIGH", claimIds: ["P1", "P1.K0", "P1.U0", "P6.U0", "P6"] }],
        components: [{ component: "Narrative", sectionId: "s1", claimIds: ["P1", "P1.K0", "P1.U0", "P6.U0", "P6"] }],
      },
      title: "IEP Evidence Audit",
      summary: [
        {
          type: "DOCUMENTED",
          text: "The 2024 and 2025 plans state conflicting reading goals of 60 vs 90 words correct per minute.",
          claimRefs: ["P1.F3", "P2.F1", "P1.K0", "P1"],
        },
      ],
      sections: [
        {
          id: "s1",
          heading: "Monitoring gaps",
          blocks: [
            {
              type: "UNCERTAINTY",
              text: "Comprehension probe data after November 2025 was not available, and the evaluation reported no comprehension score.",
              claimRefs: ["P1.U0", "P6.U0", "P6"],
            },
          ],
        },
      ],
      scenarios: [],
      view: [{ component: "Narrative", props: { sectionId: "s1" } }],
    });
    expect(omittedDistinctRes.ok).toBe(false);
    expect(omittedDistinctRes.error).toBe("writer_uncertainty_hidden");
    expect(omittedDistinctRes.unsurfacedClaims).toEqual(["P4.U0"]);
  });

  it("keeps contradictory findings (P1.F3 vs P2.F1) and different-date findings (P1.F2 vs P5.F0) distinguishable and leaves compound P1.F1/P4.F0 claims intact", () => {
    const { ledger, canonicalFindings } = createRevision6Ledger("PRO");

    // 1. Compound claims P1.F1 and P4.F0 remain intact in canonicalFindings with REQUIRES_SEMANTIC_ATOMIZATION.
    const p1F1Group = canonicalFindings.groups.find((g) => g.originalClaimIds.includes("P1.F1"));
    const p4F0Group = canonicalFindings.groups.find((g) => g.originalClaimIds.includes("P4.F0"));
    expect(p1F1Group?.atomicity.status).toBe("REQUIRES_SEMANTIC_ATOMIZATION");
    expect(p4F0Group?.atomicity.status).toBe("REQUIRES_SEMANTIC_ATOMIZATION");

    // 2. Citing an unverified split sub-claim ID (P4.F0.a1) is rejected as writer_claim_unknown.
    expect(() =>
      ledger.recordPresentationPlan({
        summaryDetailLevel: "BALANCED",
        priorityFindings: [{ claimId: "P4.F0.a1", priority: "HIGH" }],
        sections: [],
        components: [],
      }),
    ).toThrow(expect.objectContaining({ diagnosticReason: "writer_claim_unknown" }));

    // 3. Merging conflicting facts P1.F3 (60 wcpm) and P2.F1 (90 wcpm) into one insight without P1.K0 is rejected with writer_conflict_collapsed.
    expect(() =>
      ledger.recordPresentationPlan({
        summaryDetailLevel: "COMPREHENSIVE",
        insights: [
          {
            id: "INS_CONFLICT_COLLAPSED",
            meaning: "Annual reading fluency goal.",
            claimIds: ["P1.F3", "P2.F1"], // Missing P1.K0!
            questionIds: ["P1", "P2"],
            role: "CENTRAL",
          },
        ],
        priorityFindings: [{ claimId: "P1.F3", priority: "HIGH" }],
        sections: [],
        components: [],
      }),
    ).toThrow(expect.objectContaining({ diagnosticReason: "writer_conflict_collapsed" }));

    // 4. Including P1.K0 alongside P1.F3 and P2.F1 in the conflict insight succeeds, and P1.F2 (Nov 2025) + P5.F0 (Jan 2026) stay distinct claims.
    const validPlan = ledger.recordPresentationPlan({
      summaryDetailLevel: "COMPREHENSIVE",
      insights: [
        {
          id: "INS_GOAL_CONFLICT",
          meaning: "The 2024 IEP sets a 60 wcpm goal whereas the March 2025 amendment sets a 90 wcpm goal.",
          claimIds: ["P1.F3", "P2.F1", "P1.K0"],
          questionIds: ["P1", "P2"],
          role: "CENTRAL",
        },
        {
          id: "INS_FLUENCY_PROBES",
          meaning: "Fluency measured 74 wcpm in both November 2025 and January 2026.",
          claimIds: ["P1.F2", "P5.F0"],
          questionIds: ["P1", "P5"],
          role: "CENTRAL",
        },
      ],
      priorityFindings: [
        { claimId: "P1.K0", priority: "HIGH", insightId: "INS_GOAL_CONFLICT" },
        { claimId: "P1.F2", priority: "HIGH", insightId: "INS_FLUENCY_PROBES" },
        { claimId: "P5.F0", priority: "MEDIUM", insightId: "INS_FLUENCY_PROBES" },
      ],
      sections: [],
      components: [],
    });
    expect(validPlan.insights).toHaveLength(2);
  });

  it("enforces temporal editorial safety on historical IEP period 2024-11-12 to 2025-11-11 as of 2026-11-04 and recovers within Writer budgets", () => {
    const { ledger, claims, canonicalFindings } = createRevision6Ledger("CUSTOMER", "2026-11-04");

    // 1. Calling the 2024-11-12 to 2025-11-11 IEP "the current IEP" or "currently in effect" is rejected.
    const overclaimCurrent = exec(ledger, "set_report_outline", {
      title: "Maya's IEP review",
      summary: [
        {
          type: "DOCUMENTED",
          text: "Under Maya's current IEP (2024-11-12 to 2025-11-11), which remains in effect, the baseline was 62 words correct per minute.",
          claimRefs: ["P1.F4", "P1.F0"],
        },
      ],
    });
    expect(overclaimCurrent).toMatchObject({
      ok: false,
      error: "writer_temporal_status_invalid",
      field: "summary[0]",
      hint: expect.stringContaining("HISTORICAL_AS_OF_REPORT_DATE"),
    });

    // 2. Claiming that the 2024-11-12 to 2025-11-11 IEP was replaced by a newer 2026 IEP is rejected.
    const overclaimReplaced = exec(ledger, "set_report_outline", {
      title: "Maya's IEP review",
      summary: [
        {
          type: "DOCUMENTED",
          text: "The 2024-11-12 to 2025-11-11 IEP was replaced by a newer IEP.",
          claimRefs: ["P1.F4"],
        },
      ],
    });
    expect(overclaimReplaced).toMatchObject({
      ok: false,
      error: "writer_temporal_status_invalid",
      field: "summary[0]",
    });

    // 3. Claiming that no replacement IEP exists after 2025-11-11 is rejected.
    const overclaimNoReplacement = exec(ledger, "set_report_outline", {
      title: "Maya's IEP review",
      summary: [
        {
          type: "DOCUMENTED",
          text: "The 2024-11-12 to 2025-11-11 IEP ended and no replacement IEP exists.",
          claimRefs: ["P1.F4"],
        },
      ],
    });
    expect(overclaimNoReplacement).toMatchObject({
      ok: false,
      error: "writer_temporal_status_invalid",
      field: "summary[0]",
    });

    // 4. Stating "The IEP effective period is 2024-11-12 to 2025-11-11." in present tense without historical framing is rejected.
    const presentTenseUnframed = exec(ledger, "set_report_outline", {
      title: "Maya's IEP review",
      summary: [
        {
          type: "DOCUMENTED",
          text: "The IEP effective period is 2024-11-12 to 2025-11-11.",
          claimRefs: ["P1.F4"],
        },
      ],
    });
    expect(presentTenseUnframed).toMatchObject({
      ok: false,
      error: "writer_temporal_status_invalid",
      field: "summary[0]",
    });

    // 5. Explicitly framing the 2024-11-12 to 2025-11-11 period as having ended before 2026-11-04 without inferring replacement or current status succeeds!
    const validHistorical = exec(ledger, "set_report_outline", {
      title: "Maya's IEP review as of 2026-11-04",
      summary: [
        {
          type: "DOCUMENTED",
          text: "The documented 2024 IEP effective period of 2024-11-12 to 2025-11-11 ended before the 2026-11-04 report date, and whether a newer annual plan is currently in effect is not established by that historical range alone.",
          claimRefs: ["P1.F4"],
        },
      ],
    });
    expect(validHistorical.ok).toBe(true);

    // Complete the report and verify buildReport also passes.
    expect(
      exec(ledger, "record_section", {
        id: "s1",
        heading: "Historical period and open questions",
        blocks: [
          {
            type: "DOCUMENTED",
            text: "The 2024 and 2025 plans state different reading goals of 60 vs 90 words correct per minute.",
            claimRefs: ["P1.F3", "P2.F1", "P1.K0", "P1"],
          },
          {
            type: "UNCERTAINTY",
            text: "Comprehension probe data after November 2025 was not available, and the evaluation reported no comprehension score.",
            claimRefs: ["P1.U0", "P6.U0", "P6"],
          },
        ],
      }).ok,
    ).toBe(true);
    expect(exec(ledger, "record_view_component", { component: "Narrative", props: { sectionId: "summary" } }).ok).toBe(true);
    expect(exec(ledger, "record_view_component", { component: "Narrative", props: { sectionId: "s1" } }).ok).toBe(true);
    expect(exec(ledger, "finish_report", {}).ok).toBe(true);
    expect(buildReport(ledger.assemble(), { audience: "CUSTOMER", claims, fileNames: FILE_NAMES, canonicalFindings }).ok).toBe(true);
  });

  it("rejects redundant duplicate A2UI components while supporting legitimate dual-use across narrative and structured components", () => {
    const { ledger } = createRevision6Ledger("PRO");

    // 1. Two RecordTable components over the exact same resolved claims without a distinct purpose/reuseReason is rejected.
    expect(() =>
      ledger.recordPresentationPlan({
        summaryDetailLevel: "COMPREHENSIVE",
        priorityFindings: [{ claimId: "P1.F0", priority: "HIGH" }],
        sections: [{ id: "s1", heading: "Audit", priority: "HIGH", claimIds: ["P1.F0", "P1.F2"] }],
        components: [
          { component: "RecordTable", claimIds: ["P1.F0", "P1.F2"], purpose: "Show fluency scores." },
          { component: "RecordTable", claimIds: ["P2.F0", "P1.F2"], purpose: "Show fluency scores." }, // P2.F0 maps to same CF group as P1.F0!
        ],
      }),
    ).toThrow(expect.objectContaining({ diagnosticReason: "writer_duplicate_component" }));

    // 2. Duplicate Narrative sectionId is rejected.
    expect(() =>
      ledger.recordPresentationPlan({
        summaryDetailLevel: "COMPREHENSIVE",
        priorityFindings: [{ claimId: "P1.F0", priority: "HIGH" }],
        sections: [{ id: "s1", heading: "Audit", priority: "HIGH", claimIds: ["P1.F0", "P1.F2"] }],
        components: [
          { component: "Narrative", sectionId: "s1", claimIds: ["P1.F0"] },
          { component: "Narrative", sectionId: "s1", claimIds: ["P1.F2"] },
        ],
      }),
    ).toThrow(expect.objectContaining({ diagnosticReason: "writer_duplicate_component" }));

    // 3. Legitimate dual-use of the same claims across Narrative, Comparison, RecordTable, and EvidencePanel succeeds.
    const dualUsePlan = ledger.recordPresentationPlan({
      summaryDetailLevel: "COMPREHENSIVE",
      insights: [
        {
          id: "INS1",
          meaning: "Baseline 62 wcpm and Nov 2025 / Jan 2026 progress at 74 wcpm (+12 wcpm).",
          claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0"],
          questionIds: ["P1", "P2", "P5", "P7"],
          role: "CENTRAL",
          reuseReason: "Explained in narrative synthesis and audited across Comparison and RecordTable.",
        },
      ],
      priorityFindings: [{ claimId: "P1.C0", priority: "HIGH", insightId: "INS1" }],
      sections: [
        {
          id: "s1",
          heading: "Fluency trajectory analysis",
          priority: "HIGH",
          insightIds: ["INS1"],
          purpose: "Interpret fluency gain and stagnation between Nov 2025 and Jan 2026.",
          claimIds: ["P1.F0", "P1.F2", "P5.F0", "P1.C0"],
        },
      ],
      components: [
        {
          component: "Narrative",
          sectionId: "s1",
          insightIds: ["INS1"],
          claimIds: ["P1.F0", "P1.F2", "P5.F0", "P1.C0"],
          purpose: "Provide analytical narrative synthesis.",
        },
        {
          component: "Comparison",
          insightIds: ["INS1"],
          claimIds: ["P1.F0", "P1.F2"],
          purpose: "Compare baseline vs November 2025 probe side by side.",
          reuseReason: "Visual side-by-side comparison complements narrative synthesis.",
        },
        {
          component: "RecordTable",
          insightIds: ["INS1"],
          claimIds: ["P1.F0", "P1.F2", "P5.F0"],
          purpose: "Provide dated measurement ledger across all probes.",
          reuseReason: "Tabular audit ledger across three dated documents.",
        },
      ],
    });
    expect(dualUsePlan.components).toHaveLength(3);
  });

  it("produces substantially different Customer and Pro reports from the identical revision-6 Study claims and canonicalFindings", () => {
    const customer = createRevision6Ledger("CUSTOMER", "2026-11-04");
    const pro = createRevision6Ledger("PRO", "2026-11-04");

    const customerRes = exec(customer.ledger, "compose_writer_report", {
      presentationPlan: {
        audienceObjective: "Help Maya's parent understand her reading progress, speech therapy shortfall, and questions to ask at the March 3, 2026 IEP meeting.",
        summaryDetailLevel: "BALANCED",
        insights: [
          {
            id: "INS_PROGRESS",
            meaning: "Maya's reading fluency improved from 62 to 74 wcpm (+12 wcpm) by Nov 2025 and stayed at 74 wcpm in Jan 2026, while the 2024 (ended 2025-11-11) and 2025 plans list different targets (60 vs 90 wcpm).",
            claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0", "P1.F3", "P2.F1", "P1.K0", "P1.F4", "P1.A0", "P1.D0", "P1"],
            questionIds: ["P1", "P2", "P5", "P7"],
            role: "CENTRAL",
            reuseReason: "Summarized in plain prose and highlighted in Metric and Timeline.",
          },
          {
            id: "INS_SPEECH",
            meaning: "360 of 480 required speech therapy minutes (75%) were delivered between September and November 2025.",
            claimIds: ["P3.F0", "P3.F1", "P3.C0"],
            questionIds: ["P3"],
            role: "CENTRAL",
          },
          {
            id: "INS_GAPS",
            meaning: "No reading comprehension score or post-November comprehension probes are in the record before the March 3, 2026 meeting.",
            claimIds: ["P1.U0", "P6.U0", "P6", "P6.F0", "P6.F1"],
            questionIds: ["P1", "P6"],
            role: "CENTRAL",
          },
        ],
        priorityFindings: [
          { claimId: "P1.C0", priority: "HIGH", insightId: "INS_PROGRESS" },
          { claimId: "P3.C0", priority: "HIGH", insightId: "INS_SPEECH" },
          { claimId: "P6", priority: "HIGH", insightId: "INS_GAPS" },
        ],
        sections: [
          {
            id: "s1",
            heading: "How Maya is progressing in reading",
            priority: "HIGH",
            goalIds: ["G1", "G3"],
            specialistQuestionIds: ["I1"],
            insightIds: ["INS_PROGRESS"],
            purpose: "Explain reading fluency gains, the historical 2024-2025 plan period, and the 60 vs 90 wcpm goal conflict in plain words.",
            claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0", "P1.F3", "P2.F1", "P1.K0", "P1.F4", "P1.A0", "P1"],
          },
          {
            id: "s2",
            heading: "Speech therapy minutes and missing comprehension data for the March 3, 2026 meeting",
            priority: "HIGH",
            goalIds: ["G1", "G2"],
            specialistQuestionIds: ["I2", "I3"],
            insightIds: ["INS_SPEECH", "INS_GAPS"],
            purpose: "Show the 360/480 speech minute delivery and what to ask the IEP team about missing comprehension data.",
            claimIds: ["P3.F0", "P3.F1", "P3.C0", "P1.U0", "P6.U0", "P6", "P6.F0", "P6.F1", "P1.D0"],
          },
        ],
        components: [
          { component: "Narrative", sectionId: "summary", claimIds: ["P1.F0", "P1.F2", "P1.C0"], purpose: "Lead with plain-language summary." },
          { component: "Metric", claimIds: ["P1.C0"], insightIds: ["INS_PROGRESS"], purpose: "Show the +12 wcpm reading gain at a glance.", reuseReason: "Highlights key calculation from summary." },
          { component: "Narrative", sectionId: "s1", claimIds: ["P1.F4", "P1.K0", "P1.A0"], purpose: "Walk through reading progress and plan dates." },
          { component: "Timeline", claimIds: ["P1.F4", "P1.F2", "P5.F0", "P6.F1"], insightIds: ["INS_PROGRESS", "INS_GAPS"], purpose: "Order key dates through the March 3, 2026 meeting." },
          { component: "Narrative", sectionId: "s2", claimIds: ["P3.F0", "P3.F1", "P3.C0", "P1.U0", "P6.U0", "P6"], purpose: "Explain speech minutes and missing comprehension scores." },
          { component: "QuestionList", claimIds: ["P1.D0", "P1.K0", "P6"], insightIds: ["INS_PROGRESS", "INS_GAPS"], purpose: "Give concrete questions to bring to the March 3, 2026 IEP meeting." },
        ],
      },
      title: "Maya's IEP progress and meeting guide",
      summary: [
        {
          type: "DOCUMENTED",
          text: "Maya's reading fluency rose from a baseline of 62 words correct per minute to 74 words correct per minute ({{calc:P1.C0}} words gained), and 360 of 480 required speech therapy minutes ({{calc:P3.C0}}) were delivered.",
          claimRefs: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P1.C0", "P3.F0", "P3.F1", "P3.C0"],
        },
      ],
      sections: [
        {
          id: "s1",
          heading: "How Maya is progressing in reading",
          blocks: [
            {
              type: "DOCUMENTED",
              text: "The documented 2024 IEP effective period of 2024-11-12 to 2025-11-11 ended before the 2026-11-04 report date; the 2024 and 2025 plans state different reading goals of 60 vs 90 words correct per minute.",
              claimRefs: ["P1.F4", "P1.F3", "P2.F1", "P1.K0", "P1"],
            },
            {
              type: "INTERPRETATION",
              text: "Based on the general-knowledge criterion of comparing interim progress probes against the 62 words correct per minute baseline, Maya's 74 words correct per minute in November 2025 and January 2026 shows improvement above baseline.",
              claimRefs: ["P1.A0", "P1.F0", "P1.F2", "P5.F0"],
            },
          ],
        },
        {
          id: "s2",
          heading: "Speech therapy minutes and missing comprehension data for the March 3, 2026 meeting",
          blocks: [
            {
              type: "DOCUMENTED",
              text: "Between September and November 2025, 360 of 480 required speech therapy minutes ({{calc:P3.C0}}) were delivered before the annual review scheduled for March 3, 2026.",
              claimRefs: ["P3.F0", "P3.F1", "P3.C0", "P6.F1"],
            },
            {
              type: "UNCERTAINTY",
              text: "Comprehension probe data after November 2025 was not available in the record, and the psychoeducational evaluation did not report a reading comprehension score.",
              claimRefs: ["P1.U0", "P6.U0", "P6", "P6.F0"],
            },
          ],
        },
      ],
      scenarios: [],
      view: [
        { component: "Narrative", props: { sectionId: "summary" } },
        { component: "Metric", props: { label: "Reading fluency gain", binding: "{{calc:P1.C0}}", unit: "words per minute" } },
        { component: "Narrative", props: { sectionId: "s1" } },
        {
          component: "Timeline",
          props: {
            title: "Documented dates in Maya's record",
            events: [
              { date: "2024-11-12 to 2025-11-11", text: "Documented 2024 IEP effective period (ended before the 2026-11-04 report date)", claimRefs: ["P1.F4"] },
              { date: "November 14, 2025", text: "Reading fluency measured at 74 words correct per minute", claimRefs: ["P1.F2"] },
              { date: "January 15, 2026", text: "Reading fluency remained 74 words correct per minute", claimRefs: ["P5.F0"] },
              { date: "March 3, 2026", text: "Scheduled annual review meeting", claimRefs: ["P6.F1"] },
            ],
          },
        },
        { component: "Narrative", props: { sectionId: "s2" } },
        {
          component: "QuestionList",
          props: {
            title: "Questions to bring to the March 3, 2026 meeting",
            questions: [
              { text: "How will the IEP team determine whether Maya's reading fluency progress from 62 to 74 words correct per minute is sufficient?", claimRefs: ["P1.D0", "P1.F0", "P1.F2"] },
              { text: "Does the 90 words correct per minute target in the 2025 amendment supersede the 60 words correct per minute goal in the 2024 plan?", claimRefs: ["P1.K0", "P1.F3", "P2.F1"] },
              { text: "When will a reading comprehension score and updated comprehension probes be collected?", claimRefs: ["P6", "P1.U0", "P6.U0"] },
            ],
          },
        },
      ],
    });

    const proRes = exec(pro.ledger, "compose_writer_report", {
      presentationPlan: {
        audienceObjective: "Deliver an evidentiary audit of plan period currentness, target conflicts, fluency probe trajectory, speech service compliance, and reserved FAPE determinations.",
        summaryDetailLevel: "COMPREHENSIVE",
        insights: [
          {
            id: "INS_AUDIT_CONFLICT_TEMPORAL",
            meaning: "The 2024 IEP period (2024-11-12 to 2025-11-11) ended before 2026-11-04 and conflicts with the 2025 amendment on the annual reading target (60 vs 90 wcpm).",
            claimIds: ["P1.F4", "P1.F3", "P2.F1", "P1.K0", "P1"],
            questionIds: ["P1", "P2"],
            role: "CENTRAL",
            reuseReason: "Audited in Comparison and narrative compliance section.",
          },
          {
            id: "INS_AUDIT_METRICS",
            meaning: "Fluency rose +12 wcpm over the 62 wcpm baseline to 74 wcpm on 2025-11-14 and plateaued at 74 wcpm on 2026-01-15; speech delivery reached 360/480 minutes (75%).",
            claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0", "P3.F0", "P3.F1", "P3.C0", "P1.A0", "P1.D0"],
            questionIds: ["P1", "P2", "P3", "P5", "P7"],
            role: "CENTRAL",
            reuseReason: "Tabulated in RecordTable and backed by verbatim quotes in EvidencePanel.",
          },
          {
            id: "INS_AUDIT_GAPS",
            meaning: "Missing psychoeducational comprehension score and post-November comprehension probes limit FAPE evaluation prior to the 2026-03-03 review.",
            claimIds: ["P1.U0", "P6.U0", "P6", "P6.F0", "P6.F1", "P6.L0"],
            questionIds: ["P1", "P6"],
            role: "CENTRAL",
          },
        ],
        priorityFindings: [
          { claimId: "P1.K0", priority: "HIGH", insightId: "INS_AUDIT_CONFLICT_TEMPORAL" },
          { claimId: "P1.F4", priority: "HIGH", insightId: "INS_AUDIT_CONFLICT_TEMPORAL" },
          { claimId: "P3.C0", priority: "HIGH", insightId: "INS_AUDIT_METRICS" },
          { claimId: "P1.D0", priority: "HIGH", insightId: "INS_AUDIT_METRICS" },
        ],
        sections: [
          {
            id: "s1",
            heading: "Plan period status, target discrepancy, and FAPE determination posture",
            priority: "HIGH",
            goalIds: ["G1", "G3"],
            specialistQuestionIds: ["I1", "I2"],
            insightIds: ["INS_AUDIT_CONFLICT_TEMPORAL", "INS_AUDIT_METRICS"],
            purpose: "Audit historical plan period expiration, 60 vs 90 wcpm target discrepancy, probe plateau, 75% speech delivery, and open IEP team determinations.",
            claimIds: ["P1.F4", "P1.F3", "P2.F1", "P1.K0", "P1.F0", "P1.F2", "P5.F0", "P1.C0", "P1.A0", "P1.D0", "P3.F0", "P3.F1", "P3.C0", "P1"],
          },
        ],
        components: [
          { component: "Narrative", sectionId: "summary", claimIds: ["P1.F4", "P1.K0", "P3.C0"], purpose: "Executive evidentiary synthesis." },
          { component: "Comparison", claimIds: ["P1.F3", "P2.F1", "P1.K0", "P3.F0", "P3.F1"], insightIds: ["INS_AUDIT_CONFLICT_TEMPORAL", "INS_AUDIT_METRICS"], purpose: "Contrast conflicting 2024 vs 2025 targets and delivered vs mandated minutes." },
          { component: "RecordTable", claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P3.F0", "P3.F1"], insightIds: ["INS_AUDIT_METRICS"], purpose: "Audit source-by-source measurements across all probes and logs." },
          { component: "EvidencePanel", claimIds: ["P1.F4", "P1.K0", "P1.A0", "P1.D0", "P3.C0"], insightIds: ["INS_AUDIT_CONFLICT_TEMPORAL", "INS_AUDIT_METRICS"], purpose: "Inspect verbatim quotes, general-knowledge criterion, and reserved IEP team determination." },
          { component: "IssueList", claimIds: ["P1.U0", "P6.U0", "P6", "P1.K0", "P1"], insightIds: ["INS_AUDIT_CONFLICT_TEMPORAL", "INS_AUDIT_GAPS"], purpose: "Track evidentiary gaps and target conflicts by severity." },
          { component: "Narrative", sectionId: "s1", claimIds: ["P1.A0", "P1.D0"], purpose: "Detail criterion evaluation and reserved determination." },
        ],
      },
      title: "Special education evidentiary audit and compliance matrix",
      summary: [
        {
          type: "DOCUMENTED",
          text: "The documented 2024 IEP period (2024-11-12 to 2025-11-11) ended before the 2026-11-04 report date without establishing whether a newer annual plan is currently in effect; the 2024 plan and 2025 amendment state conflicting reading goals of 60 vs 90 words correct per minute, while speech delivery reached 360 of 480 minutes ({{calc:P3.C0}}).",
          claimRefs: ["P1.F4", "P1.F3", "P2.F1", "P1.K0", "P3.F0", "P3.F1", "P3.C0", "P1"],
        },
      ],
      sections: [
        {
          id: "s1",
          heading: "Plan period status, target discrepancy, and FAPE determination posture",
          blocks: [
            {
              type: "INTERPRETATION",
              text: "Applying the general-knowledge criterion of comparing interim progress probes against the 62 words correct per minute baseline shows a {{calc:P1.C0}} words correct per minute gain to 74 words correct per minute on November 14, 2025 and January 15, 2026, while whether fluency progress is sufficient for FAPE is reserved for the IEP team.",
              claimRefs: ["P1.A0", "P1.D0", "P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0"],
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
            title: "Plan target conflict and service delivery compliance",
            leftLabel: "2024 IEP / Mandated",
            rightLabel: "2025 Amendment / Delivered",
            items: [
              { label: "Annual reading fluency goal", left: "60 words correct per minute", right: "90 words correct per minute", claimRefs: ["P1.F3", "P2.F1", "P1.K0"] },
              { label: "Speech therapy minutes", left: "480 minutes", right: "360 minutes", claimRefs: ["P3.F1", "P3.F0"] },
            ],
          },
        },
        {
          component: "RecordTable",
          props: {
            title: "Chronological measurement ledger",
            columns: ["Record", "Measurement", "Status / Notes"],
            rows: [
              { cells: ["Baseline (P1/P2/P7)", "62 words correct per minute", "Documented baseline"], claimRefs: ["P1.F0", "P2.F0", "P7.F0"] },
              { cells: ["November 14, 2025 probe", "74 words correct per minute", "Interim probe"], claimRefs: ["P1.F2"] },
              { cells: ["January 15, 2026 probe", "74 words correct per minute", "Subsequent probe"], claimRefs: ["P5.F0"] },
            ],
          },
        },
        {
          component: "EvidencePanel",
          props: {
            title: "Verbatim evidence, criteria, and determinations",
            claimIds: ["P1.F4", "P1.K0", "P1.A0", "P1.D0", "P3.C0"],
          },
        },
        {
          component: "IssueList",
          props: {
            title: "Evidentiary gaps and conflicts",
            issues: [
              { text: "Comprehension probe data after November 2025 was not available, and the evaluation did not report a reading comprehension score.", severity: "HIGH", claimRefs: ["P1.U0", "P6.U0", "P6"] },
              { text: "The 2024 plan sets a reading goal of 60 words correct per minute while the 2025 plan sets 90 words correct per minute.", severity: "HIGH", claimRefs: ["P1.K0", "P1"] },
            ],
          },
        },
        { component: "Narrative", props: { sectionId: "s1" } },
      ],
    });

    expect(customerRes.ok).toBe(true);
    expect(proRes.ok).toBe(true);
    expect(customer.ledger.currentPresentationPlan?.summaryDetailLevel).toBe("BALANCED");
    expect(pro.ledger.currentPresentationPlan?.summaryDetailLevel).toBe("COMPREHENSIVE");
    expect(customer.ledger.currentPresentationPlan?.components.map((c) => c.component)).toEqual([
      "Narrative",
      "Metric",
      "Narrative",
      "Timeline",
      "Narrative",
      "QuestionList",
    ]);
    expect(pro.ledger.currentPresentationPlan?.components.map((c) => c.component)).toEqual([
      "Narrative",
      "Comparison",
      "RecordTable",
      "EvidencePanel",
      "IssueList",
      "Narrative",
    ]);
  });

  it("supports two-phase staged PRO composition (Turn 1: presentationPlan + outline + sections; Turn 2: scenarios + view) and segmented set_report_outline with presentationPlan (V4-004J)", () => {
    const pro = createLedger("PRO");
    const base = mayaWriterOutput("PRO");
    const plan = mayaWriterPresentationPlan("PRO");

    // Turn 1: compose_writer_report with ONLY presentationPlan, title, summary, and sections (omitting scenarios & view)
    const stage1 = exec(pro, "compose_writer_report", {
      presentationPlan: plan,
      title: base.title,
      summary: base.summary,
      sections: base.sections,
    });
    expect(stage1).toMatchObject({
      ok: true,
      finished: false,
      awaitingView: true,
      acceptedSectionIds: ["s1", "s2", "s3"],
      viewComponentCount: 0,
    });
    expect(pro.finished).toBe(false);
    expect(pro.currentPresentationPlan).toEqual({
      schema: WRITER_PRESENTATION_PLAN_SCHEMA,
      ...plan,
    });

    // Turn 2: apply_writer_correction with scenarios and view completes and finalizes the report
    const stage2 = exec(pro, "apply_writer_correction", {
      scenarios: base.scenarios,
      view: base.view,
    });
    expect(stage2).toMatchObject({
      ok: true,
      finished: true,
      sectionCount: 3,
      scenarioCount: 1,
      viewComponentCount: base.view.length,
    });
    expect(pro.finished).toBe(true);
    expect(pro.assemble()).toEqual(base);

    // Also verify staged Turn 1 with a rejected section preserves accepted sections and awaitingView: true,
    // and Turn 2 repairs the section + supplies view in one apply_writer_correction call.
    const proWithError = createLedger("PRO");
    const badSections = structuredClone(base.sections);
    badSections[1]!.blocks[0]!.text = "Delivered 999 of 480 speech minutes.";
    const stage1WithRejection = exec(proWithError, "compose_writer_report", {
      presentationPlan: plan,
      title: base.title,
      summary: base.summary,
      sections: badSections,
    });
    expect(stage1WithRejection).toMatchObject({
      ok: false,
      awaitingView: true,
      error: "writer_number_ungrounded",
      acceptedSectionIds: ["s1", "s3"],
    });
    expect(proWithError.finished).toBe(false);

    const stage2RepairAndView = exec(proWithError, "apply_writer_correction", {
      sections: [base.sections[1]!],
      scenarios: base.scenarios,
      view: base.view,
    });
    expect(stage2RepairAndView).toMatchObject({
      ok: true,
      finished: true,
    });
    expect(proWithError.assemble()).toEqual(base);

    // Also verify segmented set_report_outline accepts presentationPlan
    const segmentedLedger = createLedger("PRO");
    expect(
      exec(segmentedLedger, "set_report_outline", {
        presentationPlan: plan,
        title: base.title,
        summary: base.summary,
      }).ok,
    ).toBe(true);
    expect(segmentedLedger.currentPresentationPlan).toEqual({
      schema: WRITER_PRESENTATION_PLAN_SCHEMA,
      ...plan,
    });
  });

  it("validates thematic DF insight subsets, unlinked DF findings, direct question requirements, unknown questions/claims, and 7-section staged PRO recovery with history compaction (V4-004J.1)", () => {
    const l001Corpus = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const studyLedger = new StudyAgentLedger({
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS,
      pages: l001Corpus,
    });
    for (const turn of l001InitialIepStudyAgentTurns()) {
      for (const call of turn) {
        const res = studyLedger.execute(call);
        if (!res.ok) throw new Error(`L001 ledger call failed: ${res.content}`);
      }
    }
    const verifiedL001 = verifyStudyInvestigation(studyLedger.assemble(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: [...L001_INITIAL_IEP_PLAN_QUESTION_IDS],
      pages: new Map(Object.entries(L001_INITIAL_IEP_PAGES)),
    });
    if (!verifiedL001.ok) throw new Error(verifiedL001.message);
    const baseClaims = studyClaimCatalog(verifiedL001.value);
    // Add an unlinked DF38 finding (questionIds: []) to test unlinked DF handling
    const df1Ref = baseClaims.find((c) => c.id === "DF1")!;
    const claimsWithUnlinked = [
      ...baseClaims,
      {
        ...df1Ref,
        id: "DF38",
        planQuestionId: null,
        questionIds: [],
        text: "Procedural safeguards notice provided on 2024-11-12.",
      },
    ];
    const canonicalFindings = resolveCanonicalFindings(verifiedL001.value, claimsWithUnlinked, {
      asOf: "2026-11-04",
    });
    const l001FileNames = new Map(Object.entries(L001_INITIAL_IEP_FILE_NAMES));

    const ledger = new WriterAgentLedger({
      reportRunId: REPORT_RUN_ID,
      audience: "PRO",
      claims: claimsWithUnlinked,
      fileNames: l001FileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });

    // 1. Reusable DF claims (DF17 spans P2, P3, P4, P6; DF19/DF20 span P2, P4, P6; DF8 spans P1, P5, P6)
    //    permit thematic subsets (e.g. ["P2", "P4"] or ["P3"]) and unlinked DF38 permits valid plan questions (["P5"]),
    //    without mutating canonical claim.questionIds.
    const df17Before = [...(claimsWithUnlinked.find((c) => c.id === "DF17")?.questionIds ?? [])];
    const validPlan = ledger.recordPresentationPlan({
      audienceObjective: "Audit L001 IEP provisions, baselines, services, and monitoring gaps.",
      summaryDetailLevel: "COMPREHENSIVE",
      insights: [
        {
          id: "INS1",
          meaning: "Goal baseline is 42 WCPM (86% accuracy) and target is 75 WCPM (95% accuracy) with +33 WCPM gain.",
          claimIds: ["DF8", "DF13", "DF14", "DF17", "DF19", "DF20", "DF21", "P2.C0", "P2.C1"],
          questionIds: ["P2", "P4"], // Thematic subset (omits P1, P3, P5, P6 from DF8/DF17 fan-out while keeping P2 from P2.C0/P2.C1)
          role: "CENTRAL",
        },
        {
          id: "INS2",
          meaning: "Specialized reading instruction is 150 minutes weekly with classroom assessment accommodations.",
          claimIds: ["DF17", "DF26", "DF27", "DF28", "DF30", "DF31"],
          questionIds: ["P3"], // Thematic subset for services & accommodations (DF17 also touches P2, P4, P6; DF27 touches P3, P6)
          role: "CENTRAL",
        },
        {
          id: "INS3",
          meaning: "IEP team participation and procedural notice.",
          claimIds: ["DF38"], // Unlinked DF claim (questionIds: [])
          questionIds: ["P5"],
          role: "SUPPORTING",
        },
      ],
      priorityFindings: [
        { claimId: "DF19", priority: "HIGH", insightId: "INS1" },
        { claimId: "DF27", priority: "HIGH", insightId: "INS2" },
      ],
      sections: [
        { id: "s1", heading: "Goal Audit", priority: "HIGH", insightIds: ["INS1"], claimIds: ["DF19", "DF20", "P2.C0"] },
      ],
      components: [
        { component: "Narrative", sectionId: "s1", claimIds: ["DF19", "DF20", "P2.C0"] },
      ],
    });
    expect(validPlan.insights?.map((i) => i.questionIds)).toEqual([["P2", "P4"], ["P3"], ["P5"]]);
    expect(claimsWithUnlinked.find((c) => c.id === "DF17")?.questionIds).toEqual(df17Before);

    // 2. Rejects missing direct question for question-scoped claim (P2.C0 requires P2 in questionIds)
    expect(() =>
      ledger.recordPresentationPlan({
        summaryDetailLevel: "COMPREHENSIVE",
        insights: [
          {
            id: "INS_MISSING_DIRECT",
            meaning: "Fluency calculation.",
            claimIds: ["DF19", "DF20", "P2.C0"],
            questionIds: ["P4"], // Missing P2 required by P2.C0!
            role: "CENTRAL",
          },
        ],
        priorityFindings: [{ claimId: "DF19", priority: "HIGH" }],
        sections: [],
        components: [],
      }),
    ).toThrow(
      expect.objectContaining({
        diagnosticReason: "writer_insight_mapping_invalid",
        diagnosticField: "presentationPlan.insights[0].questionIds",
      }),
    );

    // 3. Rejects unsupported question ID ("P1") when DF19 is only linked to ["P2", "P4", "P6"] and no unlinked DF is cited
    expect(() =>
      ledger.recordPresentationPlan({
        summaryDetailLevel: "COMPREHENSIVE",
        insights: [
          {
            id: "INS_UNSUPPORTED_Q",
            meaning: "Baseline 42 WCPM.",
            claimIds: ["DF19"],
            questionIds: ["P1"], // DF19 is linked to P2, P4, P6 — not P1!
            role: "CENTRAL",
          },
        ],
        priorityFindings: [{ claimId: "DF19", priority: "HIGH" }],
        sections: [],
        components: [],
      }),
    ).toThrow(
      expect.objectContaining({
        diagnosticReason: "writer_insight_mapping_invalid",
        diagnosticField: "presentationPlan.insights[0].questionIds",
      }),
    );

    // 4. Rejects unknown plan question ID ("P99" not in P1..P6) and unknown claim ID ("DF999")
    expect(() =>
      ledger.recordPresentationPlan({
        summaryDetailLevel: "COMPREHENSIVE",
        insights: [
          {
            id: "INS_UNKNOWN_Q",
            meaning: "Unlinked DF with nonexistent P99.",
            claimIds: ["DF38"],
            questionIds: ["P99"],
            role: "SUPPORTING",
          },
        ],
        priorityFindings: [{ claimId: "DF19", priority: "HIGH" }],
        sections: [],
        components: [],
      }),
    ).toThrow(
      expect.objectContaining({
        diagnosticReason: "writer_insight_mapping_invalid",
        diagnosticField: "presentationPlan.insights[0].questionIds[0]",
      }),
    );

    expect(() =>
      ledger.recordPresentationPlan({
        summaryDetailLevel: "COMPREHENSIVE",
        insights: [
          {
            id: "INS_UNKNOWN_CLAIM",
            meaning: "Unknown claim.",
            claimIds: ["DF999"],
            questionIds: ["P1"],
            role: "CENTRAL",
          },
        ],
        priorityFindings: [{ claimId: "DF19", priority: "HIGH" }],
        sections: [],
        components: [],
      }),
    ).toThrow(
      expect.objectContaining({
        diagnosticReason: "writer_claim_unknown",
        diagnosticField: "presentationPlan.insights[0].claimIds[0]",
      }),
    );

    // 5. Staged PRO flow: 7 accepted sections (s1..s7) + rejected presentationPlan.insights[1].questionIds in Turn 1
    //    returns awaitingView: true and explicit nextStep/hint guidance, compacts accepted sections in history,
    //    and completes in Turn 2 when presentationPlan + view are supplied without resending s1..s7.
    const stagedProLedger = new WriterAgentLedger({
      reportRunId: REPORT_RUN_ID,
      audience: "PRO",
      claims: baseClaims,
      fileNames: l001FileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });

    const sevenSections = [
      {
        id: "s1",
        heading: "Student Profile and Historical IEP Period",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "Maya Carter (born 2017-04-18, Grade 2, Synthetic Elementary School, Synthetic District) has an Initial IEP dated 2024-11-12 for 2024-11-12 through 2025-11-11, which ended before the 2026-11-04 report date.",
            claimRefs: ["DF1", "DF2", "DF3", "DF4", "DF5", "DF6", "DF7", "DF8"],
          },
        ],
      },
      {
        id: "s2",
        heading: "Eligibility Determination",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "On 2024-11-01, Maya Carter was found eligible under Specific Learning Disability (SLD) - Reading with Reading Fluency as her primary educational need.",
            claimRefs: ["DF9", "DF10", "DF11"],
          },
        ],
      },
      {
        id: "s3",
        heading: "Present Levels and Baseline Evaluation",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "The 2024-10-18 academic evaluation documents a reading fluency baseline of 42 WCPM and 86% oral reading accuracy.",
            claimRefs: ["DF12", "DF13", "DF14", "DF15", "DF16"],
          },
        ],
      },
      {
        id: "s4",
        heading: "Annual Goal Criteria and Quantitative Gain",
        blocks: [
          {
            type: "INTERPRETATION" as const,
            text: "GOAL_READING_FLUENCY requires a {{calc:P2.C0}} WCPM increase (from 42 WCPM to 75 WCPM) and a {{calc:P2.C1}} percentage-point accuracy increase (from 86% to 95%) across three consecutive probes from 2024-11-12 to 2025-11-11.",
            claimRefs: ["P2.A0", "DF17", "DF18", "DF19", "DF20", "DF21", "DF22", "DF23", "DF24", "DF25", "P2.C0", "P2.C1"],
          },
        ],
      },
      {
        id: "s5",
        heading: "Special Education Services and Accommodations",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "Specialized reading instruction is provided Weekly for 150 minutes in the special education setting starting 2024-11-12, with extended time and read-aloud directions.",
            claimRefs: ["DF26", "DF27", "DF28", "DF29", "DF30", "DF31"],
          },
        ],
      },
      {
        id: "s6",
        heading: "Progress Reporting and Team Participation",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "Progress is measured with oral-reading-fluency probes and reported quarterly; Parent/Guardian, General Education Teacher, Special Education Teacher, and District Representative participated on 2024-11-12.",
            claimRefs: ["DF32", "DF33", "DF34", "DF35", "DF36", "DF37"],
          },
        ],
      },
      {
        id: "s7",
        heading: "Evidentiary Gaps and Reserved Determinations",
        blocks: [
          {
            type: "UNCERTAINTY" as const,
            text: "The documented 2024-11-12 through 2025-11-11 IEP period ended before the 2026-11-04 report date without establishing current plan status; no post-2024-11-12 quarterly oral-reading-fluency probe results or 2024-10-18 evaluation reports are attached, and the IEP team decides whether the 75 WCPM and 95% accuracy goal was met.",
            claimRefs: ["DF7", "DF8", "DF12", "DF20", "DF21", "P6", "P6.U0", "P6.L0", "P6.D0"],
          },
        ],
      },
    ];

    const turn1Call = makeCall("compose_writer_report", {
      presentationPlan: {
        audienceObjective: "Deliver a 7-section professional IEP audit.",
        summaryDetailLevel: "COMPREHENSIVE",
        insights: [
          {
            id: "INS1",
            meaning: "Baseline 42 WCPM (86% accuracy) to target 75 WCPM (95% accuracy).",
            claimIds: ["DF13", "DF14", "DF19", "DF20", "DF21", "P2.C0", "P2.C1"],
            questionIds: ["P2", "P4"],
            role: "CENTRAL",
          },
          {
            id: "INS2",
            meaning: "150 minutes weekly reading instruction and accommodations.",
            claimIds: ["DF26", "DF27", "DF30", "DF31"],
            questionIds: ["P99"], // Invalid plan question triggers presentationPlan.insights[1].questionIds[0]
            role: "CENTRAL",
          },
        ],
        priorityFindings: [
          { claimId: "DF19", priority: "HIGH", insightId: "INS1" },
          { claimId: "DF27", priority: "HIGH", insightId: "INS2" },
        ],
        sections: sevenSections.map((s) => ({
          id: s.id,
          heading: s.heading,
          priority: "HIGH" as const,
          claimIds: s.blocks[0]!.claimRefs,
        })),
        components: sevenSections.map((s) => ({
          component: "Narrative" as const,
          sectionId: s.id,
          claimIds: s.blocks[0]!.claimRefs,
        })),
      },
      title: "Comprehensive Professional Audit: Maya Carter Initial IEP",
      summary: [
        {
          type: "DOCUMENTED",
          text: "Maya Carter (born 2017-04-18, Grade 2) has an Initial IEP for 2024-11-12 through 2025-11-11 (ended before the 2026-11-04 report date) targeting a {{calc:P2.C0}} WCPM fluency gain (42 WCPM to 75 WCPM) and {{calc:P2.C1}}% accuracy gain (86% to 95%) with 150 minutes weekly specialized reading instruction.",
          claimRefs: ["DF1", "DF2", "DF3", "DF8", "DF13", "DF14", "DF19", "DF20", "DF21", "DF27", "P2.C0", "P2.C1"],
        },
      ],
      sections: sevenSections,
    });

    const turn1ToolRes = stagedProLedger.execute(turn1Call);
    expect(turn1ToolRes.ok).toBe(false);
    const turn1Parsed = JSON.parse(turn1ToolRes.content) as Record<string, unknown>;
    expect(turn1Parsed).toMatchObject({
      ok: false,
      awaitingView: true,
      error: "writer_insight_mapping_invalid",
      field: "presentationPlan.insights[1].questionIds[0]",
      acceptedSectionIds: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"],
      acceptedViewComponentCount: 0,
      nextStep: expect.stringContaining("do NOT resend accepted sections"),
      hint: expect.stringContaining("PLUS your view components"),
    });

    // Verify historical compaction removes the 7 accepted section prose blocks while keeping the rejected presentationPlan
    // and keeping every compacted unit 100% valid against the closed tool schema (no invented fields or invalid stubs).
    const validateAgainstToolSchema = (
      value: unknown,
      schema: Record<string, unknown>,
      path = "$",
    ): void => {
      const schemaType = schema.type;
      const allowedTypes = Array.isArray(schemaType) ? schemaType : [schemaType];
      if (value === null) {
        expect(allowedTypes, `${path} nullability`).toContain("null");
        return;
      }
      if (allowedTypes.includes("string") && typeof value === "string") {
        if (typeof schema.maxLength === "number") {
          expect(value.length, `${path} maxLength`).toBeLessThanOrEqual(schema.maxLength);
        }
        if (Array.isArray(schema.enum)) {
          expect(schema.enum, `${path} enum`).toContain(value);
        }
        return;
      }
      if (allowedTypes.includes("integer") && typeof value === "number") {
        expect(Number.isInteger(value), `${path} integer`).toBe(true);
        if (typeof schema.minimum === "number") {
          expect(value, `${path} minimum`).toBeGreaterThanOrEqual(schema.minimum);
        }
        return;
      }
      if (allowedTypes.includes("array") && Array.isArray(value)) {
        if (typeof schema.maxItems === "number") {
          expect(value.length, `${path} maxItems`).toBeLessThanOrEqual(schema.maxItems);
        }
        if (schema.items && typeof schema.items === "object") {
          value.forEach((item, idx) =>
            validateAgainstToolSchema(item, schema.items as Record<string, unknown>, `${path}[${idx}]`),
          );
        }
        return;
      }
      if (allowedTypes.includes("object") && typeof value === "object" && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
        const req = (schema.required ?? []) as string[];
        for (const reqKey of req) {
          expect(obj, `${path} missing required ${reqKey}`).toHaveProperty(reqKey);
        }
        if (schema.additionalProperties === false) {
          for (const key of Object.keys(obj)) {
            expect(props, `${path} unexpected property ${key}`).toHaveProperty(key);
          }
        }
        for (const [key, val] of Object.entries(obj)) {
          if (val !== undefined && props[key]) {
            validateAgainstToolSchema(val, props[key], `${path}.${key}`);
          }
        }
        return;
      }
      throw new Error(`Value at ${path} did not match schema type ${JSON.stringify(schemaType)}`);
    };

    const composeToolSchema = WRITER_COMPOSE_TOOLS.find(
      (t) => t.function.name === "compose_writer_report",
    )!.function.parameters;
    const compactedTurn1Args = stagedProLedger.compactHistoricalCallArguments(turn1Call, {
      resultContent: turn1ToolRes.content,
      isLatestTurn: true,
    });
    expect(compactedTurn1Args.length).toBeLessThan(turn1Call.arguments.length);
    const compactedParsed = JSON.parse(compactedTurn1Args) as {
      presentationPlan: { insights: unknown[] };
      summary: { type: string; text: string; claimRefs: string[]; accepted?: unknown }[];
      sections: {
        id: string;
        heading: string;
        accepted?: unknown;
        claimRefs?: unknown;
        blocks: { type: string; text: string; claimRefs: string[]; accepted?: unknown }[];
      }[];
    };
    validateAgainstToolSchema(compactedParsed, composeToolSchema);
    expect(compactedTurn1Args).not.toContain('"accepted"');
    expect(compactedParsed.presentationPlan.insights).toHaveLength(2);
    expect(compactedParsed.summary[0]?.text).toBe("[accepted]");
    expect(compactedParsed.sections).toHaveLength(7);
    expect(
      compactedParsed.sections.every(
        (s) =>
          s.accepted === undefined &&
          s.claimRefs === undefined &&
          Array.isArray(s.blocks) &&
          s.blocks.length === 1 &&
          s.blocks[0]!.text === "[accepted]" &&
          s.blocks[0]!.claimRefs.length > 0,
      ),
    ).toBe(true);

    // Turn 2: repair presentationPlan (using thematic subset ["P3"] on INS2) AND submit view without resending s1..s7 -> finishes!
    const turn2Res = exec(stagedProLedger, "apply_writer_correction", {
      presentationPlan: {
        audienceObjective: "Deliver a 7-section professional IEP audit.",
        summaryDetailLevel: "COMPREHENSIVE",
        insights: [
          {
            id: "INS1",
            meaning: "Baseline 42 WCPM (86% accuracy) to target 75 WCPM (95% accuracy).",
            claimIds: ["DF13", "DF14", "DF19", "DF20", "DF21", "P2.C0", "P2.C1"],
            questionIds: ["P2", "P4"],
            role: "CENTRAL",
          },
          {
            id: "INS2",
            meaning: "150 minutes weekly reading instruction and accommodations.",
            claimIds: ["DF26", "DF27", "DF30", "DF31"],
            questionIds: ["P3"], // Thematic subset (DF27 also links to P6)
            role: "CENTRAL",
          },
        ],
        priorityFindings: [
          { claimId: "DF19", priority: "HIGH", insightId: "INS1" },
          { claimId: "DF27", priority: "HIGH", insightId: "INS2" },
        ],
        sections: sevenSections.map((s) => ({
          id: s.id,
          heading: s.heading,
          priority: "HIGH" as const,
          claimIds: s.blocks[0]!.claimRefs,
        })),
        components: [
          { component: "Narrative", sectionId: "summary", claimIds: ["DF1", "DF8", "DF19", "DF20", "P2.C0"] },
          ...sevenSections.map((s) => ({
            component: "Narrative" as const,
            sectionId: s.id,
            claimIds: s.blocks[0]!.claimRefs,
          })),
        ],
      },
      view: [
        { component: "Narrative", props: { sectionId: "summary" } },
        ...sevenSections.map((s) => ({ component: "Narrative", props: { sectionId: s.id } })),
      ],
    });

    // Also verify non-latest-turn compaction of presentationPlan, set_report_outline, record_section, and record_scenario against their closed tool schemas
    const compactedTurn1AfterPlanAccepted = JSON.parse(
      stagedProLedger.compactHistoricalCallArguments(turn1Call, {
        resultContent: turn1ToolRes.content,
        isLatestTurn: false,
      }),
    ) as Record<string, unknown>;
    validateAgainstToolSchema(compactedTurn1AfterPlanAccepted, composeToolSchema);
    expect(JSON.stringify(compactedTurn1AfterPlanAccepted)).not.toContain('"accepted"');
    expect(JSON.stringify(compactedTurn1AfterPlanAccepted)).not.toContain('"insightIds"');
    expect(JSON.stringify(compactedTurn1AfterPlanAccepted)).not.toContain('"sectionIds"');

    const recordSecSchema = WRITER_AGENT_TOOLS.find((t) => t.function.name === "record_section")!.function.parameters;
    const compactedRecordSec = JSON.parse(
      stagedProLedger.compactHistoricalCallArguments(
        makeCall("record_section", sevenSections[0]),
        { resultContent: JSON.stringify({ ok: true }), isLatestTurn: true },
      ),
    ) as Record<string, unknown>;
    validateAgainstToolSchema(compactedRecordSec, recordSecSchema);

    const outlineSchema = WRITER_AGENT_TOOLS.find((t) => t.function.name === "set_report_outline")!.function.parameters;
    const compactedOutline = JSON.parse(
      stagedProLedger.compactHistoricalCallArguments(
        makeCall("set_report_outline", {
          presentationPlan: compactedTurn1AfterPlanAccepted.presentationPlan,
          title: "Comprehensive Professional Audit: Maya Carter Initial IEP",
          summary: [
            {
              type: "DOCUMENTED",
              text: "Full summary prose.",
              claimRefs: ["DF1"],
            },
          ],
        }),
        { resultContent: JSON.stringify({ ok: true }), isLatestTurn: true },
      ),
    ) as Record<string, unknown>;
    validateAgainstToolSchema(compactedOutline, outlineSchema);

    expect(turn2Res).toMatchObject({
      ok: true,
      finished: true,
      sectionCount: 7,
      viewComponentCount: 8,
    });
    expect(stagedProLedger.finished).toBe(true);
    const assembled = stagedProLedger.assemble();
    expect(assembled.sections.map((s) => s.blocks[0]!.text)).toEqual(
      sevenSections.map((s) => s.blocks[0]!.text),
    );
    const built = buildReport(assembled, {
      audience: "PRO",
      claims: baseClaims,
      fileNames: l001FileNames,
      canonicalFindings,
      asOf: "2026-11-04",
    });
    expect(built.ok).toBe(true);
  });
});
