import { describe, expect, it } from "vitest";

import {
  normalizePlannerCompletion,
  normalizeStudyAgentTurn,
  PIPELINE_PLANNER_TASKS,
  PLANNER_COMPLETION_TASKS,
  PLANNER_CONTRACT_VERSION,
  PLANNER_MAX_OUTPUT_TOKENS,
  PLANNER_MAX_REQUEST_BYTES_BY_TASK,
  PLANNER_TASK_PROMPT_IDS,
  PLANNER_TASKS,
  PREPARATION_PLANNER_TASKS,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  STUDY_AGENT_TURN_LIMITS,
  STUDY_AGENT_TURN_TASKS,
} from "./planner-wire-contracts";

describe("planner tasks", () => {
  it("runs intent intelligence before deterministic prompt construction", () => {
    expect(PREPARATION_PLANNER_TASKS).toEqual(["intent", "domain", "intelligence"]);
    expect(STUDY_AGENT_TURN_TASKS).toEqual(["study", "writer"]);
    expect(PLANNER_TASKS).toEqual(["intent", "domain", "intelligence", "study", "writer"]);
    expect(PLANNER_TASK_PROMPT_IDS.intelligence).toBe("hive-intent-intelligence/1");
    expect(PLANNER_COMPLETION_TASKS).toEqual(["intent", "domain", "intelligence", "extract", "canonicalize", "write"]);
    expect(PLANNER_MAX_OUTPUT_TOKENS).toEqual({
      intent: 4000,
      domain: 4000,
      intelligence: 12000,
      extract: 12000,
      canonicalize: 16000,
      write: 8000,
    });
  });

  it("mirrors the planner's tool-free pipeline tasks, prompt ids and limits", () => {
    expect(PIPELINE_PLANNER_TASKS).toEqual(["extract", "canonicalize", "write"]);
    for (const task of PIPELINE_PLANNER_TASKS) expect(PLANNER_COMPLETION_TASKS).toContain(task);
    expect(PLANNER_TASK_PROMPT_IDS.extract).toBe("hive-extract/1");
    expect(PLANNER_TASK_PROMPT_IDS.canonicalize).toBe("hive-canonicalize/1");
    expect(PLANNER_TASK_PROMPT_IDS.write).toBe("hive-write/1");
    expect(PLANNER_MAX_REQUEST_BYTES_BY_TASK.extract).toBe(1536 * 1024);
    expect(PLANNER_MAX_REQUEST_BYTES_BY_TASK.canonicalize).toBe(2048 * 1024);
    expect(PLANNER_MAX_REQUEST_BYTES_BY_TASK.write).toBe(1024 * 1024);
    expect(PLANNER_MAX_REQUEST_BYTES_BY_TASK.intent).toBe(256 * 1024);
  });

  it("normalizes a pipeline completion for its own task only", () => {
    const raw = response({ task: "canonicalize", model_alias: "heavy_lifter", content_json: { schema: "x" } });
    expect(normalizePlannerCompletion(raw, "canonicalize")).toMatchObject({ ok: true, value: { task: "canonicalize" } });
    expect(normalizePlannerCompletion(raw, "write")).toMatchObject({ ok: false, diagnosticReason: "planner_task_mismatch" });
  });

  it("keeps the study and writer off the single-completion transport", () => {
    expect(PLANNER_TASK_PROMPT_IDS.study).toBe("hive-study-preview/1");
    expect(PLANNER_TASK_PROMPT_IDS.writer).toBe("hive-writer/1");
    expect(PLANNER_COMPLETION_TASKS).not.toContain("study");
    expect(PLANNER_COMPLETION_TASKS).not.toContain("writer");
    expect("study" in PLANNER_MAX_REQUEST_BYTES_BY_TASK).toBe(false);
    expect("writer" in PLANNER_MAX_REQUEST_BYTES_BY_TASK).toBe(false);
    expect(STUDY_AGENT_TURN_LIMITS.maxUserContentChars).toBeGreaterThan(STUDY_AGENT_TURN_LIMITS.maxContentChars);
  });
});

function agentTurn(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
    model_alias: "heavy_lifter",
    resolved_model: "synthetic-model",
    message: {
      content: null,
      tool_calls: [{ id: "toolu_01", name: "search_case", arguments: '{"query":"minutes"}' }],
    },
    usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
    latency_ms: 1200,
    finish_reason: "tool_calls",
    ...overrides,
  };
}

describe("normalizeStudyAgentTurn", () => {
  it("returns the tool calls exactly as sent, without parsing their arguments", () => {
    expect(normalizeStudyAgentTurn(agentTurn())).toEqual({
      ok: true,
      value: {
        modelAlias: "heavy_lifter",
        resolvedModel: "synthetic-model",
        usage: { promptTokens: 900, completionTokens: 40, totalTokens: 940 },
        latencyMs: 1200,
        finishReason: "tool_calls",
        content: null,
        toolCalls: [{ id: "toolu_01", name: "search_case", arguments: '{"query":"minutes"}' }],
      },
    });
  });

  it("keeps unknown tool names for the ledger to reject", () => {
    const turn = agentTurn({ message: { content: "x", tool_calls: [{ id: "a", name: "delete_case", arguments: "{}" }] } });
    expect(normalizeStudyAgentTurn(turn)).toMatchObject({ ok: true, value: { toolCalls: [{ name: "delete_case" }] } });
  });

  it.each([
    [{ contract_version: "planner-completion@1" }, "planner_contract_version"],
    [{ message: null }, "planner_content_missing"],
    [{ message: { content: null, tool_calls: [{ id: "bad id", name: "search_case", arguments: "{}" }] } }, "planner_response_shape"],
    [{ message: { content: null, tool_calls: [{ id: "a", name: "search_case", arguments: { query: "x" } }] } }, "planner_response_shape"],
    [{ model_alias: "has spaces" }, "planner_model_alias"],
  ])("rejects %j", (overrides, reason) => {
    expect(normalizeStudyAgentTurn(agentTurn(overrides))).toMatchObject({ ok: false, diagnosticReason: reason });
  });
});

function response(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: PLANNER_CONTRACT_VERSION,
    task: "domain",
    model_alias: "sorter",
    resolved_model: "gpt-4o-mini-2024-07-18",
    content_json: { primary: {} },
    usage: { prompt_tokens: 900, completion_tokens: 210, total_tokens: 1110 },
    latency_ms: 1640,
    finish_reason: "stop",
    ...overrides,
  };
}

describe("normalizePlannerCompletion", () => {
  it("returns parsed content with usage and latency", () => {
    const result = normalizePlannerCompletion(response(), "domain");
    expect(result).toEqual({
      ok: true,
      value: {
        task: "domain",
        modelAlias: "sorter",
        resolvedModel: "gpt-4o-mini-2024-07-18",
        contentJson: { primary: {} },
        usage: { promptTokens: 900, completionTokens: 210, totalTokens: 1110 },
        latencyMs: 1640,
        finishReason: "stop",
      },
    });
  });

  it("accepts missing usage from the gateway as unknown counts", () => {
    const result = normalizePlannerCompletion(response({ usage: null }), "domain");
    expect(result.ok && result.value.usage).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null });
  });

  it.each([
    [{ contract_version: "planner-completion@2" }, "planner_contract_version"],
    [{ task: "intent" }, "planner_task_mismatch"],
    [{ model_alias: "has spaces" }, "planner_model_alias"],
    [{ latency_ms: -1 }, "planner_metadata"],
    [{ finish_reason: "a sentence with spaces" }, "planner_metadata"],
  ])("rejects %j", (overrides, reason) => {
    expect(normalizePlannerCompletion(response(overrides), "domain")).toMatchObject({
      ok: false,
      diagnosticReason: reason,
    });
  });

  it("rejects a response without content", () => {
    const { content_json: _content, ...rest } = response();
    expect(normalizePlannerCompletion(rest, "domain")).toMatchObject({
      ok: false,
      diagnosticReason: "planner_content_missing",
    });
  });
});
