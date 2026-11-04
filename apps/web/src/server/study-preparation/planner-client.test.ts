import {
  PLANNER_CONTRACT_VERSION,
  STUDY_AGENT_TOOLS,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  WRITER_AGENT_TOOLS,
} from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import { callPlanner, callStudyAgentTurn, loadPlannerServiceConfig } from "./planner-client";
import type { PlannerPrompt } from "./prompt-catalog";

const CORRELATION_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const prompt: PlannerPrompt = {
  task: "intent",
  id: "hive-intent/1",
  digest: `sha256:${"a".repeat(64)}`,
  systemPrompt: "system",
};
const config = { baseUrl: "https://reader.example.test/planner", serviceToken: "planner-token", timeoutMs: 1000 };

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function call(fetchFn: ReturnType<typeof vi.fn>) {
  return callPlanner(
    { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
    { prompt, userPayload: { task: "intent" }, correlationId: CORRELATION_ID, processingRunId: RUN_ID },
  );
}

const ok = {
  contract_version: PLANNER_CONTRACT_VERSION,
  task: "intent",
  model_alias: "sorter",
  resolved_model: "gpt-4o-mini",
  content_json: { objectives: [] },
  usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  latency_ms: 10,
  finish_reason: "stop",
};

describe("loadPlannerServiceConfig", () => {
  it("requires https (http only for localhost) and a token", () => {
    expect(loadPlannerServiceConfig({ PLANNER_BASE_URL: "https://x.test/planner/", PLANNER_SERVICE_TOKEN: "t" } as never, CORRELATION_ID))
      .toMatchObject({ baseUrl: "https://x.test/planner" });
    expect(loadPlannerServiceConfig({ PLANNER_BASE_URL: "http://127.0.0.1:8083", PLANNER_SERVICE_TOKEN: "t" } as never, CORRELATION_ID))
      .toMatchObject({ baseUrl: "http://127.0.0.1:8083" });
    for (const env of [
      { PLANNER_BASE_URL: "http://x.test/planner", PLANNER_SERVICE_TOKEN: "t" },
      { PLANNER_BASE_URL: "https://x.test/planner" },
      {},
    ]) {
      expect(() => loadPlannerServiceConfig(env as never, CORRELATION_ID)).toThrow(
        expect.objectContaining({ errorCode: "MODEL_UNAVAILABLE", diagnosticReason: "planner_unconfigured" }),
      );
    }
  });
});

describe("callPlanner", () => {
  it("sends the planner contract with the bearer token and correlation headers", async () => {
    const fetchFn = respond(200, ok);
    const result = await call(fetchFn);
    expect(result.contentJson).toEqual({ objectives: [] });
    expect(result.resolvedModel).toBe("gpt-4o-mini");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://reader.example.test/planner/v1/plan-completion");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer planner-token",
      "x-correlation-id": CORRELATION_ID,
      "x-study-run-id": RUN_ID,
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ contract_version: PLANNER_CONTRACT_VERSION, task: "intent", prompt_id: "hive-intent/1" });
    expect(body).not.toHaveProperty("model");
  });

  it.each([
    [401, { error_code: "AUTH_FAILED" }, "MODEL_UNAVAILABLE", false, "planner_auth_failed"],
    [504, { error_code: "MODEL_TIMEOUT", retryable: true }, "MODEL_TIMEOUT", true, "planner_timeout"],
    [502, { error_code: "MODEL_OUTPUT_INVALID", retryable: true }, "MODEL_OUTPUT_INVALID", false, "model_output_invalid"],
    [422, { error_code: "MODEL_CONTEXT_EXCEEDED", retryable: false }, "MODEL_OUTPUT_INVALID", false, "model_context_exceeded"],
    [503, { error_code: "MODEL_UNAVAILABLE", retryable: true }, "MODEL_UNAVAILABLE", true, "planner_unavailable"],
  ])("maps HTTP %s to %s", async (status, body, errorCode, retryable, diagnosticReason) => {
    await expect(call(respond(status, body))).rejects.toMatchObject({ errorCode, retryable, diagnosticReason });
  });

  it("keeps the planner's diagnostic reason instead of collapsing it", async () => {
    const envelope = {
      contract_version: "planner-error@1",
      error_code: "MODEL_OUTPUT_INVALID",
      category: "model",
      retryable: true,
      message_safe: "The planning answer was not JSON.",
      correlation_id: CORRELATION_ID,
      processing_run_id: RUN_ID,
      task: "intent",
      component: "planner",
      operation: "plan_completion",
      diagnostic_reason: "model_output_not_json",
    };
    await expect(call(respond(502, envelope))).rejects.toMatchObject({
      errorCode: "MODEL_OUTPUT_INVALID",
      diagnosticReason: "model_output_not_json",
      operationId: RUN_ID,
      retryable: false,
    });
    await expect(
      call(respond(503, { ...envelope, error_code: "MODEL_UNAVAILABLE", diagnostic_reason: "litellm_http_error" })),
    ).rejects.toMatchObject({ errorCode: "MODEL_UNAVAILABLE", diagnosticReason: "litellm_http_error" });
  });

  it("rejects a success body that breaks the wire contract", async () => {
    await expect(call(respond(200, { ...ok, task: "plan" }))).rejects.toMatchObject({
      errorCode: "MODEL_OUTPUT_INVALID",
      diagnosticReason: "planner_task_mismatch",
    });
  });

  it("maps an empty 502 body to retryable MODEL_UNAVAILABLE without assuming invalid JSON", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 502 }));
    await expect(call(fetchFn)).rejects.toMatchObject({
      errorCode: "MODEL_UNAVAILABLE",
      diagnosticReason: "planner_error_body_unparsed",
      retryable: true,
    });
  });

  it("parses a valid planner-error envelope from a 502 text body", async () => {
    const envelope = {
      contract_version: "planner-error@1",
      error_code: "MODEL_OUTPUT_INVALID",
      retryable: true,
      diagnostic_reason: "model_output_not_json",
    };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(envelope), { status: 502, headers: { "Content-Type": "application/json" } }));
    await expect(call(fetchFn)).rejects.toMatchObject({
      errorCode: "MODEL_OUTPUT_INVALID",
      diagnosticReason: "model_output_not_json",
      retryable: false,
    });
  });

  it("maps a network timeout to MODEL_TIMEOUT", async () => {
    const fetchFn = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    await expect(call(fetchFn)).rejects.toMatchObject({ errorCode: "MODEL_TIMEOUT", retryable: true });
  });
});

describe("callStudyAgentTurn", () => {
  const request = {
    prompt_id: "hive-study-preview/1",
    prompt_digest: `sha256:${"b".repeat(64)}`,
    system_prompt: "system",
    messages: [{ role: "user" as const, content: "Begin." }],
    tools: STUDY_AGENT_TOOLS,
    max_output_tokens: 8000,
    timeout_seconds: 100,
  };
  const turn = {
    contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
    model_alias: "heavy_lifter",
    resolved_model: "synthetic-model",
    message: { content: null, tool_calls: [{ id: "toolu_1", name: "search_case", arguments: '{"query":"goal"}' }] },
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    latency_ms: 20,
    finish_reason: "tool_calls",
  };
  const send = (fetchFn: ReturnType<typeof vi.fn>) =>
    callStudyAgentTurn(
      { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      { request, abortMs: 105_000, correlationId: CORRELATION_ID, processingRunId: RUN_ID },
    );

  it("posts one turn with the fixed tools and returns the unexecuted tool calls", async () => {
    const fetchFn = respond(200, turn);
    const result = await send(fetchFn);
    expect(result.toolCalls).toEqual([{ id: "toolu_1", name: "search_case", arguments: '{"query":"goal"}' }]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://reader.example.test/planner/v1/study-agent-turn");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION, timeout_seconds: 100 });
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toHaveLength(13);
    expect(body).not.toHaveProperty("model");
  });

  it("maps a planner timeout to retryable MODEL_TIMEOUT and truncation to a non-retryable failure", async () => {
    await expect(send(respond(504, { error_code: "MODEL_TIMEOUT", retryable: true }))).rejects.toMatchObject({
      errorCode: "MODEL_TIMEOUT",
      retryable: true,
    });
    await expect(
      send(respond(502, { error_code: "MODEL_OUTPUT_INVALID", retryable: false, diagnostic_reason: "model_output_truncated" })),
    ).rejects.toMatchObject({ errorCode: "MODEL_OUTPUT_INVALID", retryable: false, diagnosticReason: "model_output_truncated" });
  });

  it("rejects a turn that breaks the wire contract", async () => {
    await expect(send(respond(200, { ...turn, contract_version: PLANNER_CONTRACT_VERSION }))).rejects.toMatchObject({
      errorCode: "MODEL_OUTPUT_INVALID",
      diagnosticReason: "planner_contract_version",
    });
  });

  it("posts a Writer agent turn with task: writer and the five Writer tools", async () => {
    const fetchFn = respond(200, { ...turn, model_alias: "harvester" });
    const result = await callStudyAgentTurn(
      { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      {
        request: {
          task: "writer",
          prompt_id: "hive-writer/1",
          prompt_digest: `sha256:${"c".repeat(64)}`,
          system_prompt: "writer system",
          messages: [{ role: "user", content: '{"task":"writer"}' }],
          tools: WRITER_AGENT_TOOLS,
          max_output_tokens: 8000,
          timeout_seconds: 120,
        },
        abortMs: 125_000,
        correlationId: CORRELATION_ID,
        processingRunId: RUN_ID,
      },
    );
    expect(result.modelAlias).toBe("harvester");
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
      task: "writer",
      prompt_id: "hive-writer/1",
    });
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toHaveLength(5);
  });
});
