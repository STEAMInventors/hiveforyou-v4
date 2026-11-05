import {
  parseStudyAgentBudgetDiagnosticField,
  STUDY_AGENT_BUDGET,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  type StudyAgentTurnRequest,
  verifyStudyInvestigation,
} from "@hiveforyou/contracts";
import {
  L001_INITIAL_IEP_DOC_ID,
  L001_INITIAL_IEP_PAGES,
  L001_INITIAL_IEP_PLAN_QUESTION_IDS,
  l001InitialIepStudyAgentTurns,
  MAYA_DOCS,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  MAYA_SIX_PLAN_QUESTION_IDS,
  mayaSixQuestionStudyAgentTurns,
  mayaStudyAgentTurns,
} from "@hiveforyou/contracts/testing";
import { describe, expect, it, vi } from "vitest";

import { renderSourcePageIndex, runStudyInvestigation, StudyAgentFailure } from "./study-investigation";

const CORRELATION_ID = "66666666-6666-4666-8666-666666666666";
const PAGES = Object.entries(MAYA_PAGES).map(([key, text]) => {
  const [sourceDocumentId, page] = key.split(":");
  return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
});
type Call = { id: string; name: string; arguments: string };

function turnBody(toolCalls: Call[], overrides: Record<string, unknown> = {}) {
  return {
    contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
    model_alias: "heavy_lifter",
    resolved_model: "synthetic-model",
    message: { content: null, tool_calls: toolCalls },
    usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
    latency_ms: 50,
    finish_reason: "tool_calls",
    ...overrides,
  };
}

/** Serves `respond(turnIndex, body)` for each turn; turnIndex counts assistant turns already sent. */
function planner(respond: (turn: number, body: StudyAgentTurnRequest) => Response | Promise<Response>) {
  const bodies: StudyAgentTurnRequest[] = [];
  const signals: number[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as StudyAgentTurnRequest;
    bodies.push(body);
    signals.push(body.timeout_seconds);
    return respond(body.messages.filter((message) => message.role === "assistant").length, body);
  });
  return {
    bodies,
    signals,
    deps: {
      getConfig: () => ({ baseUrl: "https://reader.example.test/planner", serviceToken: "t", timeoutMs: 1000 }),
      fetchFn: fetchFn as unknown as typeof fetch,
    },
  };
}

const scripted = (turn: number) =>
  new Response(JSON.stringify(turnBody(mayaStudyAgentTurns()[turn] ?? [])), { status: 200 });

function run(p: ReturnType<typeof planner>, overrides: Partial<Parameters<typeof runStudyInvestigation>[0]> = {}) {
  return runStudyInvestigation({
    planner: p.deps,
    runId: MAYA_RUN_ID,
    correlationId: CORRELATION_ID,
    prompt: { id: "hive-study-preview/1", digest: `sha256:${"a".repeat(64)}`, systemPrompt: "system" },
    questionIds: MAYA_PLAN_QUESTION_IDS,
    pages: PAGES,
    deadline: Date.now() + STUDY_AGENT_BUDGET.wallClockMs,
    ...overrides,
  });
}

async function failure(promise: Promise<unknown>): Promise<StudyAgentFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StudyAgentFailure) return error;
    throw error;
  }
  throw new Error("expected the investigation to fail");
}

describe("runStudyInvestigation", () => {
  it("runs the scripted turns to a finished Study and totals usage across turns", async () => {
    const p = planner(scripted);
    const { study, totals } = await run(p);
    expect(study.answers.map((answer) => answer.planQuestionId)).toEqual(["P1", "P2", "P3"]);
    expect(totals).toMatchObject({
      rounds: 5,
      roundsAllowed: 13,
      toolCalls: 51,
      invalidCalls: 0,
      questionsCompleted: 3,
      questionsTotal: 3,
      promptTokens: 5000,
      completionTokens: 1000,
      modelAlias: "heavy_lifter",
    });
    expect(p.bodies[0]!.tools).toHaveLength(13);
    expect(p.bodies[0]!.messages).toEqual([{ role: "user", content: expect.stringContaining("finish_study") }]);
    expect(p.bodies[0]!.messages[0]?.content).toContain("documentReconciliations");
    expect(p.bodies[0]!.messages[0]?.content).toContain("evidenceNeeds");
    expect(study.documents).toHaveLength(8);
    expect(p.bodies[1]!.messages[1]).toMatchObject({ role: "assistant", content: null });
    expect((p.bodies[1]!.messages[1] as { tool_calls: unknown[] }).tool_calls[0]).toEqual({
      id: "toolu_maya_1",
      type: "function",
      function: { name: "search_case", arguments: '{"query":"words correct per minute"}' },
    });
    expect(p.bodies[1]!.messages[2]).toMatchObject({ role: "tool", tool_call_id: "toolu_maya_1" });
  });

  it("completes 6 plan questions (P1-P6) in 6 batched turns well within the 19-round budget", async () => {
    const turns = mayaSixQuestionStudyAgentTurns();
    const p = planner((turn) => new Response(JSON.stringify(turnBody(turns[turn] ?? [])), { status: 200 }));
    const { study, totals } = await run(p, { questionIds: MAYA_SIX_PLAN_QUESTION_IDS });
    expect(study.answers.map((answer) => answer.planQuestionId)).toEqual([...MAYA_SIX_PLAN_QUESTION_IDS]);
    expect(totals).toMatchObject({
      rounds: 6,
      roundsAllowed: 19,
      invalidCalls: 0,
      questionsCompleted: 6,
      questionsTotal: 6,
    });
  });

  it("runs the document-centered L001 Maya Carter golden (08_initial_iep.pdf) through runStudyInvestigation with 37 DF findings and zero duplicate question facts (V4-004I Gate 3)", async () => {
    const l001Pages = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const turns = l001InitialIepStudyAgentTurns();
    const p = planner((turn) => new Response(JSON.stringify(turnBody(turns[turn] ?? [])), { status: 200 }));
    const { study, totals } = await run(p, {
      questionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS,
      pages: l001Pages,
    });

    expect(totals).toMatchObject({
      rounds: 6,
      roundsAllowed: 19,
      invalidCalls: 0,
      questionsCompleted: 6,
      questionsTotal: 6,
    });
    expect(p.bodies[0]!.messages[0]?.content).toContain("read all authorized non-empty pages of PRIMARY documents");
    expect(p.bodies[0]!.messages[0]?.content).toContain("record_document_finding");
    expect(study.documents).toHaveLength(1);
    expect(study.documents![0]).toMatchObject({
      sourceDocumentId: L001_INITIAL_IEP_DOC_ID,
      role: "PRIMARY",
      temporalStatus: "HISTORICAL",
      declaredReadCoverage: "FULL_DOCUMENT_READ",
      pagesRead: [1, 2, 3],
      pagesCited: [1, 2, 3],
    });
    expect(study.documentFindings).toHaveLength(37);
    expect(study.answers.map((a) => a.planQuestionId)).toEqual([...L001_INITIAL_IEP_PLAN_QUESTION_IDS]);
    expect(study.answers.every((a) => a.facts.length === 0)).toBe(true);
    expect(study.answers.every((a) => (a.findingIds?.length ?? 0) > 0)).toBe(true);
  });

  it("reproduces the live Round 2 16-call / 13-invalid failure pattern (r2/18:tc16:inv13:q0/6), delivers tool error feedback in Round 3, emits privacy-safe rejection telemetry, and recovers to complete the 37-finding L001 Maya Carter Study (V4-004I Gate 4C)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const l001Pages = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
        const [sourceDocumentId, page] = key.split(":");
        return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
      });
      const goldenTurns = l001InitialIepStudyAgentTurns();

      // Round 1 (1 valid call): read_pages(1..3) on 08_initial_iep.pdf
      const round1Calls: Call[] = [goldenTurns[0]![0]!];

      // Round 2 (15 calls: 2 valid record_evidence calls + 13 invalid calls in one batch -> total tc=16, inv=13, q=0/6):
      // Simulates premature record_document and record_document_finding calls citing unrecorded predicted E3..E12/DF12 ids,
      // an ungrounded number (45 WCPM vs 42 WCPM), and premature finish_question before DF findings exist.
      const round2Calls: Call[] = [
        goldenTurns[1]![0]!, // E1 valid
        goldenTurns[1]![1]!, // E2 valid
        {
          id: "toolu_r2_bad_doc",
          name: "record_document",
          arguments: JSON.stringify({
            documentId: L001_INITIAL_IEP_DOC_ID,
            role: "PRIMARY",
            roleReasoning: "Primary Initial IEP for Maya Carter.",
            documentType: "Initial Individualized Education Program (IEP)",
            temporalStatus: "HISTORICAL",
            declaredReadCoverage: "FULL_DOCUMENT_READ",
            evidenceIds: ["E1", "E2", "E6", "E8"], // E6 & E8 not yet recorded -> unknown_evidence
          }),
        },
        ...Array.from({ length: 10 }, (_, idx) => ({
          id: `toolu_r2_bad_df_${idx + 1}`,
          name: "record_document_finding",
          arguments: JSON.stringify({
            documentId: L001_INITIAL_IEP_DOC_ID,
            category: "student_profile",
            subject: "Maya Carter",
            attribute: `premature_attr_${idx + 1}`,
            valueAsWritten: "Maya Carter",
            statement: "Student is Maya Carter.",
            evidenceIds: [`E${idx + 3}`], // Predicted E3..E12 before record_evidence returned -> unknown_evidence
          }),
        })),
        {
          id: "toolu_r2_bad_num",
          name: "record_document_finding",
          arguments: JSON.stringify({
            documentId: L001_INITIAL_IEP_DOC_ID,
            category: "annual_goal",
            subject: "GOAL_READING_FLUENCY",
            attribute: "baseline",
            valueAsWritten: "45 WCPM",
            statement: "Baseline is 45 WCPM.",
            evidenceIds: ["E1"], // 45 not in E1 -> finding_number_ungrounded
          }),
        },
        {
          id: "toolu_r2_bad_finish_q",
          name: "finish_question",
          arguments: JSON.stringify({
            questionId: "P1",
            status: "ANSWERED",
            answer: "Premature closure citing unrecorded DF1.",
            findingIds: ["DF1"], // DF1 not yet recorded -> unknown_finding
            uncertainties: [],
            limitations: [],
          }),
        },
      ];
      expect(round1Calls.length + round2Calls.length).toBe(16);

      // Rounds 3–7: After receiving the 13 error results in Round 3, the agent records the remaining evidence (E3..E34),
      // records the document, records all 37 DF findings using confirmed E... ids, and closes P1..P6 + finish_study.
      const recoveryTurns: Call[][] = [
        round1Calls,
        round2Calls,
        goldenTurns[1]!.slice(2), // Remaining E3..E16 from Page 1
        goldenTurns[2]!, // E17..E34 + record_document
        goldenTurns[3]!, // DF1..DF19
        goldenTurns[4]!, // DF20..DF37
        goldenTurns[5]!, // Calculations, assessment, determination, finish_question P1..P6, finish_study
      ];

      const p = planner((turn) => new Response(JSON.stringify(turnBody(recoveryTurns[turn] ?? [])), { status: 200 }));
      const { study, totals } = await run(p, {
        questionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS,
        pages: l001Pages,
      });

      // Verify Round 3 received the exact error feedback for all 13 rejected calls from Round 2
      const round3Request = p.bodies[2]!;
      const round2ToolReplies = round3Request.messages.slice(-15);
      expect(round2ToolReplies).toHaveLength(15);
      const parsedReplies = round2ToolReplies.map((m) => JSON.parse(m.content) as { ok: boolean; error?: string; message?: string });
      expect(parsedReplies.filter((r) => r.ok)).toHaveLength(2);
      expect(parsedReplies.filter((r) => !r.ok)).toHaveLength(13);
      expect(parsedReplies.find((r) => r.error === "unknown_evidence")?.message).toContain("use only confirmed E... ids");
      expect(parsedReplies.find((r) => r.error === "unknown_finding")?.message).toContain("use only confirmed DF... ids");
      expect(parsedReplies.find((r) => r.error === "finding_number_ungrounded")?.message).toContain("45");

      // Verify the Study recovered and completed within the 19-round budget with all 13 rejections recorded
      expect(totals).toMatchObject({
        rounds: 7,
        roundsAllowed: 19,
        invalidCalls: 13,
        invalidBudgetUsed: 1,
        rejectionCounts: {
          unknown_evidence: 11,
          finding_number_ungrounded: 1,
          unknown_finding: 1,
        },
        rejectionSummary: "unknown_evidence:11,finding_number_ungrounded:1,unknown_finding:1",
        questionsCompleted: 6,
        questionsTotal: 6,
      });

      // Verify privacy-safe telemetry was emitted with rejection codes and counts, and zero document text or quotes
      const telemetryLines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(telemetryLines).toHaveLength(1);
      const telemetryEvent = JSON.parse(telemetryLines[0]!) as Record<string, unknown>;
      expect(telemetryEvent).toMatchObject({
        eventName: "study.turn.rejected",
        severity: "WARN",
        component: "analysis",
        operation: "investigate",
        stage: "ANALYZE",
        task: "study",
        correlationId: CORRELATION_ID,
        processingRunId: MAYA_RUN_ID,
        rounds: 2,
        rejectedUnits: 13,
        diagnosticReason: "unknown_evidence",
        rejectionSummary: "unknown_evidence:11,finding_number_ungrounded:1,unknown_finding:1",
      });
      expect(telemetryLines[0]).not.toContain("Maya Carter");
      expect(telemetryLines[0]).not.toContain("45 WCPM");
      expect(telemetryLines[0]).not.toContain("Synthetic Elementary");

      // Verify the recovered Study passes verifyStudyInvestigation with all 37 DF findings and 0 duplicate question facts
      expect(study.documentFindings).toHaveLength(37);
      expect(study.answers.every((a) => a.facts.length === 0)).toBe(true);
      const verified = verifyStudyInvestigation(study, {
        processingRunId: MAYA_RUN_ID,
        planQuestionIds: [...L001_INITIAL_IEP_PLAN_QUESTION_IDS],
        pages: new Map(Object.entries(L001_INITIAL_IEP_PAGES)),
        requireCorpusReconciliation: true,
      });
      expect(verified.ok).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("still terminates with study_agent_budget_exhausted (budget.invalid_calls) when the model fails to recover across allowance.invalidCalls turns", async () => {
    const p = planner((turn) =>
      new Response(
        JSON.stringify(
          turnBody([
            {
              id: `bad_a_${turn}`,
              name: "record_document_finding",
              arguments: JSON.stringify({
                documentId: L001_INITIAL_IEP_DOC_ID,
                category: "annual_goal",
                subject: "GOAL_READING_FLUENCY",
                attribute: "baseline",
                valueAsWritten: "42 WCPM",
                evidenceIds: ["E99"],
              }),
            },
            {
              id: `bad_b_${turn}`,
              name: "finish_question",
              arguments: JSON.stringify({
                questionId: "P1",
                status: "ANSWERED",
                answer: "Unbacked.",
                findingIds: ["DF99"],
                uncertainties: [],
                limitations: [],
              }),
            },
          ]),
        ),
        { status: 200 },
      ),
    );
    const l001Pages = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const failed = await failure(run(p, { questionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS, pages: l001Pages }));
    // 6 questions -> allowance.invalidCalls = 10 turns, stopping at r10/19 with 20 total calls and 20 invalid calls
    expect(p.bodies).toHaveLength(10);
    expect(failed.hiveError.diagnosticField).toBe("budget.invalid_calls:r10/19:tc20:inv20:q0/6");
    expect(failed.totals.rejectionSummary).toBe("unknown_evidence:10,unknown_finding:10");
  });

  it("derives each turn timeout from the remaining stage time and never starts a turn that cannot fit", async () => {
    let now = 0;
    const p = planner((turn) => {
      now += 75_000;
      return scripted(turn);
    });
    const failed = await failure(run(p, { deadline: 235_000, clock: () => now }));
    expect(p.signals).toEqual([145, 145, 80]);
    expect(failed.hiveError).toMatchObject({
      errorCode: "MODEL_OUTPUT_INVALID",
      retryable: false,
      diagnosticReason: "study_agent_budget_exhausted",
      diagnosticField: "budget.wall_clock:r3/13:tc32:inv0:q0/3",
    });
    expect(parseStudyAgentBudgetDiagnosticField(failed.hiveError.diagnosticField)).toEqual({
      dimension: "wall_clock",
      roundsUsed: 3,
      roundsAllowed: 13,
      toolCalls: 32,
      invalidCalls: 0,
      questionsCompleted: 0,
      questionsTotal: 3,
    });
    expect(failed.totals.rounds).toBe(3);
  });

  it("does not execute a reply that arrives after the deadline", async () => {
    let now = 0;
    const p = planner((turn) => {
      now = turn === 0 ? 10_000 : 300_000;
      return scripted(turn);
    });
    const failed = await failure(run(p, { deadline: 235_000, clock: () => now }));
    expect(failed.hiveError.diagnosticField).toBe("budget.wall_clock:r2/13:tc9:inv0:q0/3");
    expect(failed.totals).toMatchObject({ rounds: 2, toolCalls: 9 });
  });

  it("stops at the round allowance for the plan size and reports safe progress counters", async () => {
    const p = planner((turn) => new Response(JSON.stringify(turnBody([{ id: `s${turn}`, name: "search_case", arguments: '{"query":"goal"}' }])), { status: 200 }));
    const failed = await failure(run(p, { questionIds: MAYA_SIX_PLAN_QUESTION_IDS }));
    expect(p.bodies).toHaveLength(19);
    expect(failed.hiveError.diagnosticField).toBe("budget.rounds:r19/19:tc19:inv0:q0/6");
    expect(parseStudyAgentBudgetDiagnosticField(failed.hiveError.diagnosticField)).toEqual({
      dimension: "rounds",
      roundsUsed: 19,
      roundsAllowed: 19,
      toolCalls: 19,
      invalidCalls: 0,
      questionsCompleted: 0,
      questionsTotal: 6,
    });
  });

  it("counts turns without tool calls as invalid, nudges, and stops at the invalid-call allowance", async () => {
    const p = planner(() => new Response(JSON.stringify(turnBody([], { message: { content: "Here is my answer.", tool_calls: [] } })), { status: 200 }));
    const failed = await failure(run(p));
    expect(p.bodies).toHaveLength(7);
    expect(p.bodies[1]!.messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("No tool was called") });
    expect(failed.hiveError.diagnosticField).toBe("budget.invalid_calls:r7/13:tc0:inv7:q0/3");
  });

  it("declines calls beyond the per-turn cap while still answering every call id", async () => {
    const many = Array.from({ length: STUDY_AGENT_BUDGET.maxCallsPerTurn + 2 }, (_, i) => ({
      id: `c${i}`,
      name: "search_case",
      arguments: JSON.stringify({ query: `goal ${i}` }),
    }));
    const p = planner((turn) => (turn === 0 ? new Response(JSON.stringify(turnBody(many)), { status: 200 }) : scripted(turn - 1)));
    const { totals } = await run(p);
    expect(totals.invalidCalls).toBe(2);
    const replies = p.bodies[1]!.messages.filter((message) => message.role === "tool");
    expect(replies).toHaveLength(many.length);
    expect(replies.slice(-2).map((reply) => JSON.parse(reply.content).error)).toEqual(["too_many_calls", "too_many_calls"]);
  });

  it("stops before a request that would exceed the request size, token or cost ceilings", async () => {
    const huge = planner(scripted);
    const bigPrompt = "x".repeat(STUDY_AGENT_BUDGET.maxRequestBytes);
    expect((await failure(run(huge, { prompt: { id: "p", digest: "d", systemPrompt: bigPrompt } }))).hiveError.diagnosticField).toBe(
      "budget.request_bytes:r0/13:tc0:inv0:q0/3",
    );
    expect(huge.bodies).toHaveLength(0);

    const tokens = planner((turn) =>
      new Response(JSON.stringify(turnBody(mayaStudyAgentTurns()[turn] ?? [], { usage: { prompt_tokens: 599_000, completion_tokens: 10 } })), {
        status: 200,
      }),
    );
    expect((await failure(run(tokens))).hiveError.diagnosticField).toBe("budget.input_tokens:r1/13:tc9:inv0:q0/3");
    expect(tokens.bodies).toHaveLength(1);

    const output = planner((turn) =>
      new Response(JSON.stringify(turnBody(mayaStudyAgentTurns()[turn] ?? [], { usage: { prompt_tokens: 10, completion_tokens: 47_500 } })), {
        status: 200,
      }),
    );
    expect((await failure(run(output))).hiveError.diagnosticField).toBe("budget.output_tokens:r1/13:tc9:inv0:q0/3");

    const cost = planner((turn) =>
      new Response(JSON.stringify(turnBody(mayaStudyAgentTurns()[turn] ?? [], { usage: { prompt_tokens: 400_000, completion_tokens: 30_000 } })), {
        status: 200,
      }),
    );
    expect((await failure(run(cost))).hiveError.diagnosticField).toBe("budget.estimated_cost:r1/13:tc9:inv0:q0/3");
  });

  it("passes transient planner failures through for the stage retry", async () => {
    const p = planner((turn) =>
      turn === 1
        ? new Response(JSON.stringify({ contract_version: "planner-error@1", error_code: "MODEL_TIMEOUT", retryable: true }), { status: 504 })
        : scripted(turn),
    );
    const failed = await failure(run(p));
    expect(failed.hiveError).toMatchObject({ errorCode: "MODEL_TIMEOUT", retryable: true });
    expect(failed.totals).toMatchObject({ rounds: 1, toolCalls: 9 });
  });
});

describe("renderSourcePageIndex", () => {
  it("lists every document of the case with its page ranges, without page text", () => {
    const index = renderSourcePageIndex([
      ...PAGES,
      { sourceDocumentId: MAYA_DOCS.teacherNotes, pageNumber: 2, text: " " },
      { sourceDocumentId: MAYA_DOCS.teacherNotes, pageNumber: 4, text: "Later notes." },
    ]);
    expect(index.split("\n")[0]).toBe("11 authorized pages in 8 documents:");
    expect(index).toContain(`- documentId ${MAYA_DOCS.iep2025} · pages 1-2 · `);
    expect(index).toContain(`- documentId ${MAYA_DOCS.teacherNotes} · pages 1-2, 4 · `);
    expect(index).toContain("no text on 2");
    for (const text of Object.values(MAYA_PAGES)) expect(index).not.toContain(text);
  });
});
