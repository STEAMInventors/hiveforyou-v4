import { createHiveError, type HiveError } from "@hiveforyou/contracts";

import { PlannerJobHandoffError, type PlannerAsyncJobOptions } from "@/server/study-preparation/planner-async-jobs";
import { callPlanner, type PlannerDeps } from "@/server/study-preparation/planner-client";
import { type PlannerPrompt } from "@/server/study-preparation/prompt-catalog";

/** Planner failures that mean the model answered but the answer was not a usable JSON object. */
const UNPARSEABLE_REASONS = new Set(["model_output_not_json", "model_output_invalid", "model_content_missing"]);

export type PlannerCompletionCaller = {
  readonly planner: PlannerDeps;
  readonly correlationId: string;
  readonly runId: string;
  readonly resolvePlannerTimeoutMs?: () => number | "expired";
  readonly asyncJob?: PlannerAsyncJobOptions;
};

export type PlannerCompletionCallRecord<Purpose extends string = string> = {
  readonly purpose: Purpose;
  readonly attempt: 1 | 2;
  readonly outcome: "ok" | "unparseable" | "failed";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Model latency reported by the planner. */
  readonly latencyMs: number | null;
  readonly roundTripMs: number;
  readonly finishReason: string | null;
  readonly resolvedModel: string | null;
  readonly errorCode: string | null;
  readonly diagnosticReason: string | null;
};

const RETRY_NOTE = (reason: string) =>
  `Your previous answer could not be used (${reason}). Return only the JSON object described in the instructions, with no text before or after it.`;

function asHiveError(error: unknown): HiveError | null {
  return error && typeof error === "object" && "errorCode" in error && "stage" in error ? (error as HiveError) : null;
}

/**
 * One planner completion with the canonicalize retry rule: an answer that is not usable JSON is retried
 * once with the reason added to the payload; any other planner failure, or a second unusable answer, fails.
 */
export async function callPlannerCompletionWithRetry<T, Purpose extends string>(
  input: PlannerCompletionCaller & { prompt: PlannerPrompt; purpose: Purpose; payload: Record<string, unknown> },
  parse: (content: unknown) => { ok: true; value: T } | { ok: false; reason: string; message: string },
  calls: PlannerCompletionCallRecord<Purpose>[],
): Promise<{ ok: true; value: T } | { ok: false; error: HiveError }> {
  let parseError: string | null = null;
  let parseCode: string | null = null;
  for (const attempt of [1, 2] as const) {
    const started = Date.now();
    const userPayload = parseError === null ? input.payload : { ...input.payload, retryNote: RETRY_NOTE(parseError) };
    try {
      const timeoutMs = input.resolvePlannerTimeoutMs?.();
      if (timeoutMs === "expired") {
        return {
          ok: false,
          error: createHiveError({
            errorCode: "MODEL_TIMEOUT",
            category: "DEPENDENCY",
            stage: "ANALYZE",
            retryable: true,
            safeMessage: "The analysis model took too long to answer. You can try again.",
            correlationId: input.correlationId,
            operationId: input.runId,
            diagnosticReason: "planner_timeout",
          }),
        };
      }
      const completion = await callPlanner(input.planner, {
        prompt: input.prompt,
        userPayload,
        correlationId: input.correlationId,
        processingRunId: input.runId,
        ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
        asyncJob: {
          ...input.asyncJob,
          resolveRemainingMs: () => {
            const remaining = input.resolvePlannerTimeoutMs?.();
            if (remaining === "expired") return "expired";
            if (typeof remaining === "number") return remaining;
            return Number.POSITIVE_INFINITY;
          },
        },
      });
      const parsed = parse(completion.contentJson);
      calls.push({
        purpose: input.purpose,
        attempt,
        outcome: parsed.ok ? "ok" : "unparseable",
        inputTokens: completion.usage.promptTokens,
        outputTokens: completion.usage.completionTokens,
        latencyMs: completion.latencyMs,
        roundTripMs: completion.roundTripMs,
        finishReason: completion.finishReason,
        resolvedModel: completion.resolvedModel,
        errorCode: null,
        diagnosticReason: parsed.ok ? null : parsed.reason,
      });
      if (parsed.ok) return parsed;
      parseError = parsed.message;
      parseCode = parsed.reason;
    } catch (error) {
      if (error instanceof PlannerJobHandoffError) throw error;
      const hiveError = asHiveError(error);
      if (!hiveError) throw error;
      const unparseable = hiveError.errorCode === "MODEL_OUTPUT_INVALID" && UNPARSEABLE_REASONS.has(hiveError.diagnosticReason ?? "");
      calls.push({
        purpose: input.purpose,
        attempt,
        outcome: unparseable ? "unparseable" : "failed",
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        roundTripMs: Date.now() - started,
        finishReason: null,
        resolvedModel: null,
        errorCode: hiveError.errorCode,
        diagnosticReason: hiveError.diagnosticReason ?? null,
      });
      if (!unparseable) return { ok: false, error: hiveError };
      parseError = hiveError.diagnosticReason!;
      parseCode = hiveError.diagnosticReason!;
    }
  }
  return {
    ok: false,
    error: createHiveError({
      errorCode: "MODEL_OUTPUT_INVALID",
      category: "MODEL",
      stage: "MERGE",
      retryable: false,
      safeMessage: "The model returned an answer we couldn't use.",
      correlationId: input.correlationId,
      operationId: input.runId,
      diagnosticReason:
        input.purpose === "pack-guided" && parseCode !== null && /^[a-z][a-z0-9_]{0,63}$/.test(parseCode)
          ? parseCode
          : `${input.purpose}_unparseable_after_retry`,
    }),
  };
}
