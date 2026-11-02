import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServer = vi.hoisted(() => ({ after: vi.fn() }));
const worker = vi.hoisted(() => ({
  createWorkerDeps: vi.fn(() => ({ kind: "worker-deps" })),
  runWorkItem: vi.fn(async () => undefined),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: nextServer.after,
}));
vi.mock("@/server/workflow/worker", () => worker);

import { POST } from "./route";

const TOKEN = "synthetic-worker-token-0123456789abcdef";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function post(body: unknown, authorization?: string): NextRequest {
  return new NextRequest("https://app.example.test/api/internal/workflow", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  });
}

describe("/api/internal/workflow", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const original = process.env.HIVE_INTERNAL_WORKER_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.HIVE_INTERNAL_WORKER_TOKEN = TOKEN;
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (original === undefined) delete process.env.HIVE_INTERNAL_WORKER_TOKEN;
    else process.env.HIVE_INTERNAL_WORKER_TOKEN = original;
  });

  it("refuses every request when the worker token is not configured", async () => {
    delete process.env.HIVE_INTERNAL_WORKER_TOKEN;
    const res = await POST(post({ kind: "analysis", id: RUN_ID }, `Bearer ${TOKEN}`));
    expect(res.status).toBe(401);
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong-token-wrong-token-wrong-token", TOKEN])("rejects authorization %s", async (authorization) => {
    const res = await POST(post({ kind: "analysis", id: RUN_ID }, authorization));
    expect(res.status).toBe(401);
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it("rejects unknown work items", async () => {
    const res = await POST(post({ kind: "study", id: RUN_ID }, `Bearer ${TOKEN}`));
    expect(res.status).toBe(422);
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it("accepts a valid item with 202 and runs it after the response", async () => {
    const res = await POST(post({ kind: "report", id: RUN_ID }, `Bearer ${TOKEN}`));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
    expect(worker.runWorkItem).not.toHaveBeenCalled();
    await nextServer.after.mock.calls[0]![0]();
    expect(worker.runWorkItem).toHaveBeenCalledWith({ kind: "worker-deps" }, { kind: "report", id: RUN_ID });
  });
});
