import {
  createHiveError,
  type HiveError,
  normalizePlannerCompletion,
  normalizePlannerErrorEnvelope,
  PLANNER_CONTRACT_VERSION,
  PLANNER_MAX_OUTPUT_TOKENS,
  type PlannerCompletion,
  type PlannerCompletionRequest,
} from "@hiveforyou/contracts";

import type { PlannerPrompt } from "./prompt-catalog";

/** Above the planner's own 150 s LiteLLM timeout and below the 180 s stage lease. */
export const PLANNER_HTTP_TIMEOUT_MS = 160_000;
/**
 * Study and Writer calls: above the planner's 270 s model timeout and below the 300 s Vercel
 * function limit, so a planner timeout arrives as MODEL_TIMEOUT rather than a killed function.
 */
export const PLANNER_LONG_HTTP_TIMEOUT_MS = 280_000;

export type PlannerServiceConfig = {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly timeoutMs: number;
  readonly longTimeoutMs?: number;
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
  input: Omit<HiveError, "stage" | "category"> & { category?: HiveError["category"] },
): HiveError {
  return createHiveError({ category: "DEPENDENCY", stage: "ANALYZE", ...input });
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
  return { baseUrl, serviceToken, timeoutMs: PLANNER_HTTP_TIMEOUT_MS, longTimeoutMs: PLANNER_LONG_HTTP_TIMEOUT_MS };
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

function mapPlannerHttpError(
  status: number,
  raw: unknown,
  unreadable: boolean,
  correlationId: string,
  processingRunId: string,
): HiveError {
  const envelope = normalizePlannerErrorEnvelope(raw);
  const code = envelope?.errorCode ?? "";
  const retryable = envelope ? envelope.retryable : status >= 500;
  const operationId = envelope?.processingRunId ?? processingRunId;
  const upstream = envelope?.diagnosticReason ?? null;
  const withRun = (error: Omit<HiveError, "stage" | "category"> & { category?: HiveError["category"] }) =>
    plannerError({ ...error, operationId });

  if (status === 401 || code === "AUTH_FAILED") {
    return withRun({
      errorCode: "MODEL_UNAVAILABLE",
      retryable: false,
      safeMessage: "The analysis service rejected our credentials. Contact support with your reference.",
      correlationId,
      diagnosticReason: upstream ?? "planner_auth_failed",
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

export type PlannerCallResult = PlannerCompletion & { readonly roundTripMs: number };

/** One planning call through the Oracle planner; the planner, not the caller, picks the model. */
export async function callPlanner(
  deps: PlannerDeps,
  input: {
    readonly prompt: PlannerPrompt;
    readonly userPayload: Record<string, unknown>;
    readonly correlationId: string;
    readonly processingRunId: string;
  },
): Promise<PlannerCallResult> {
  const { correlationId } = input;
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
  let response: Response;
  try {
    response = await (deps.fetchFn ?? fetch)(`${config.baseUrl}/v1/plan-completion`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceToken}`,
        "Content-Type": "application/json",
        "x-correlation-id": correlationId,
        "x-study-run-id": input.processingRunId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        input.prompt.task === "study" || input.prompt.task === "writer"
          ? (config.longTimeoutMs ?? PLANNER_LONG_HTTP_TIMEOUT_MS)
          : config.timeoutMs,
      ),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw plannerError({
      errorCode: timedOut ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE",
      retryable: true,
      safeMessage: timedOut ? "The analysis model took too long to answer. You can try again." : UNAVAILABLE_MESSAGE,
      correlationId,
      operationId: input.processingRunId,
      diagnosticReason: timedOut ? "planner_timeout" : "planner_network_error",
      cause: error,
    });
  }

  const { raw, unreadable } = await parsePlannerResponseBody(response);
  if (!response.ok) {
    throw mapPlannerHttpError(response.status, raw, unreadable, correlationId, input.processingRunId);
  }
  const normalized = normalizePlannerCompletion(raw, input.prompt.task);
  if (!normalized.ok) {
    throw plannerError({
      errorCode: "MODEL_OUTPUT_INVALID",
      category: "MODEL",
      retryable: !NON_RETRYABLE_MODEL_OUTPUT_REASONS.has(normalized.diagnosticReason),
      safeMessage: "The analysis service returned an unexpected response. You can try again.",
      correlationId,
      operationId: input.processingRunId,
      diagnosticReason: normalized.diagnosticReason,
    });
  }
  return { ...normalized.value, roundTripMs: Date.now() - started };
}
