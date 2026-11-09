import {
  createHiveError,
  type HiveError,
  normalizePlannerCompletion,
  normalizePlannerErrorEnvelope,
  normalizeStudyAgentTurn,
  PLANNER_CONTRACT_VERSION,
  PLANNER_MAX_OUTPUT_TOKENS,
  type PlannerCompletion,
  type PlannerCompletionRequest,
  type PlannerCompletionTask,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  type StudyAgentTurn,
  type StudyAgentTurnRequest,
} from "@hiveforyou/contracts";

import type { PlannerPrompt } from "./prompt-catalog";
import { plannerTaskUsesAsyncJobs, runPlannerAsyncJob, type PlannerAsyncJobOptions } from "./planner-async-jobs";

/** Above the planner's own 150 s LiteLLM timeout and below the 180 s stage lease. */
export const PLANNER_HTTP_TIMEOUT_MS = 160_000;

/** V5 pipeline tasks: 270 s client (30 s margin under the 300 s stage lease and Vercel limit). Planner uses 260 s (D-052). */
export const PLANNER_TASK_HTTP_TIMEOUT_MS: Partial<Record<PlannerCompletionTask, number>> = {
  extract: 270_000,
  canonicalize: 270_000,
  write: 270_000,
};

export type PlannerServiceConfig = {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly timeoutMs: number;
};

export type PlannerDeps = {
  readonly getConfig: () => PlannerServiceConfig;
  readonly fetchFn?: typeof fetch;
};

const UNAVAILABLE_MESSAGE = "The analysis service is temporarily unavailable. You can try again.";

/** Confirmed model-format failures; do not auto-retry the same expensive stage. */
const NON_RETRYABLE_MODEL_OUTPUT_REASONS = new Set([
  "model_output_not_json",
  "model_output_truncated",
  "model_response_contract",
  "model_content_missing",
  "model_output_invalid",
  "model_context_exceeded",
]);

function plannerError(
  input: Omit<HiveError, "stage" | "category"> & { category?: HiveError["category"]; httpStatus?: number | null },
): HiveError {
  const { httpStatus, ...rest } = input;
  const error = createHiveError({ category: "DEPENDENCY", stage: "ANALYZE", ...rest });
  if (typeof httpStatus === "number" && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) {
    Object.defineProperty(error, "httpStatus", {
      value: httpStatus,
      enumerable: false,
      configurable: true,
    });
  }
  return error;
}

export function plannerHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { httpStatus?: unknown }).httpStatus;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function validBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.username || parsed.password || !parsed.hostname) return null;
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) return null;
  return trimmed;
}

export function loadPlannerServiceConfig(
  env: NodeJS.ProcessEnv,
  correlationId: string,
): PlannerServiceConfig {
  const serviceToken = env.PLANNER_SERVICE_TOKEN?.trim() ?? "";
  const baseUrl = validBaseUrl(env.PLANNER_BASE_URL ?? "");
  if (!baseUrl || !serviceToken) {
    throw plannerError({
      errorCode: "MODEL_UNAVAILABLE",
      retryable: false,
      safeMessage: "The analysis service is not configured. Contact support with your reference.",
      correlationId,
      diagnosticReason: "planner_unconfigured",
    });
  }
  return { baseUrl, serviceToken, timeoutMs: PLANNER_HTTP_TIMEOUT_MS };
}

/** Parses planner HTTP bodies; never throws. */
export async function parsePlannerResponseBody(response: Response): Promise<{ raw: unknown; unreadable: boolean }> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { raw: null, unreadable: true };
  }
  const trimmed = text.trim();
  if (!trimmed) return { raw: null, unreadable: true };
  try {
    return { raw: JSON.parse(trimmed) as unknown, unreadable: false };
  } catch {
    return { raw: null, unreadable: true };
  }
}

function modelOutputRetryable(upstream: string | null, envelopeRetryable: boolean): boolean {
  if (upstream && NON_RETRYABLE_MODEL_OUTPUT_REASONS.has(upstream)) return false;
  return envelopeRetryable;
}

function envelopeFromHeaders(headers?: Headers): ReturnType<typeof normalizePlannerErrorEnvelope> {
  if (!headers) return null;
  const errorCode = headers.get("x-planner-error-code")?.trim() ?? "";
  if (!errorCode) return null;
  const retryableHeader = headers.get("x-planner-retryable")?.trim().toLowerCase();
  const diagnosticReason = headers.get("x-planner-diagnostic-reason")?.trim() ?? undefined;
  return normalizePlannerErrorEnvelope({
    error_code: errorCode,
    retryable: retryableHeader === "true",
    ...(diagnosticReason ? { diagnostic_reason: diagnosticReason } : {}),
  });
}

function mapPlannerHttpError(
  status: number,
  raw: unknown,
  unreadable: boolean,
  correlationId: string,
  processingRunId: string,
  headers?: Headers,
): HiveError {
  const envelope = normalizePlannerErrorEnvelope(raw) ?? envelopeFromHeaders(headers);
  const code = envelope?.errorCode ?? "";
  const retryable = envelope ? envelope.retryable : status >= 500;
  const operationId = envelope?.processingRunId ?? processingRunId;
  const upstream = envelope?.diagnosticReason ?? null;
  const withRun = (error: Omit<HiveError, "stage" | "category"> & { category?: HiveError["category"] }) =>
    plannerError({ ...error, operationId, httpStatus: status });

  if (status === 401 || code === "AUTH_FAILED") {
    return withRun({
      errorCode: "MODEL_UNAVAILABLE",
      retryable: false,
      safeMessage: "The analysis service rejected our credentials. Contact support with your reference.",
      correlationId,
      diagnosticReason: upstream ?? "planner_auth_failed",
    });
  }
  if (status === 524) {
    return withRun({
      errorCode: "MODEL_TIMEOUT",
      retryable: true,
      safeMessage: "The analysis model took too long to answer. You can try again.",
      correlationId,
      diagnosticReason: upstream ?? "planner_gateway_timeout",
    });
  }
  if (status === 504 || code === "MODEL_TIMEOUT") {
    return withRun({
      errorCode: "MODEL_TIMEOUT",
      retryable: true,
      safeMessage: "The analysis model took too long to answer. You can try again.",
      correlationId,
      diagnosticReason: upstream ?? "planner_timeout",
    });
  }
  if (code === "MODEL_OUTPUT_INVALID" || code === "MODEL_CONTEXT_EXCEEDED") {
    const diagnosticReason =
      upstream ?? (code === "MODEL_CONTEXT_EXCEEDED" ? "model_context_exceeded" : "model_output_invalid");
    return withRun({
      errorCode: "MODEL_OUTPUT_INVALID",
      category: "MODEL",
      retryable: modelOutputRetryable(diagnosticReason, retryable),
      safeMessage: "The analysis model returned an answer we couldn't use. You can try again.",
      correlationId,
      diagnosticReason,
    });
  }
  if (code === "MODEL_UNAVAILABLE" || code === "DEPENDENCY_UNAVAILABLE") {
    return withRun({
      errorCode: "MODEL_UNAVAILABLE",
      retryable,
      safeMessage: UNAVAILABLE_MESSAGE,
      correlationId,
      diagnosticReason: upstream ?? "planner_unavailable",
    });
  }
  if (unreadable) {
    return withRun({
      errorCode: "MODEL_UNAVAILABLE",
      retryable: status >= 500 || status === 429,
      safeMessage: UNAVAILABLE_MESSAGE,
      correlationId,
      diagnosticReason: "planner_error_body_unparsed",
    });
  }
  return withRun({
    errorCode: "MODEL_UNAVAILABLE",
    retryable,
    safeMessage: UNAVAILABLE_MESSAGE,
    correlationId,
    diagnosticReason: upstream ?? "planner_unavailable",
  });
}

type Exchange = {
  readonly path: "/v1/plan-completion" | "/v1/study-agent-turn";
  readonly body: unknown;
  readonly timeoutMs: number;
  readonly correlationId: string;
  readonly processingRunId: string;
};

/** POSTs one request to the planner and returns the parsed success body; maps every failure to a HiveError. */
async function exchange(deps: PlannerDeps, input: Exchange): Promise<unknown> {
  const config = deps.getConfig();
  let response: Response;
  try {
    response = await (deps.fetchFn ?? fetch)(`${config.baseUrl}${input.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceToken}`,
        "Content-Type": "application/json",
        "x-correlation-id": input.correlationId,
        "x-study-run-id": input.processingRunId,
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw plannerError({
      errorCode: timedOut ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE",
      retryable: true,
      safeMessage: timedOut ? "The analysis model took too long to answer. You can try again." : UNAVAILABLE_MESSAGE,
      correlationId: input.correlationId,
      operationId: input.processingRunId,
      diagnosticReason: timedOut ? "planner_timeout" : "planner_network_error",
      httpStatus: timedOut ? 504 : null,
      cause: error,
    });
  }
  const { raw, unreadable } = await parsePlannerResponseBody(response);
  if (!response.ok) {
    throw mapPlannerHttpError(
      response.status,
      raw,
      unreadable,
      input.correlationId,
      input.processingRunId,
      response.headers,
    );
  }
  return raw;
}

function unexpectedResponse(diagnosticReason: string, correlationId: string, processingRunId: string): HiveError {
  return plannerError({
    errorCode: "MODEL_OUTPUT_INVALID",
    category: "MODEL",
    retryable: !NON_RETRYABLE_MODEL_OUTPUT_REASONS.has(diagnosticReason),
    safeMessage: "The analysis service returned an unexpected response. You can try again.",
    correlationId,
    operationId: processingRunId,
    diagnosticReason,
  });
}

export type PlannerCallResult = PlannerCompletion & { readonly roundTripMs: number };

/** One planning call through the Oracle planner; the planner, not the caller, picks the model. */
export async function callPlanner(
  deps: PlannerDeps,
  input: {
    readonly prompt: PlannerPrompt;
    readonly userPayload: Record<string, unknown>;
    readonly correlationId: string;
    readonly processingRunId: string;
    /** Overrides the per-task HTTP abort. Write passes the time left before the function deadline. */
    readonly timeoutMs?: number;
    readonly asyncJob?: PlannerAsyncJobOptions;
  },
): Promise<PlannerCallResult> {
  if (plannerTaskUsesAsyncJobs(input.prompt.task)) {
    const started = Date.now();
    const resolveRemainingMs =
      input.asyncJob?.resolveRemainingMs ??
      (typeof input.timeoutMs === "number"
        ? () => Math.max(0, input.timeoutMs! - (Date.now() - started))
        : undefined);
    const result = await runPlannerAsyncJob(
      deps,
      {
        prompt: input.prompt,
        userPayload: input.userPayload,
        correlationId: input.correlationId,
        processingRunId: input.processingRunId,
      },
      { ...input.asyncJob, resolveRemainingMs },
    );
    return { ...result.completion, roundTripMs: result.roundTripMs };
  }
  const config = deps.getConfig();
  const body: PlannerCompletionRequest = {
    contract_version: PLANNER_CONTRACT_VERSION,
    task: input.prompt.task,
    prompt_id: input.prompt.id,
    prompt_digest: input.prompt.digest,
    system_prompt: input.prompt.systemPrompt,
    user_payload: input.userPayload,
    max_output_tokens: PLANNER_MAX_OUTPUT_TOKENS[input.prompt.task],
  };
  const started = Date.now();
  const raw = await exchange(deps, {
    path: "/v1/plan-completion",
    body,
    timeoutMs: input.timeoutMs ?? PLANNER_TASK_HTTP_TIMEOUT_MS[input.prompt.task] ?? config.timeoutMs,
    correlationId: input.correlationId,
    processingRunId: input.processingRunId,
  });
  const normalized = normalizePlannerCompletion(raw, input.prompt.task);
  if (!normalized.ok) throw unexpectedResponse(normalized.diagnosticReason, input.correlationId, input.processingRunId);
  return { ...normalized.value, roundTripMs: Date.now() - started };
}

export type StudyAgentTurnResult = StudyAgentTurn & { readonly roundTripMs: number };

/**
 * One Canonical Study or Writer tool-calling turn (D-042, D-045). The planner relays the
 * conversation to the model and returns its tool calls unexecuted; the caller's ledger executes them.
 */
export async function callStudyAgentTurn(
  deps: PlannerDeps,
  input: {
    readonly request: Omit<StudyAgentTurnRequest, "contract_version">;
    /** HTTP abort; set a little above `request.timeout_seconds` so a planner timeout arrives as an envelope. */
    readonly abortMs: number;
    readonly correlationId: string;
    readonly processingRunId: string;
  },
): Promise<StudyAgentTurnResult> {
  const started = Date.now();
  const raw = await exchange(deps, {
    path: "/v1/study-agent-turn",
    body: { contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION, ...input.request } satisfies StudyAgentTurnRequest,
    timeoutMs: input.abortMs,
    correlationId: input.correlationId,
    processingRunId: input.processingRunId,
  });
  const normalized = normalizeStudyAgentTurn(raw);
  if (!normalized.ok) throw unexpectedResponse(normalized.diagnosticReason, input.correlationId, input.processingRunId);
  return { ...normalized.value, roundTripMs: Date.now() - started };
}
