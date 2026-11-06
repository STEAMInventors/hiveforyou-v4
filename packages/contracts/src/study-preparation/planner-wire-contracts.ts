import type { StudyAgentToolDefinition } from "../analysis/study-agent";
import type { WriterAgentToolDefinition } from "../reports/writer-agent";
import type { ContractValidation } from "../source-documents/source-document-contracts";

/**
 * Wire contracts between the web server and the Oracle `v4-planner` (D-039, D-042, D-045). Mirrored in
 * `infra/oracle/v4_planner.py`. The planner chooses the model alias itself; callers cannot.
 * `planner-completion@1` carries one JSON completion (intent, domain, intelligence, extract, canonicalize, write);
 * `study-agent-turn@1` relays one Canonical Study or Writer tool-calling turn and never runs a tool.
 */
export const PLANNER_CONTRACT_VERSION = "planner-completion@1";
export const STUDY_AGENT_TURN_CONTRACT_VERSION = "study-agent-turn@1";

/** Model stages before deterministic prompt construction (investigation questions are derived in code). */
export const PREPARATION_PLANNER_TASKS = ["intent", "domain", "intelligence"] as const;
export type PreparationPlannerTask = (typeof PREPARATION_PLANNER_TASKS)[number];
/** Tool-free pipeline stages; each requires its own planner alias and fails closed when unset. */
export const PIPELINE_PLANNER_TASKS = ["extract", "canonicalize", "write"] as const;
export type PipelinePlannerTask = (typeof PIPELINE_PLANNER_TASKS)[number];
/** Tasks sent as one `planner-completion@1` call. */
export const PLANNER_COMPLETION_TASKS = [...PREPARATION_PLANNER_TASKS, ...PIPELINE_PLANNER_TASKS] as const;
export type PlannerCompletionTask = (typeof PLANNER_COMPLETION_TASKS)[number];
/** Agentic tool-calling tasks relayed through `study-agent-turn@1` (D-042, D-045). */
export const STUDY_AGENT_TURN_TASKS = ["study", "writer"] as const;
export type StudyAgentTurnTask = (typeof STUDY_AGENT_TURN_TASKS)[number];
/** Every planner task; `study` and `writer` run through `study-agent-turn@1` (D-042, D-045). */
export const PLANNER_TASKS = [...PREPARATION_PLANNER_TASKS, ...STUDY_AGENT_TURN_TASKS] as const;
export type PlannerTask = (typeof PLANNER_TASKS)[number];

export const PLANNER_TASK_PROMPT_IDS: Record<PlannerTask | PipelinePlannerTask, string> = {
  intent: "hive.intent-analysis/1",
  domain: "hive-domain/1",
  intelligence: "hive-intent-intelligence/1",
  study: "hive-study-preview/1",
  writer: "hive-writer/1",
  extract: "hive-extract/1",
  canonicalize: "hive-canonicalize/1",
  write: "hive-write/1",
};

/** Independent Writer semantic review (`study-agent-turn@1`, tool-free JSON completion on `task: "writer"`). */
export const WRITER_SEMANTIC_REVIEW_PROMPT_ID = "hive.writer-semantic-review/1" as const;

/** Per-task output caps; the planner enforces the same limits. */
export const PLANNER_MAX_OUTPUT_TOKENS: Record<PlannerCompletionTask, number> = {
  intent: 4000,
  domain: 4000,
  intelligence: 12000,
  extract: 16000,
  canonicalize: 16000,
  write: 8000,
};
/** Per-task request caps. */
export const PLANNER_MAX_REQUEST_BYTES_BY_TASK: Record<PlannerCompletionTask, number> = {
  intent: 256 * 1024,
  domain: 256 * 1024,
  intelligence: 256 * 1024,
  extract: 1536 * 1024,
  canonicalize: 2048 * 1024,
  write: 1024 * 1024,
};
export const PLANNER_MAX_REQUEST_BYTES = PLANNER_MAX_REQUEST_BYTES_BY_TASK.intent;

export type PlannerCompletionRequest = {
  contract_version: typeof PLANNER_CONTRACT_VERSION;
  task: PlannerCompletionTask;
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
  task: PlannerCompletionTask;
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

type Metadata = Pick<PlannerCompletion, "modelAlias" | "resolvedModel" | "usage" | "latencyMs" | "finishReason">;

function readMetadata(record: Record<string, unknown>): Metadata | string {
  if (typeof record.model_alias !== "string" || !SAFE_TOKEN.test(record.model_alias)) return "planner_model_alias";
  const usage = (record.usage ?? {}) as Record<string, unknown>;
  if (typeof usage !== "object" || Array.isArray(usage)) return "planner_usage";
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
    return "planner_metadata";
  }
  return {
    modelAlias: record.model_alias,
    resolvedModel,
    usage: { promptTokens, completionTokens, totalTokens },
    latencyMs,
    finishReason,
  };
}

export function normalizePlannerCompletion(
  raw: unknown,
  expectedTask: PlannerCompletionTask,
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
  const metadata = readMetadata(record);
  if (typeof metadata === "string") return invalid(metadata);
  if (!("content_json" in record)) return invalid("planner_content_missing");
  return { ok: true, value: { task: expectedTask, ...metadata, contentJson: record.content_json } };
}

// ---------------------------------------------------------------------------
// `study-agent-turn@1` (D-042): one native tool-calling turn of the Canonical Study investigation.
// ---------------------------------------------------------------------------

/** Planner-side ceilings for one turn; the web budget stays below them. */
export const STUDY_AGENT_TURN_LIMITS = {
  maxRequestBytes: 1024 * 1024,
  maxUserContentChars: 800_000,
  maxOutputTokens: 8000,
  minTimeoutSeconds: 5,
  maxTimeoutSeconds: 240,
  maxToolCalls: 32,
  maxArgumentChars: 32_000,
  maxContentChars: 32_000,
} as const;

export type StudyAgentWireToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type StudyAgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: StudyAgentWireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type StudyAgentTurnRequest = {
  contract_version: typeof STUDY_AGENT_TURN_CONTRACT_VERSION;
  task?: StudyAgentTurnTask;
  prompt_id: string;
  prompt_digest: string;
  system_prompt: string;
  messages: StudyAgentMessage[];
  tools: readonly (StudyAgentToolDefinition | WriterAgentToolDefinition)[];
  max_output_tokens: number;
  timeout_seconds: number;
};

export type StudyAgentTurn = Metadata & {
  content: string | null;
  toolCalls: { id: string; name: string; arguments: string }[];
};

const TOOL_CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

export function normalizeStudyAgentTurn(raw: unknown): ContractValidation<StudyAgentTurn> {
  const invalid = (diagnosticReason: string): ContractValidation<StudyAgentTurn> => ({
    ok: false,
    message: "The planning service returned an unexpected response.",
    diagnosticReason,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("planner_response_shape");
  const record = raw as Record<string, unknown>;
  if (record.contract_version !== STUDY_AGENT_TURN_CONTRACT_VERSION) return invalid("planner_contract_version");
  const metadata = readMetadata(record);
  if (typeof metadata === "string") return invalid(metadata);
  const message = record.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object" || Array.isArray(message)) return invalid("planner_content_missing");
  const content = message.content ?? null;
  if (content !== null && (typeof content !== "string" || content.length > STUDY_AGENT_TURN_LIMITS.maxContentChars)) {
    return invalid("planner_response_shape");
  }
  const calls = message.tool_calls ?? [];
  if (!Array.isArray(calls) || calls.length > STUDY_AGENT_TURN_LIMITS.maxToolCalls) return invalid("planner_response_shape");
  const toolCalls: StudyAgentTurn["toolCalls"] = [];
  for (const call of calls) {
    const item = call as Record<string, unknown> | null;
    if (
      !item ||
      typeof item.id !== "string" ||
      !TOOL_CALL_ID.test(item.id) ||
      typeof item.name !== "string" ||
      !TOOL_NAME.test(item.name) ||
      typeof item.arguments !== "string" ||
      item.arguments.length > STUDY_AGENT_TURN_LIMITS.maxArgumentChars
    ) {
      return invalid("planner_response_shape");
    }
    toolCalls.push({ id: item.id, name: item.name, arguments: item.arguments });
  }
  return { ok: true, value: { ...metadata, content, toolCalls } };
}
