import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServer = vi.hoisted(() => ({ after: vi.fn() }));
const auth = vi.hoisted(() => ({ requireApiSupabaseClient: vi.fn() }));
const preparation = vi.hoisted(() => ({ acknowledgeStudyCoverage: vi.fn() }));
const planner = vi.hoisted(() => ({ loadPlannerServiceConfig: vi.fn() }));
const workflow = vi.hoisted(() => ({ processAnalysisRunSafely: vi.fn(async () => undefined) }));
const worker = vi.hoisted(() => ({
  createWorkerDeps: vi.fn(() => ({ kind: "worker-deps" })),
  requireWorkerDispatch: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: nextServer.after,
}));
vi.mock("@/server/supabase/server-client", () => auth);
vi.mock("@/server/study-preparation/study-preparation", () => preparation);
vi.mock("@/server/study-preparation/planner-client", () => planner);
vi.mock("@/server/workflow/analysis-workflow", () => workflow);
vi.mock("@/server/workflow/worker", () => worker);

import { POST } from "./route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const DIGEST = `sha256:${"f".repeat(64)}`;
const URL = `http://localhost/api/v1/hives/${HIVE_ID}/study-preparation/acknowledge`;
const params = { params: Promise.resolve({ hiveId: HIVE_ID }) };

function post(body: unknown): NextRequest {
  return new NextRequest(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
    body: JSON.stringify(body),
  });
}

function hiveError(errorCode: "UNAUTHENTICATED" | "INVALID_REQUEST" | "MODEL_UNAVAILABLE") {
  return createHiveError({
    errorCode,
    category: errorCode === "MODEL_UNAVAILABLE" ? "DEPENDENCY" : errorCode === "INVALID_REQUEST" ? "VALIDATION" : "SECURITY",
    stage: "ANALYZE",
    retryable: false,
    safeMessage: "Synthetic failure.",
    correlationId: CORRELATION_ID,
  });
}

describe("/api/v1/hives/[hiveId]/study-preparation/acknowledge", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    auth.requireApiSupabaseClient.mockResolvedValue({ kind: "user" });
    planner.loadPlannerServiceConfig.mockReturnValue({ baseUrl: "https://reader.test/planner", serviceToken: "s", timeoutMs: 1 });
    worker.requireWorkerDispatch.mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("returns 401 when signed out", async () => {
    auth.requireApiSupabaseClient.mockRejectedValue(hiveError("UNAUTHENTICATED"));
    const res = await POST(post({ processingRunId: RUN_ID, coverageDigest: DIGEST }), params);
    expect(res.status).toBe(401);
    expect(preparation.acknowledgeStudyCoverage).not.toHaveBeenCalled();
  });

  it("does not acknowledge when stages cannot be handed off", async () => {
    worker.requireWorkerDispatch.mockImplementation(() => {
      throw hiveError("MODEL_UNAVAILABLE");
    });
    const res = await POST(post({ processingRunId: RUN_ID, coverageDigest: DIGEST }), params);
    expect(res.status).toBe(503);
    expect(preparation.acknowledgeStudyCoverage).not.toHaveBeenCalled();
  });

  it("continues the resumed run after the response", async () => {
    preparation.acknowledgeStudyCoverage.mockResolvedValue({
      response: { processingRun: { id: RUN_ID, status: "UNDERSTANDING_REQUEST" }, resumed: true },
      process: true,
    });
    const res = await POST(post({ processingRunId: RUN_ID, coverageDigest: DIGEST }), params);
    expect(res.status).toBe(202);
    expect(nextServer.after).toHaveBeenCalledTimes(1);
    await nextServer.after.mock.calls[0]![0]();
    expect(workflow.processAnalysisRunSafely).toHaveBeenCalledWith({ kind: "worker-deps" }, RUN_ID);
  });

  it("schedules nothing for a replayed acknowledgement", async () => {
    preparation.acknowledgeStudyCoverage.mockResolvedValue({
      response: { processingRun: { id: RUN_ID, status: "INVESTIGATING" }, resumed: false },
      process: false,
    });
    const res = await POST(post({ processingRunId: RUN_ID, coverageDigest: DIGEST }), params);
    expect(res.status).toBe(202);
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it("surfaces a run that is no longer waiting without scheduling work", async () => {
    preparation.acknowledgeStudyCoverage.mockRejectedValue(hiveError("INVALID_REQUEST"));
    const res = await POST(post({ processingRunId: RUN_ID, coverageDigest: DIGEST }), params);
    expect(res.status).toBe(422);
    expect(nextServer.after).not.toHaveBeenCalled();
  });
});
