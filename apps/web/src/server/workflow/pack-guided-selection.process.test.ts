import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PACK_GUIDED_STUDY_ENGINE_ID, markPackGuidedRebuild } from "./pack-guided-selection";
import { commitPackGuidedEngineBeforeHandoff, persistPackGuidedEngineMarker } from "./v5-pipeline-stages";

const require = createRequire(import.meta.url);
const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const RUN_ID = "33333333-3333-4333-8333-333333333333";

const checkpoint = {
  schema: "hive.investigation-window-progress/1",
  planDigest: "a".repeat(64),
  intentDigest: "b".repeat(64),
  windows: [{ windowId: "window-customer", status: "complete", executable: true }],
};

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;

function memoryClient(): { rpc: Rpc; stageOutputs: Record<string, unknown>; statuses: string[]; failed: boolean } {
  const stageOutputs: Record<string, unknown> = {};
  const statuses: string[] = [];
  const state = { failed: false };
  const rpc: Rpc = async (fn, args = {}) => {
    if (fn === "patch_processing_run_workflow_state") {
      statuses.push(String(args.p_expected_status));
      if (args.p_patch && typeof args.p_patch === "object") Object.assign(stageOutputs, args.p_patch as object);
      return { data: { applied: true }, error: null };
    }
    if (fn === "transition_processing_run") {
      state.failed = args.p_to_status === "FAILED";
      return { data: { applied: true }, error: null };
    }
    return { data: null, error: null };
  };
  return { rpc, stageOutputs, statuses, get failed() { return state.failed; } };
}

function runWorkerProcess(outputs: unknown): Promise<{ status: number | null; stderr: string }> {
  const vitest = require.resolve("vitest/vitest.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      vitest,
      "run",
      "src/server/workflow/pack-guided-selection.isolate.test.ts",
      "--pool=forks",
    ], {
      cwd: webRoot,
      env: {
        ...process.env,
        PACK_GUIDED_ISOLATE: "1",
        PACK_GUIDED_RUN_ID: RUN_ID,
        PACK_GUIDED_OUTPUTS: JSON.stringify(outputs),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

describe("pack-guided selection across processes", () => {
  it("keeps the persisted engine and window checkpoint for a worker that never saw the request", async () => {
    markPackGuidedRebuild(RUN_ID);
    const client = memoryClient();
    await persistPackGuidedEngineMarker(client as never, RUN_ID, {
      expectedStatus: "QUEUED",
      correlationId: "corr",
      hiveId: "hive",
    });
    expect(client.statuses).toEqual(["QUEUED"]);
    expect(client.stageOutputs.domainPack).toEqual({ engine: PACK_GUIDED_STUDY_ENGINE_ID });
    await persistPackGuidedEngineMarker(client as never, RUN_ID, {
      expectedStatus: "CANONICALIZING",
      investigationWindows: checkpoint,
    });
    await persistPackGuidedEngineMarker(client as never, RUN_ID, {
      expectedStatus: "CANONICALIZING",
      current: client.stageOutputs.domainPack as { engine: typeof PACK_GUIDED_STUDY_ENGINE_ID; investigationWindows?: unknown },
    });
    expect(client.stageOutputs.domainPack).toEqual({
      engine: PACK_GUIDED_STUDY_ENGINE_ID,
      investigationWindows: checkpoint,
    });

    const worker = await runWorkerProcess({ domainPack: client.stageOutputs.domainPack });
    expect(worker.status, worker.stderr).toBe(0);
  }, 120_000);

  it("fails the queued run when the engine cannot be stored, and names the engine", async () => {
    const calls: string[] = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown> = {}) => {
        calls.push(`${fn}:${String(args.p_expected_status ?? args.p_to_status ?? "")}`);
        if (fn === "patch_processing_run_workflow_state") return { data: { applied: false }, error: null };
        return { data: { applied: true }, error: null };
      },
    };
    const rejected = commitPackGuidedEngineBeforeHandoff(client as never, {
      runId: RUN_ID,
      correlationId: "corr-pack",
      hiveId: "hive",
    });
    await expect(rejected).rejects.toMatchObject({
      errorCode: "PERSISTENCE_FAILED",
      safeMessage: expect.stringContaining("pack version unknown, stage QUEUED, 0 of 0 windows complete"),
    });
    await expect(rejected).rejects.toMatchObject({
      safeMessage: expect.stringContaining(PACK_GUIDED_STUDY_ENGINE_ID),
    });
    expect(calls).toContain("patch_processing_run_workflow_state:QUEUED");
    expect(calls).toContain("transition_processing_run:FAILED");
  });
});
