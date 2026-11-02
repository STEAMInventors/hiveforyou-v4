import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireApiSupabaseClient: vi.fn() }));
const lookup = vi.hoisted(() => ({ getFailureDiagnostics: vi.fn() }));

vi.mock("@/server/supabase/server-client", () => auth);
vi.mock("@/server/observability/failure-lookup", () => lookup);

import { GET } from "./route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const REFERENCE = "ac941441-5e0e-4ca4-818a-d8fe283d679b";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ hiveId: HIVE_ID }) };

function request(reference = REFERENCE) {
  return new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/diagnostics?correlationId=${reference}`, {
    headers: { "x-correlation-id": CORRELATION_ID },
  });
}

describe("GET /api/v1/hives/[hiveId]/diagnostics", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    auth.requireApiSupabaseClient.mockResolvedValue({ kind: "user" });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("returns the safe diagnostic for the owner", async () => {
    lookup.getFailureDiagnostics.mockResolvedValue({
      correlationId: REFERENCE,
      diagnostics: [
        {
          kind: "processing_run",
          operationId: "325193b3-826e-4583-897e-71d1086530a0",
          status: "FAILED",
          diagnostic: {
            contractVersion: "failure-diagnostic@1",
            component: "planner",
            operation: "plan_completion",
            task: "study",
            stage: "INVESTIGATING",
            errorCode: "MODEL_OUTPUT_INVALID",
            diagnosticReason: "model_output_not_json",
            diagnosticField: null,
            retryable: true,
            attempt: 1,
          },
        },
      ],
    });
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(lookup.getFailureDiagnostics).toHaveBeenCalledWith(
      { kind: "user" },
      { hiveId: HIVE_ID, correlationId: CORRELATION_ID, reference: REFERENCE },
    );
    const body = await response.json();
    expect(body.diagnostics[0].diagnostic.diagnosticReason).toBe("model_output_not_json");
    expect(JSON.stringify(body)).not.toContain("prompt");
  });

  it("does not look up a reference when the caller is signed out", async () => {
    auth.requireApiSupabaseClient.mockRejectedValue(
      createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "ANALYZE",
        retryable: false,
        safeMessage: "Sign in to look up a support reference.",
        correlationId: CORRELATION_ID,
      }),
    );
    const response = await GET(request(), params);
    expect(response.status).toBe(401);
    expect(lookup.getFailureDiagnostics).not.toHaveBeenCalled();
  });
});
