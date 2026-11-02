import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServer = vi.hoisted(() => ({ after: vi.fn() }));
const auth = vi.hoisted(() => ({ requireApiSupabaseClient: vi.fn() }));
const preparation = vi.hoisted(() => ({ getStudyPreparation: vi.fn(), startStudyPreparation: vi.fn() }));
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

import { GET, POST } from "./route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const URL = `http://localhost/api/v1/hives/${HIVE_ID}/study-preparation`;
const params = { params: Promise.resolve({ hiveId: HIVE_ID }) };
const userClient = { kind: "user" };

function post(body: unknown): NextRequest {
  return new NextRequest(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
    body: JSON.stringify(body),
  });
}

function get(query = ""): NextRequest {
  return new NextRequest(`${URL}${query}`, { headers: { "x-correlation-id": CORRELATION_ID } });
}

function hiveError(errorCode: "UNAUTHENTICATED" | "COVERAGE_INCOMPLETE" | "MODEL_UNAVAILABLE") {
  return createHiveError({
    errorCode,
    category: errorCode === "MODEL_UNAVAILABLE" ? "DEPENDENCY" : "SECURITY",
    stage: "ANALYZE",
    retryable: false,
    safeMessage: "Synthetic failure.",
    correlationId: CORRELATION_ID,
  });
}

describe("/api/v1/hives/[hiveId]/study-preparation", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    auth.requireApiSupabaseClient.mockResolvedValue(userClient);
    planner.loadPlannerServiceConfig.mockReturnValue({ baseUrl: "https://reader.test/planner", serviceToken: "s", timeoutMs: 1 });
    worker.requireWorkerDispatch.mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("GET returns 401 when signed out", async () => {
    auth.requireApiSupabaseClient.mockRejectedValue(hiveError("UNAUTHENTICATED"));
    const res = await GET(get(), params);
    expect(res.status).toBe(401);
    expect(preparation.getStudyPreparation).not.toHaveBeenCalled();
  });

  it("GET includes the full preview only when asked", async () => {
    preparation.getStudyPreparation.mockResolvedValue({ processingRun: null });
    await GET(get(), params);
    await GET(get("?preview=1"), params);
    expect(preparation.getStudyPreparation.mock.calls.map(([, input]) => input.includePreview)).toEqual([false, true]);
  });

  it("POST fails before starting a run when the planner is not configured", async () => {
    planner.loadPlannerServiceConfig.mockImplementation(() => {
      throw hiveError("MODEL_UNAVAILABLE");
    });
    const res = await POST(post({ clientRequestId: REQUEST_ID }), params);
    expect(res.status).toBe(503);
    expect(preparation.startStudyPreparation).not.toHaveBeenCalled();
  });

  it("POST fails before starting a run when stages cannot be handed off", async () => {
    worker.requireWorkerDispatch.mockImplementation(() => {
      throw hiveError("MODEL_UNAVAILABLE");
    });
    const res = await POST(post({ clientRequestId: REQUEST_ID }), params);
    expect(res.status).toBe(503);
    expect(preparation.startStudyPreparation).not.toHaveBeenCalled();
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it("POST surfaces unacknowledged partial coverage without queueing work", async () => {
    preparation.startStudyPreparation.mockRejectedValue(hiveError("COVERAGE_INCOMPLETE"));
    const res = await POST(post({ clientRequestId: REQUEST_ID }), params);
    expect((await res.json()).error).toMatchObject({ errorCode: "COVERAGE_INCOMPLETE" });
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it("POST returns 202 and runs the first workflow invocation after the response", async () => {
    preparation.startStudyPreparation.mockResolvedValue({
      response: { processingRun: { id: RUN_ID, status: "READING_DOCUMENTS" }, created: true },
      process: true,
    });
    const res = await POST(post({ clientRequestId: REQUEST_ID }), params);
    expect(res.status).toBe(202);
    expect(workflow.processAnalysisRunSafely).not.toHaveBeenCalled();
    expect(nextServer.after).toHaveBeenCalledTimes(1);

    await nextServer.after.mock.calls[0]![0]();
    expect(workflow.processAnalysisRunSafely).toHaveBeenCalledWith({ kind: "worker-deps" }, RUN_ID);
    expect(worker.createWorkerDeps).toHaveBeenCalledWith(process.env, expect.objectContaining({ correlationId: CORRELATION_ID }));
  });

  it("POST schedules nothing when the request replays an existing run", async () => {
    preparation.startStudyPreparation.mockResolvedValue({
      response: { processingRun: { id: RUN_ID, status: "PLANNING_INVESTIGATION" }, created: false },
      process: false,
    });
    const res = await POST(post({ clientRequestId: REQUEST_ID }), params);
    expect(res.status).toBe(202);
    expect(nextServer.after).not.toHaveBeenCalled();
  });
});
