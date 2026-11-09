import { INVOCATION_MAX_DURATION_MS } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import {
  LOST_HANDOFF_GRACE_MS,
  applyExpiredLeaseRecovery,
  type ExpiredLeaseRow,
} from "./lease-recovery";
import { WRITE_AHEAD_HANDOFF_DELAY_SECONDS } from "./analysis-workflow";

const NOW = 1_700_000_000_000;
const RUN_ID = "22222222-2222-4222-8222-222222222222";

/**
 * Reproduces the production stall: claim clears `next_dispatch_at` without a write-ahead reserve,
 * the worker dies, the lease lapses, and both scheduling fields stay NULL until recovery.
 */
describe("workflow hand-off stall (claim without reserve)", () => {
  it("leaves no recoverable dispatch when claim clears next_dispatch and the worker dies before reserve", () => {
    const claimedAt = NOW - 400_000;
    const row: ExpiredLeaseRow = {
      kind: "analysis",
      id: RUN_ID,
      status: "EXTRACTING",
      attemptCount: 2,
      maxAttempts: 3,
      leaseExpiresAtMs: null,
      nextDispatchAtMs: null,
      workflowLastHandoffAtMs: claimedAt,
    };
    const beforeGrace = applyExpiredLeaseRecovery([row], claimedAt + LOST_HANDOFF_GRACE_MS - 1_000);
    expect(beforeGrace.dispatch).toEqual([]);
    const afterGrace = applyExpiredLeaseRecovery([row], claimedAt + LOST_HANDOFF_GRACE_MS + 1_000);
    expect(afterGrace.dispatch).toEqual([{ kind: "analysis", id: RUN_ID }]);
  });

  it("matches write-ahead delay to the Vercel invocation budget", () => {
    expect(WRITE_AHEAD_HANDOFF_DELAY_SECONDS).toBe(Math.ceil(INVOCATION_MAX_DURATION_MS / 1000));
  });

  it("re-dispatches when write-ahead next_dispatch is overdue and the lease is gone", () => {
    const row: ExpiredLeaseRow = {
      kind: "analysis",
      id: RUN_ID,
      status: "EXTRACTING",
      attemptCount: 1,
      maxAttempts: 3,
      leaseExpiresAtMs: null,
      nextDispatchAtMs: NOW - LOST_HANDOFF_GRACE_MS - 1_000,
      workflowLastHandoffAtMs: NOW - LOST_HANDOFF_GRACE_MS - 1_000,
    };
    const plan = applyExpiredLeaseRecovery([row], NOW);
    expect(plan.dispatch).toEqual([{ kind: "analysis", id: RUN_ID }]);
    expect(plan.failed).toEqual([]);
  });
});
