import { describe, expect, it, vi } from "vitest";

import { emitStructuredEvent } from "@/server/observability/logger";

import { sweepWorkflowRecovery } from "./workflow-recovery-sweep";

vi.mock("@/server/observability/logger", () => ({ emitStructuredEvent: vi.fn() }));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";

describe("sweepWorkflowRecovery", () => {
  it("dispatches revived items and logs the sweep", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        hivesScanned: 1,
        hiveIds: [HIVE_ID],
        dispatch: [{ kind: "analysis", id: RUN_ID }],
        dispatchCount: 1,
      },
      error: null,
    }));
    const dispatch = vi.fn(async () => true);
    const result = await sweepWorkflowRecovery({
      client: { rpc },
      correlationId: CORRELATION_ID,
      createDispatch: () => dispatch,
    });
    expect(rpc).toHaveBeenCalledWith("sweep_workflow_recovery", { p_hive_limit: 20 });
    expect(dispatch).toHaveBeenCalledWith({ kind: "analysis", id: RUN_ID }, CORRELATION_ID);
    expect(result.revived).toEqual([{ kind: "analysis", id: RUN_ID }]);
    expect(emitStructuredEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "workflow.recovery_sweep.completed",
        diagnosticReason: "workflow_revived",
      }),
    );
  });

  it("returns idle when the RPC reports no work", async () => {
    const rpc = vi.fn(async () => ({
      data: { hivesScanned: 0, hiveIds: [], dispatch: [], dispatchCount: 0 },
      error: null,
    }));
    const dispatch = vi.fn();
    const result = await sweepWorkflowRecovery({
      client: { rpc },
      correlationId: CORRELATION_ID,
      createDispatch: () => dispatch,
    });
    expect(result.revived).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(emitStructuredEvent).toHaveBeenCalledWith(
      expect.objectContaining({ diagnosticReason: "workflow_sweep_idle" }),
    );
  });

  it("no-ops when the sweeper RPC is not installed yet", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "Could not find the function public.sweep_workflow_recovery(p_hive_limit) in the schema cache" },
    }));
    const result = await sweepWorkflowRecovery({
      client: { rpc },
      correlationId: CORRELATION_ID,
      createDispatch: () => vi.fn(),
    });
    expect(result).toEqual({ hivesScanned: 0, hiveIds: [], revived: [] });
  });
});
