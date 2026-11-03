import {
  parseStudyAgentBudgetDiagnosticField,
  STUDY_AGENT_BUDGET,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  type StudyAgentTurnRequest,
} from "@hiveforyou/contracts";
import {
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
      rounds: 4,
      roundsAllowed: 12,
      toolCalls: 30,
      invalidCalls: 0,
      questionsCompleted: 3,
      questionsTotal: 3,
      promptTokens: 4000,
      completionTokens: 800,
      modelAlias: "heavy_lifter",
    });
    expect(p.bodies[0]!.tools).toHaveLength(11);
    expect(p.bodies[0]!.messages).toEqual([{ role: "user", content: expect.stringContaining("finish_study") }]);
    expect(p.bodies[1]!.messages[1]).toMatchObject({ role: "assistant", content: null });
    expect((p.bodies[1]!.messages[1] as { tool_calls: unknown[] }).tool_calls[0]).toEqual({
      id: "toolu_maya_1",
      type: "function",
      function: { name: "search_case", arguments: '{"query":"words correct per minute"}' },
    });
    expect(p.bodies[1]!.messages[2]).toMatchObject({ role: "tool", tool_call_id: "toolu_maya_1" });
  });

  it("completes 6 plan questions (P1-P6) in 5 batched turns well within the 18-round budget", async () => {
    const turns = mayaSixQuestionStudyAgentTurns();
    const p = planner((turn) => new Response(JSON.stringify(turnBody(turns[turn] ?? [])), { status: 200 }));
    const { study, totals } = await run(p, { questionIds: MAYA_SIX_PLAN_QUESTION_IDS });
    expect(study.answers.map((answer) => answer.planQuestionId)).toEqual([...MAYA_SIX_PLAN_QUESTION_IDS]);
    expect(totals).toMatchObject({
      rounds: 5,
      roundsAllowed: 18,
      invalidCalls: 0,
      questionsCompleted: 6,
      questionsTotal: 6,
    });
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
      diagnosticField: "budget.wall_clock:r3/12:tc26:inv0:q0/3",
    });
    expect(parseStudyAgentBudgetDiagnosticField(failed.hiveError.diagnosticField)).toEqual({
      dimension: "wall_clock",
      roundsUsed: 3,
      roundsAllowed: 12,
      toolCalls: 26,
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
    expect(failed.hiveError.diagnosticField).toBe("budget.wall_clock:r2/12:tc6:inv0:q0/3");
    expect(failed.totals).toMatchObject({ rounds: 2, toolCalls: 6 });
  });

  it("stops at the round allowance for the plan size and reports safe progress counters", async () => {
    const p = planner((turn) => new Response(JSON.stringify(turnBody([{ id: `s${turn}`, name: "search_case", arguments: '{"query":"goal"}' }])), { status: 200 }));
    const failed = await failure(run(p, { questionIds: MAYA_SIX_PLAN_QUESTION_IDS }));
    expect(p.bodies).toHaveLength(18);
    expect(failed.hiveError.diagnosticField).toBe("budget.rounds:r18/18:tc18:inv0:q0/6");
    expect(parseStudyAgentBudgetDiagnosticField(failed.hiveError.diagnosticField)).toEqual({
      dimension: "rounds",
      roundsUsed: 18,
      roundsAllowed: 18,
      toolCalls: 18,
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
    expect(failed.hiveError.diagnosticField).toBe("budget.invalid_calls:r7/12:tc0:inv7:q0/3");
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
      "budget.request_bytes:r0/12:tc0:inv0:q0/3",
    );
    expect(huge.bodies).toHaveLength(0);

    const tokens = planner((turn) =>
      new Response(JSON.stringify(turnBody(mayaStudyAgentTurns()[turn] ?? [], { usage: { prompt_tokens: 599_000, completion_tokens: 10 } })), {
        status: 200,
      }),
    );
    expect((await failure(run(tokens))).hiveError.diagnosticField).toBe("budget.input_tokens:r1/12:tc6:inv0:q0/3");
    expect(tokens.bodies).toHaveLength(1);

    const output = planner((turn) =>
      new Response(JSON.stringify(turnBody(mayaStudyAgentTurns()[turn] ?? [], { usage: { prompt_tokens: 10, completion_tokens: 47_500 } })), {
        status: 200,
      }),
    );
    expect((await failure(run(output))).hiveError.diagnosticField).toBe("budget.output_tokens:r1/12:tc6:inv0:q0/3");

    const cost = planner((turn) =>
      new Response(JSON.stringify(turnBody(mayaStudyAgentTurns()[turn] ?? [], { usage: { prompt_tokens: 400_000, completion_tokens: 30_000 } })), {
        status: 200,
      }),
    );
    expect((await failure(run(cost))).hiveError.diagnosticField).toBe("budget.estimated_cost:r1/12:tc6:inv0:q0/3");
  });

  it("passes transient planner failures through for the stage retry", async () => {
    const p = planner((turn) =>
      turn === 1
        ? new Response(JSON.stringify({ contract_version: "planner-error@1", error_code: "MODEL_TIMEOUT", retryable: true }), { status: 504 })
        : scripted(turn),
    );
    const failed = await failure(run(p));
    expect(failed.hiveError).toMatchObject({ errorCode: "MODEL_TIMEOUT", retryable: true });
    expect(failed.totals).toMatchObject({ rounds: 1, toolCalls: 6 });
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
