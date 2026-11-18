import { CHECKLIST_TAILOR_PROMPT_ID } from "@hiveforyou/contracts";

import { loadChecklistTailorPrompt } from "@/server/study-preparation/checklist-tailor-prompt";
import { callPlanner, loadPlannerServiceConfig, type PlannerDeps } from "@/server/study-preparation/planner-client";
import { MODEL_REGISTRY } from "@/server/models/model-registry";

import type { ChecklistTailorModelRunner } from "./checklist-tailor-service";

export function createDefaultChecklistTailorModelRunner(deps?: Partial<PlannerDeps>): ChecklistTailorModelRunner {
  const getConfig = deps?.getConfig ?? (() => loadPlannerServiceConfig(process.env, ""));
  const plannerDeps: PlannerDeps = { getConfig, fetchFn: deps?.fetchFn };

  return async (input) => {
    const prompt = loadChecklistTailorPrompt();
    const registry = MODEL_REGISTRY.checklist_tailor;
    const correlationId = input.correlationId;
    try {
      const result = await callPlanner(plannerDeps, {
        prompt,
        userPayload: {
          packTitle: input.packTitle,
          professionalText: input.professionalText,
          rows: input.rows.map((row) => ({
            key: row.key,
            title: row.title,
            appliesWhen: row.appliesWhen,
          })),
        },
        correlationId,
        processingRunId: correlationId,
        timeoutMs: registry.timeoutMs,
      });
      const content = result.contentJson;
      if (!content || typeof content !== "object") return { ok: false };
      return {
        ok: true,
        output: content as never,
        modelId: result.resolvedModel ?? CHECKLIST_TAILOR_PROMPT_ID,
        latencyMs: result.latencyMs,
      };
    } catch {
      return { ok: false };
    }
  };
}