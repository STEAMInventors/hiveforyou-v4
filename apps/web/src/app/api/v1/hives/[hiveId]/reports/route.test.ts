import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServer = vi.hoisted(() => ({ after: vi.fn() }));
const auth = vi.hoisted(() => ({ requireApiSupabaseClient: vi.fn() }));
const reports = vi.hoisted(() => ({ getHiveReports: vi.fn(), generateHiveReport: vi.fn() }));
const planner = vi.hoisted(() => ({ loadPlannerServiceConfig: vi.fn() }));
const generation = vi.hoisted(() => ({ processReportRunSafely: vi.fn(async () => undefined) }));
const worker = vi.hoisted(() => ({
  createWorkerDeps: vi.fn(() => ({ kind: "worker-deps" })),
  requireWorkerDispatch: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: nextServer.after,
}));
vi.mock("@/server/supabase/server-client", () => auth);
vi.mock("@/server/reports/reports", () => reports);
vi.mock("@/server/study-preparation/planner-client", () => planner);
vi.mock("@/server/workflow/report-generation", () => generation);
vi.mock("@/server/workflow/worker", () => worker);

import { GET, POST } from "./route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_RUN_ID = "cccccccc-0000-4000-8000-000000000001";
const URL = `http://localhost/api/v1/hives/${HIVE_ID}/reports`;
const params = { params: Promise.resolve({ hiveId: HIVE_ID }) };

function request(method: "GET" | "POST", body?: unknown) {
  return new NextRequest(URL, {
    method,
    headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("/api/v1/hives/[hiveId]/reports", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    auth.requireApiSupabaseClient.mockResolvedValue({ kind: "user" });
    worker.requireWorkerDispatch.mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("GET returns 401 when signed out", async () => {
    auth.requireApiSupabaseClient.mockRejectedValue(
      createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in.",
        correlationId: CORRELATION_ID,
      }),
    );
    const res = await GET(request("GET"), params);
    expect(res.status).toBe(401);
    expect(reports.getHiveReports).not.toHaveBeenCalled();
  });

  it("GET returns both audiences' reports without any entitlement check", async () => {
    reports.getHiveReports.mockResolvedValue({ studyRevision: null, reportRuns: [], latest: [], history: [] });
    const res = await GET(request("GET"), params);
    expect(res.status).toBe(200);
    expect(reports.getHiveReports).toHaveBeenCalledWith({ kind: "user" }, { hiveId: HIVE_ID, correlationId: CORRELATION_ID });
  });

  it("POST queues one Writer run and runs it after the response", async () => {
    reports.generateHiveReport.mockResolvedValue({
      response: { reportRun: { id: REPORT_RUN_ID, status: "QUEUED" }, created: true },
      process: true,
    });
    const res = await POST(request("POST", { clientRequestId: CORRELATION_ID }), params);
    expect(res.status).toBe(202);
    await nextServer.after.mock.calls[0]![0]();
    expect(generation.processReportRunSafely).toHaveBeenCalledWith({ kind: "worker-deps" }, REPORT_RUN_ID);
  });

  it("POST schedules nothing for a replayed request", async () => {
    reports.generateHiveReport.mockResolvedValue({
      response: { reportRun: { id: REPORT_RUN_ID, status: "WRITING" }, created: false },
      process: false,
    });
    const res = await POST(request("POST", { clientRequestId: CORRELATION_ID }), params);
    expect(res.status).toBe(202);
    expect(nextServer.after).not.toHaveBeenCalled();
  });
});
