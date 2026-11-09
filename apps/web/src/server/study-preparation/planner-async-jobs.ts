import {
  createHiveError,
  type HiveError,
  normalizePlannerJobPoll,
  normalizePlannerJobSubmit,
  PIPELINE_PLANNER_TASKS,
  PLANNER_CONTRACT_VERSION,
  PLANNER_JOB_CONTRACT_VERSION,
  PLANNER_MAX_OUTPUT_TOKENS,
  type PlannerCompletionRequest,
  type PlannerCompletionTask,
} from "@hiveforyou/contracts";

import type { PlannerPrompt } from "./prompt-catalog";
import { parsePlannerResponseBody, type PlannerDeps } from "./planner-client";

export const PLANNER_JOB_POLL_INTERVAL_MS = 4_000;
export const PLANNER_JOB_POLL_JITTER_MS = 1_000;
export const PLANNER_JOB_SUBMIT_TIMEOUT_MS = 30_000;
export const PLANNER_JOB_POLL_HTTP_TIMEOUT_MS = 15_000;

const ASYNC_JOB_ELIGIBLE_TASKS = new Set<PlannerCompletionTask>(PIPELINE_PLANNER_TASKS);

/** Tasks listed in `PLANNER_ASYNC_JOBS_TASKS` use `POST /v1/jobs`; unset or empty means all sync. */
export function parsePlannerAsyncJobsTasks(env: NodeJS.ProcessEnv = process.env): Set<PlannerCompletionTask> {
  const raw = env.PLANNER_ASYNC_JOBS_TASKS?.trim();
  if (!raw) return new Set();
  const tasks = new Set<PlannerCompletionTask>();
  for (const segment of raw.split(",")) {
    const token = segment.trim().toLowerCase();
    if (!token) continue;
    if (ASYNC_JOB_ELIGIBLE_TASKS.has(token as PlannerCompletionTask)) {
      tasks.add(token as PlannerCompletionTask);
    }
  }
  return tasks;
}

export function plannerTaskUsesAsyncJobs(task: PlannerCompletionTask, env: NodeJS.ProcessEnv = process.env): boolean {
  return parsePlannerAsyncJobsTasks(env).has(task);
}

export class PlannerJobHandoffError extends Error {
  readonly jobId: string;
  readonly task: PlannerCompletionTask;

  constructor(jobId: string, task: PlannerCompletionTask) {
    super("planner_job_handoff");
    this.name = "PlannerJobHandoffError";
    this.jobId = jobId;
    this.task = task;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function pollIntervalMs(): number {
  const jitter = Math.floor(Math.random() * PLANNER_JOB_POLL_JITTER_MS);
  return PLANNER_JOB_POLL_INTERVAL_MS + jitter;
}

function buildJobRequest(prompt: PlannerPrompt, userPayload: Record<string, unknown>): PlannerCompletionRequest {
  return {
    contract_version: PLANNER_CONTRACT_VERSION,
    task: prompt.task,
    prompt_id: prompt.id,
    prompt_digest: prompt.digest,
    system_prompt: prompt.systemPrompt,
    user_payload: userPayload,
    max_output_tokens: PLANNER_MAX_OUTPUT_TOKENS[prompt.task],
  };
}

async function submitJob(
  deps: PlannerDeps,
  body: PlannerCompletionRequest,
  correlationId: string,
  processingRunId: string,
): Promise<string> {
  const config = deps.getConfig();
  const response = await (deps.fetchFn ?? fetch)(`${config.baseUrl}/v1/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.serviceToken}`,
      "Content-Type": "application/json",
      "x-correlation-id": correlationId,
      "x-study-run-id": processingRunId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PLANNER_JOB_SUBMIT_TIMEOUT_MS),
  });
  const { raw, unreadable } = await parsePlannerResponseBody(response);
  if (response.status === 202) {
    const normalized = normalizePlannerJobSubmit(raw);
    if (normalized.ok) return normalized.value.jobId;
  }
  if (!response.ok) {
    throw createHiveError({
      errorCode: "MODEL_UNAVAILABLE",
      category: "DEPENDENCY",
      stage: "ANALYZE",
      retryable: response.status >= 500 || response.status === 429,
      safeMessage: "The analysis service is temporarily unavailable. You can try again.",
      correlationId,
      operationId: processingRunId,
      diagnosticReason: unreadable ? "planner_job_submit_unparsed" : "planner_job_submit_failed",
    });
  }
  throw createHiveError({
    errorCode: "MODEL_OUTPUT_INVALID",
    category: "MODEL",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "The analysis service returned an unexpected response. You can try again.",
    correlationId,
    operationId: processingRunId,
    diagnosticReason: "planner_job_submit_shape",
  });
}

async function pollJobOnce(
  deps: PlannerDeps,
  jobId: string,
  task: PlannerCompletionTask,
  correlationId: string,
  processingRunId: string,
): Promise<
  | { done: true; completion: ReturnType<typeof normalizePlannerJobPoll> & { ok: true } }
  | { done: false }
  | { done: true; failed: HiveError }
  | { lost: true }
> {
  const config = deps.getConfig();
  const response = await (deps.fetchFn ?? fetch)(`${config.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.serviceToken}`,
      "x-correlation-id": correlationId,
      "x-study-run-id": processingRunId,
    },
    signal: AbortSignal.timeout(PLANNER_JOB_POLL_HTTP_TIMEOUT_MS),
  });
  const { raw } = await parsePlannerResponseBody(response);
  if (response.status === 404) return { lost: true };
  if (!response.ok) {
    return {
      done: true,
      failed: createHiveError({
        errorCode: "MODEL_UNAVAILABLE",
        category: "DEPENDENCY",
        stage: "ANALYZE",
        retryable: true,
        safeMessage: "The analysis service is temporarily unavailable. You can try again.",
        correlationId,
        operationId: processingRunId,
        diagnosticReason: "planner_job_poll_failed",
      }),
    };
  }
  const normalized = normalizePlannerJobPoll(raw, task);
  if (!normalized.ok) {
    return {
      done: true,
      failed: createHiveError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        stage: "ANALYZE",
        retryable: true,
        safeMessage: "The analysis service returned an unexpected response. You can try again.",
        correlationId,
        operationId: processingRunId,
        diagnosticReason: normalized.diagnosticReason,
      }),
    };
  }
  if (normalized.value.status === "queued" || normalized.value.status === "running") return { done: false };
  if (normalized.value.jobError) {
    const code = normalized.value.jobError.errorCode;
    const mapped =
      code === "MODEL_TIMEOUT"
        ? "MODEL_TIMEOUT"
        : code === "MODEL_OUTPUT_INVALID" || code === "MODEL_CONTEXT_EXCEEDED"
          ? "MODEL_OUTPUT_INVALID"
          : "MODEL_UNAVAILABLE";
    return {
      done: true,
      failed: createHiveError({
        errorCode: mapped,
        category: mapped === "MODEL_OUTPUT_INVALID" ? "MODEL" : "DEPENDENCY",
        stage: "ANALYZE",
        retryable: normalized.value.jobError.retryable,
        safeMessage: "The analysis model took too long to answer. You can try again.",
        correlationId,
        operationId: processingRunId,
        diagnosticReason: normalized.value.jobError.diagnosticReason ?? "planner_job_failed",
      }),
    };
  }
  if (normalized.value.completion) {
    return { done: true, completion: { ok: true, value: normalized.value } as const };
  }
  return { done: false };
}

export type PlannerAsyncJobOptions = {
  readonly resumeJobId?: string | null;
  readonly lostJobRetried?: boolean;
  readonly resolveRemainingMs?: () => number | "expired";
  readonly onJobSubmitted?: (jobId: string) => Promise<void>;
};

/** Submit (or resume) an async planner job and poll until completion, hand-off, or failure. */
export async function runPlannerAsyncJob(
  deps: PlannerDeps,
  input: {
    readonly prompt: PlannerPrompt;
    readonly userPayload: Record<string, unknown>;
    readonly correlationId: string;
    readonly processingRunId: string;
  },
  options: PlannerAsyncJobOptions = {},
): Promise<{ completion: import("@hiveforyou/contracts").PlannerCompletion; roundTripMs: number; jobId: string }> {
  const started = Date.now();
  const task = input.prompt.task;
  let jobId = options.resumeJobId?.trim() || "";
  if (!jobId) {
    jobId = await submitJob(deps, buildJobRequest(input.prompt, input.userPayload), input.correlationId, input.processingRunId);
    if (options.onJobSubmitted) await options.onJobSubmitted(jobId);
  }

  for (;;) {
    const remaining = options.resolveRemainingMs?.();
    if (remaining === "expired") throw new PlannerJobHandoffError(jobId, task);
    if (typeof remaining === "number" && remaining <= 0) throw new PlannerJobHandoffError(jobId, task);

    const polled = await pollJobOnce(deps, jobId, task, input.correlationId, input.processingRunId);
    if ("lost" in polled && polled.lost) {
      if (options.lostJobRetried) {
        throw createHiveError({
          errorCode: "MODEL_UNAVAILABLE",
          category: "DEPENDENCY",
          stage: "ANALYZE",
          retryable: true,
          safeMessage: "The analysis service lost a running job. You can try again.",
          correlationId: input.correlationId,
          operationId: input.processingRunId,
          diagnosticReason: "planner_job_lost",
        });
      }
      return runPlannerAsyncJob(deps, input, { ...options, resumeJobId: null, lostJobRetried: true });
    }
    if ("done" in polled && polled.done) {
      if ("failed" in polled && polled.failed) throw polled.failed;
      if ("completion" in polled && polled.completion.ok && polled.completion.value.completion) {
        const value = polled.completion.value;
        return {
          completion: value.completion!,
          roundTripMs: Date.now() - started,
          jobId,
        };
      }
    }
    await sleep(pollIntervalMs());
  }
}
