import type { ContractValidation } from "../source-documents/source-document-contracts";

/**
 * Wire contract between the web server and the Oracle `v4-planner` (D-039). Mirrored in
 * `infra/oracle/v4_planner.py`. The planner chooses the model alias itself; callers cannot.
 */
export const PLANNER_CONTRACT_VERSION = "planner-completion@1";

export const PLANNER_TASKS = ["intent", "domain", "intelligence", "plan"] as const;
export type PlannerTask = (typeof PLANNER_TASKS)[number];

export const PLANNER_TASK_PROMPT_IDS: Record<PlannerTask, string> = {
  intent: "hive.intent-analysis/1",
  domain: "hive-domain/1",
  intelligence: "hive-intent-intelligence/1",
  plan: "hive-plan/1",
};

/** Per-task output caps; the planner enforces the same limits. */
export const PLANNER_MAX_OUTPUT_TOKENS: Record<PlannerTask, number> = {
  intent: 4000,
  domain: 4000,
  intelligence: 12000,
  plan: 12000,
};
export const PLANNER_MAX_REQUEST_BYTES = 256 * 1024;

export type PlannerCompletionRequest = {
  contract_version: typeof PLANNER_CONTRACT_VERSION;
  task: PlannerTask;
  prompt_id: string;
  prompt_digest: string;
  system_prompt: string;
  user_payload: Record<string, unknown>;
  max_output_tokens: number;
};

export type PlannerUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type PlannerCompletion = {
  task: PlannerTask;
  modelAlias: string;
  resolvedModel: string | null;
  contentJson: unknown;
  usage: PlannerUsage;
  latencyMs: number;
  finishReason: string | null;
};

const SAFE_TOKEN = /^[A-Za-z0-9_.:/@+-]{1,128}$/;

function optionalCount(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function optionalSafeToken(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

export function normalizePlannerCompletion(
  raw: unknown,
  expectedTask: PlannerTask,
): ContractValidation<PlannerCompletion> {
  const invalid = (diagnosticReason: string): ContractValidation<PlannerCompletion> => ({
    ok: false,
    message: "The planning service returned an unexpected response.",
    diagnosticReason,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("planner_response_shape");
  const record = raw as Record<string, unknown>;
  if (record.contract_version !== PLANNER_CONTRACT_VERSION) return invalid("planner_contract_version");
  if (record.task !== expectedTask) return invalid("planner_task_mismatch");
  if (typeof record.model_alias !== "string" || !SAFE_TOKEN.test(record.model_alias)) {
    return invalid("planner_model_alias");
  }
  const usage = (record.usage ?? {}) as Record<string, unknown>;
  if (typeof usage !== "object" || Array.isArray(usage)) return invalid("planner_usage");
  const promptTokens = optionalCount(usage.prompt_tokens);
  const completionTokens = optionalCount(usage.completion_tokens);
  const totalTokens = optionalCount(usage.total_tokens);
  const latencyMs = optionalCount(record.latency_ms);
  const resolvedModel = optionalSafeToken(record.resolved_model);
  const finishReason = optionalSafeToken(record.finish_reason);
  if (
    promptTokens === undefined ||
    completionTokens === undefined ||
    totalTokens === undefined ||
    latencyMs === undefined ||
    latencyMs === null ||
    resolvedModel === undefined ||
    finishReason === undefined
  ) {
    return invalid("planner_metadata");
  }
  if (!("content_json" in record)) return invalid("planner_content_missing");
  return {
    ok: true,
    value: {
      task: expectedTask,
      modelAlias: record.model_alias,
      resolvedModel,
      contentJson: record.content_json,
      usage: { promptTokens, completionTokens, totalTokens },
      latencyMs,
      finishReason,
    },
  };
}
