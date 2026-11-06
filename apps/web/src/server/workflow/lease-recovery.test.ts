import { describe, expect, it, vi } from "vitest";

import {
  applyExpiredLeaseRecovery,
  LEASE_RECOVERY_RESERVATION_MS,
  PREPARATION_INTERRUPTED_MESSAGE,
  REPORT_INTERRUPTED_MESSAGE,
  recoverExpiredWorkflowLeases,
  type ExpiredLeaseRow,
} from "./lease-recovery";

const NOW = 1_700_000_000_000;
const REPORT_ID = "cccccccc-0000-4000-8000-000000000001";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

function report(overrides: Partial<ExpiredLeaseRow> = {}): ExpiredLeaseRow {
  return {
    kind: "report",
    id: REPORT_ID,
    status: "WRITING",
    attemptCount: 1,
    maxAttempts: 3,
    leaseExpiresAtMs: NOW - 1_000,
    nextDispatchAtMs: null,
    ...overrides,
  };
}

describe("applyExpiredLeaseRecovery", () => {
  it("re-dispatches an expired WRITING run and counts an attempt", () => {
    const row = report();
    const plan = applyExpiredLeaseRecovery([row], NOW);
    expect(plan.dispatch).toEqual([{ kind: "report", id: REPORT_ID }]);
    expect(plan.failed).toEqual([]);
    expect(row.attemptCount).toBe(2);
    expect(row.status).toBe("WRITING");
    expect(row.nextDispatchAtMs).toBe(NOW + LEASE_RECOVERY_RESERVATION_MS);
  });

  it("does not dispatch the same expired run again while the reservation holds", () => {
    const row = report();
    applyExpiredLeaseRecovery([row], NOW);
    const again = applyExpiredLeaseRecovery([row], NOW + 1_000);
    expect(again.dispatch).toEqual([]);
    expect(again.failed).toEqual([]);
    expect(row.attemptCount).toBe(2);
  });

  it("fails an exhausted expired WRITING run as retryable", () => {
    const row = report({ attemptCount: 3 });
    const plan = applyExpiredLeaseRecovery([row], NOW);
    expect(plan.dispatch).toEqual([]);
    expect(plan.failed).toEqual([{ kind: "report", id: REPORT_ID }]);
    expect(row).toMatchObject({
      status: "FAILED",
      retryable: true,
      errorCode: "REPORT_INTERRUPTED",
      errorMessageSafe: REPORT_INTERRUPTED_MESSAGE,
      leaseExpiresAtMs: null,
      nextDispatchAtMs: null,
      attemptCount: 3,
    });
  });

  it("leaves a live lease and a terminal run alone", () => {
    const live = report({ leaseExpiresAtMs: NOW + 60_000 });
    const done = report({ id: RUN_ID, status: "SUCCEEDED", attemptCount: 1 });
    const plan = applyExpiredLeaseRecovery([live, done], NOW);
    expect(plan.dispatch).toEqual([]);
    expect(plan.failed).toEqual([]);
    expect(live.attemptCount).toBe(1);
    expect(done.status).toBe("SUCCEEDED");
  });

  it("re-dispatches a lost hand-off without counting an attempt and ignores a second poll", () => {
    const row = report({
      kind: "analysis",
      id: RUN_ID,
      status: "EXTRACTING",
      attemptCount: 2,
      maxAttempts: 3,
      leaseExpiresAtMs: null,
      nextDispatchAtMs: NOW - 4 * 60_000,
      updatedAtMs: NOW - 4 * 60_000,
    });
    const plan = applyExpiredLeaseRecovery([row], NOW);
    expect(plan.dispatch).toEqual([{ kind: "analysis", id: RUN_ID }]);
    expect(row.attemptCount).toBe(2);
    expect(row.nextDispatchAtMs).toBe(NOW + LEASE_RECOVERY_RESERVATION_MS);
    const again = applyExpiredLeaseRecovery([row], NOW + 1_000);
    expect(again.dispatch).toEqual([]);
  });

  it("does not treat a recent lost hand-off as overdue before the grace window", () => {
    const row = report({
      kind: "analysis",
      id: RUN_ID,
      status: "EXTRACTING",
      attemptCount: 1,
      leaseExpiresAtMs: null,
      nextDispatchAtMs: NOW - 30_000,
    });
    expect(applyExpiredLeaseRecovery([row], NOW).dispatch).toEqual([]);
  });

  it("fails an exhausted processing run and re-dispatches one that still has an attempt", () => {
    const exhausted = report({
      kind: "analysis",
      id: RUN_ID,
      status: "CANONICALIZING",
      attemptCount: 3,
      maxAttempts: 3,
    });
    const open = report({
      kind: "analysis",
      id: REPORT_ID,
      status: "EXTRACTING",
      attemptCount: 2,
      maxAttempts: 3,
    });
    const plan = applyExpiredLeaseRecovery([exhausted, open], NOW);
    expect(plan.failed).toEqual([{ kind: "analysis", id: RUN_ID }]);
    expect(exhausted).toMatchObject({
      status: "FAILED",
      retryable: true,
      errorCode: "PREPARATION_INTERRUPTED",
      errorMessageSafe: PREPARATION_INTERRUPTED_MESSAGE,
    });
    expect(plan.dispatch).toEqual([{ kind: "analysis", id: REPORT_ID }]);
    expect(open.attemptCount).toBe(3);
  });
});

describe("recoverExpiredWorkflowLeases", () => {
  it("dispatches each run the recovery RPC reserved", async () => {
    const rpc = vi.fn(async () => ({
      data: { dispatch: [{ kind: "report", id: REPORT_ID }, { kind: "analysis", id: RUN_ID }] },
      error: null,
    }));
    const dispatch = vi.fn(async () => true);
    await recoverExpiredWorkflowLeases({
      client: { rpc },
      hiveId: HIVE_ID,
      correlationId: CORRELATION_ID,
      createDispatch: () => dispatch,
    });
    expect(rpc).toHaveBeenCalledWith("recover_expired_workflow_leases", { p_hive_id: HIVE_ID });
    expect(dispatch).toHaveBeenNthCalledWith(1, { kind: "report", id: REPORT_ID }, CORRELATION_ID);
    expect(dispatch).toHaveBeenNthCalledWith(2, { kind: "analysis", id: RUN_ID }, CORRELATION_ID);
  });

  it("still returns when the recovery function is not installed yet", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "Could not find the function public.recover_expired_workflow_leases(p_hive_id) in the schema cache" },
    }));
    const createDispatch = vi.fn();
    await expect(
      recoverExpiredWorkflowLeases({
        client: { rpc },
        hiveId: HIVE_ID,
        correlationId: CORRELATION_ID,
        createDispatch,
      }),
    ).resolves.toBeUndefined();
    expect(createDispatch).not.toHaveBeenCalled();
  });

  it("does not build a dispatcher when nothing was reserved", async () => {
    const rpc = vi.fn(async () => ({ data: { dispatch: [] }, error: null }));
    const createDispatch = vi.fn();
    await recoverExpiredWorkflowLeases({
      client: { rpc },
      hiveId: HIVE_ID,
      correlationId: CORRELATION_ID,
      createDispatch,
    });
    expect(createDispatch).not.toHaveBeenCalled();
  });
});
