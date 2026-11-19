import { ASSISTANT_REPLY_PROMPT_ID } from "@hiveforyou/contracts";

import { MODEL_REGISTRY } from "@/server/models/model-registry";
import { callPlanner, loadPlannerServiceConfig, type PlannerDeps } from "@/server/study-preparation/planner-client";

import { loadHiveAssistantReplyPrompt } from "./hive-assistant-prompt";

export type AssistantModelRunner = (input: {
  briefing: Record<string, unknown>;
  correlationId: string;
}) => Promise<
  | { ok: true; output: unknown; modelId: string | null; latencyMs: number }
  | { ok: false; errorCode: string }
>;

export function createDefaultAssistantModelRunner(deps?: Partial<PlannerDeps>): AssistantModelRunner {
  const getConfig = deps?.getConfig ?? (() => loadPlannerServiceConfig(process.env, ""));
  const plannerDeps: PlannerDeps = { getConfig, fetchFn: deps?.fetchFn };

  return async (input) => {
    const prompt = loadHiveAssistantReplyPrompt();
    const registry = MODEL_REGISTRY.assistant_reply;
    try {
      const result = await callPlanner(plannerDeps, {
        prompt,
        userPayload: input.briefing,
        correlationId: input.correlationId,
        processingRunId: input.correlationId,
        timeoutMs: registry.timeoutMs,
      });
      const content = result.contentJson;
      if (!content || typeof content !== "object") {
        return { ok: false, errorCode: "invalid_output" };
      }
      return {
        ok: true,
        output: content,
        modelId: result.resolvedModel ?? ASSISTANT_REPLY_PROMPT_ID,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") return { ok: false, errorCode: "timeout" };
      return { ok: false, errorCode: "planner_error" };
    }
  };
}