import { describe, expect, it, vi } from "vitest";

import { getFailureDiagnostics } from "./failure-lookup";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const REFERENCE = "ac941441-5e0e-4ca4-818a-d8fe283d679b";
const RUN_ID = "325193b3-826e-4583-897e-71d1086530a0";

describe("getFailureDiagnostics", () => {
  it("returns the stored diagnostic and drops anything else on the row", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        correlationId: REFERENCE,
        diagnostics: [
          {
            kind: "processing_run",
            operationId: RUN_ID,
            status: "FAILED",
            errorMessageSafe: "safe",
            prompt: "system prompt",
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
              content: "model response",
            },
          },
        ],
      },
      error: null,
    }));
    const result = await getFailureDiagnostics(
      { rpc },
      { hiveId: HIVE_ID, correlationId: "66666666-6666-4666-8666-666666666666", reference: REFERENCE },
    );
    expect(rpc).toHaveBeenCalledWith("get_failure_diagnostics", { p_hive_id: HIVE_ID, p_correlation_id: REFERENCE });
    expect(result.diagnostics).toEqual([
      {
        kind: "processing_run",
        operationId: RUN_ID,
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
    ]);
    expect(JSON.stringify(result)).not.toContain("model response");
    expect(JSON.stringify(result)).not.toContain("system prompt");
  });

  it("does not confirm a Hive the caller cannot open", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "hive_not_found" } }));
    await expect(
      getFailureDiagnostics({ rpc }, { hiveId: HIVE_ID, correlationId: REFERENCE, reference: REFERENCE }),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND", diagnosticReason: "not_found" });
  });
});
