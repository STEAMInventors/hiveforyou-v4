import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServer = vi.hoisted(() => ({ after: vi.fn((fn: () => void | Promise<void>) => fn()) }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: nextServer.after,
}));

import { createWorkflowDispatch, scheduleWorkflowContinuation, type WorkItem } from "./dispatch";

const TOKEN = "synthetic-worker-token-0123456789abcdef";
const ITEM: WorkItem = { kind: "analysis", id: "22222222-2222-4222-8222-222222222222" };

describe("scheduleWorkflowContinuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the HTTP dispatch after the requested delay", async () => {
    const http = vi.fn(async () => true);
    const fallback = vi.fn(async () => undefined);
    scheduleWorkflowContinuation(http, fallback, ITEM, "corr-1", 2);
    expect(http).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(http).toHaveBeenCalledWith(ITEM, "corr-1");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back in-process when the HTTP dispatch fails", async () => {
    const http = vi.fn(async () => false);
    const fallback = vi.fn(async () => undefined);
    scheduleWorkflowContinuation(http, fallback, ITEM, "corr-2", 0);
    await Promise.resolve();
    expect(fallback).toHaveBeenCalledWith(ITEM);
  });

  it("does not run fallback when the HTTP dispatch is accepted", async () => {
    const http = vi.fn(async () => true);
    const fallback = vi.fn(async () => undefined);
    scheduleWorkflowContinuation(http, fallback, ITEM, "corr-2b", 0);
    await Promise.resolve();
    expect(http).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe("createWorkflowDispatch", () => {
  it("schedules through after() instead of blocking the caller", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }));
    const fallback = vi.fn(async () => undefined);
    const dispatch = createWorkflowDispatch({ token: TOKEN, origin: "https://app.example.test", fetchFn, fallback });
    await expect(dispatch(ITEM, "corr-3")).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses fallback when createHttpDispatch has no token", async () => {
    const fallback = vi.fn(async () => undefined);
    const dispatch = createWorkflowDispatch({ token: null, origin: "https://app.example.test", fallback });
    await dispatch(ITEM, "corr-4");
    expect(fallback).toHaveBeenCalledWith(ITEM);
  });
});
