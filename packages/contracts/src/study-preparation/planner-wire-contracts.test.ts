import { describe, expect, it } from "vitest";

import {
  normalizePlannerCompletion,
  PLANNER_CONTRACT_VERSION,
  PLANNER_MAX_OUTPUT_TOKENS,
  PLANNER_TASK_PROMPT_IDS,
  PLANNER_TASKS,
} from "./planner-wire-contracts";

describe("planner tasks", () => {
  it("runs intent intelligence between domain and plan with its own prompt and output budget", () => {
    expect(PLANNER_TASKS).toEqual(["intent", "domain", "intelligence", "plan"]);
    expect(PLANNER_TASK_PROMPT_IDS.intelligence).toBe("hive-intent-intelligence/1");
    expect(PLANNER_MAX_OUTPUT_TOKENS).toEqual({ intent: 4000, domain: 4000, intelligence: 12000, plan: 12000 });
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
