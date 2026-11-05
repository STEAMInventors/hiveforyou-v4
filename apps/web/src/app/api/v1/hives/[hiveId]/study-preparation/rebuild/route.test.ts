import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServer = vi.hoisted(() => ({ after: vi.fn((work: () => Promise<void> | void) => work()) }));
const auth = vi.hoisted(() => ({ requireApiSupabaseClient: vi.fn() }));
const preparation = vi.hoisted(() => ({ rebuildStudy: vi.fn() }));
const planner = vi.hoisted(() => ({ loadPlannerServiceConfig: vi.fn() }));
const workflow = vi.hoisted(() => ({ processAnalysisRunSafely: vi.fn(async () => undefined) }));
const reportWorkflow = vi.hoisted(() => ({ processReportRunSafely: vi.fn(async () => undefined) }));
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
vi.mock("@/server/workflow/report-generation", () => reportWorkflow);
vi.mock("@/server/workflow/worker", () => worker);

import { POST } from "./route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const URL = `http://localhost/api/v1/hives/${HIVE_ID}/study-preparation/rebuild`;
const params = { params: Promise.resolve({ hiveId: HIVE_ID }) };

function post(body: unknown): NextRequest {
  return new NextRequest(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
    body: JSON.stringify(body),
  });
}

describe("POST /study-preparation/rebuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    auth.requireApiSupabaseClient.mockResolvedValue({ kind: "user" });
    planner.loadPlannerServiceConfig.mockReturnValue({ baseUrl: "https://reader.test/planner", serviceToken: "s", timeoutMs: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a signed-out caller before starting a rebuild", async () => {
    auth.requireApiSupabaseClient.mockRejectedValue(
      createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "ANALYZE",
        retryable: false,
        safeMessage: "Sign in to rebuild the study.",
        correlationId: CORRELATION_ID,
      }),
    );
    const response = await POST(post({ clientRequestId: "55555555-5555-4555-8555-555555555555" }), params);
    expect(response.status).toBe(401);
    expect(preparation.rebuildStudy).not.toHaveBeenCalled();
    expect(workflow.processAnalysisRunSafely).not.toHaveBeenCalled();
    expect(reportWorkflow.processReportRunSafely).not.toHaveBeenCalled();
  });

  it("starts the study workflow and does not dispatch Writer", async () => {
    preparation.rebuildStudy.mockResolvedValue({
      process: true,
      response: {
        created: true,
        reusedStudy: false,
        reportsReady: false,
        reportRuns: [],
        processingRun: { id: RUN_ID, status: "QUEUED", preparationMode: "REBUILD" },
      },
    });
    const response = await POST(post({ clientRequestId: "55555555-5555-4555-8555-555555555555" }), params);
    expect(response.status).toBe(202);
    expect(workflow.processAnalysisRunSafely).toHaveBeenCalledWith(expect.anything(), RUN_ID);
    expect(reportWorkflow.processReportRunSafely).not.toHaveBeenCalled();
  });
});
