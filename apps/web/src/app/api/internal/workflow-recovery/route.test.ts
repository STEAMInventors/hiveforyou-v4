import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sweep = vi.hoisted(() => vi.fn());
const worker = vi.hoisted(() => ({
  createWorkerDeps: vi.fn(() => ({
    client: { rpc: vi.fn() },
    dispatch: vi.fn(async () => true),
  })),
}));

vi.mock("@/server/workflow/workflow-recovery-sweep", () => ({ sweepWorkflowRecovery: sweep }));
vi.mock("@/server/workflow/worker", () => worker);

import { GET } from "./route";

const CRON = "cron-secret-0123456789abcdef";
const WORKER = "synthetic-worker-token-0123456789abcdef";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function getRequest(authorization?: string): NextRequest {
  return new NextRequest("https://app.example.test/api/internal/workflow-recovery", {
    method: "GET",
    headers: authorization ? { authorization } : {},
  });
}

describe("/api/internal/workflow-recovery", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalCron = process.env.CRON_SECRET;
  const originalWorker = process.env.HIVE_INTERNAL_WORKER_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.CRON_SECRET = CRON;
    process.env.HIVE_INTERNAL_WORKER_TOKEN = WORKER;
    sweep.mockResolvedValue({
      hivesScanned: 1,
      hiveIds: ["11111111-1111-4111-8111-111111111111"],
      revived: [{ kind: "analysis", id: RUN_ID }],
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCron;
    if (originalWorker === undefined) delete process.env.HIVE_INTERNAL_WORKER_TOKEN;
    else process.env.HIVE_INTERNAL_WORKER_TOKEN = originalWorker;
  });

  it("refuses when neither cron nor worker token is configured", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.HIVE_INTERNAL_WORKER_TOKEN;
    const res = await GET(getRequest(`Bearer ${CRON}`));
    expect(res.status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it("rejects unauthorized cron calls", async () => {
    const res = await GET(getRequest("Bearer wrong-secret-value-here"));
    expect(res.status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it("runs the sweeper with CRON_SECRET and returns revived ids", async () => {
    const res = await GET(getRequest(`Bearer ${CRON}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      hivesScanned: 1,
      dispatchCount: 1,
      revived: [{ kind: "analysis", id: RUN_ID }],
    });
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(worker.createWorkerDeps).toHaveBeenCalled();
  });
});
