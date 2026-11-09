import { PLANNER_CONTRACT_VERSION, PLANNER_JOB_CONTRACT_VERSION } from "@hiveforyou/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parsePlannerAsyncJobsTasks, plannerTaskUsesAsyncJobs, runPlannerAsyncJob } from "./planner-async-jobs";
import type { PlannerDeps } from "./planner-client";

const DIGEST = "sha256:" + "a".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parsePlannerAsyncJobsTasks", () => {
  it("returns empty when unset or blank", () => {
    expect(parsePlannerAsyncJobsTasks({})).toEqual(new Set());
    expect(parsePlannerAsyncJobsTasks({ PLANNER_ASYNC_JOBS_TASKS: "   " })).toEqual(new Set());
    expect(plannerTaskUsesAsyncJobs("extract", {})).toBe(false);
    expect(plannerTaskUsesAsyncJobs("canonicalize", {})).toBe(false);
  });

  it("enables only listed pipeline tasks", () => {
    const env = { PLANNER_ASYNC_JOBS_TASKS: "canonicalize" };
    expect(parsePlannerAsyncJobsTasks(env)).toEqual(new Set(["canonicalize"]));
    expect(plannerTaskUsesAsyncJobs("canonicalize", env)).toBe(true);
    expect(plannerTaskUsesAsyncJobs("extract", env)).toBe(false);
    expect(plannerTaskUsesAsyncJobs("write", env)).toBe(false);
  });

  it("parses comma-separated tokens with trimming and ignores unknown names", () => {
    const env = { PLANNER_ASYNC_JOBS_TASKS: " write , canonicalize , study , ,intent" };
    expect(parsePlannerAsyncJobsTasks(env)).toEqual(new Set(["write", "canonicalize"]));
    expect(plannerTaskUsesAsyncJobs("write", env)).toBe(true);
    expect(plannerTaskUsesAsyncJobs("study", env)).toBe(false);
  });
});

describe("runPlannerAsyncJob", () => {
  it("submits, polls until succeeded, and returns the completion", async () => {
    vi.useFakeTimers();
    const completion = {
      contract_version: PLANNER_CONTRACT_VERSION,
      task: "extract",
      model_alias: "harvester",
      resolved_model: "model-x",
      content_json: { ok: true },
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      latency_ms: 1200,
      finish_reason: "stop",
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ contract_version: PLANNER_JOB_CONTRACT_VERSION, job_id: "job-1" }), { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            contract_version: PLANNER_JOB_CONTRACT_VERSION,
            job_id: "job-1",
            status: "running",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            contract_version: PLANNER_JOB_CONTRACT_VERSION,
            job_id: "job-1",
            status: "succeeded",
            result: completion,
            latency_ms: 1200,
          }),
          { status: 200 },
        ),
      );
    const deps: PlannerDeps = {
      getConfig: () => ({ baseUrl: "https://planner.test", serviceToken: "t", timeoutMs: 1000 }),
      fetchFn: fetchFn as unknown as typeof fetch,
    };
    const resultPromise = runPlannerAsyncJob(
      deps,
      {
        prompt: {
          id: "hive-extract/1",
          digest: DIGEST,
          task: "extract",
          systemPrompt: "Extract.",
          userTemplate: "{{message}}",
        },
        userPayload: { message: "hi" },
        correlationId: "c",
        processingRunId: "r",
      },
      { resolveRemainingMs: () => 60_000 },
    );
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.completion.contentJson).toEqual({ ok: true });
    expect(result.jobId).toBe("job-1");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("resumes polling an existing job id without a second submit", async () => {
    const completion = {
      contract_version: PLANNER_CONTRACT_VERSION,
      task: "canonicalize",
      model_alias: "heavy_lifter",
      resolved_model: "model-x",
      content_json: { spine: [] },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      latency_ms: 900,
      finish_reason: "stop",
    };
    const fetchFn = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          contract_version: PLANNER_JOB_CONTRACT_VERSION,
          job_id: "job-resume",
          status: "succeeded",
          result: { ...completion, task: "canonicalize" },
          latency_ms: 900,
        }),
        { status: 200 },
      ),
    );
    const deps: PlannerDeps = {
      getConfig: () => ({ baseUrl: "https://planner.test", serviceToken: "t", timeoutMs: 1000 }),
      fetchFn: fetchFn as unknown as typeof fetch,
    };
    await runPlannerAsyncJob(
      deps,
      {
        prompt: {
          id: "hive-canonicalize/1",
          digest: DIGEST,
          task: "canonicalize",
          systemPrompt: "Canon.",
          userTemplate: "{{message}}",
        },
        userPayload: { message: "hi" },
        correlationId: "c",
        processingRunId: "r",
      },
      { resumeJobId: "job-resume", resolveRemainingMs: () => 60_000 },
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/v1/jobs/job-resume");
  });
});
