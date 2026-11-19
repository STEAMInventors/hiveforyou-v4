import type { Pack } from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import { runChecklistTailor, TAILOR_FALLBACK_MESSAGE, type ChecklistTailorModelRunner } from "./checklist-tailor-service";

const emitStructuredEventMock = vi.fn();
vi.mock("@/server/observability/logger", () => ({
  emitStructuredEvent: (...args: unknown[]) => emitStructuredEventMock(...args),
}));

function minimalPack(): Pack {
  return {
    meta: { id: "widget", title: "Widget", version: 1 },
    documentsUsuallyNeeded: [
      {
        document: "Widget spec sheet",
        holder: "the vendor",
        holderType: "THIRD_PARTY",
        gapKind: "RECORD",
        appliesWhen: null,
      },
    ],
    checks: [],
  } as Pack;
}

describe("runChecklistTailor fallback logging", () => {
  it("emits hive.checklist_tailor.fallback with diagnostic reason on model failure paths", async () => {
    emitStructuredEventMock.mockReset();
    const pack = minimalPack();
    const correlationId = "corr-fallback-test";

    const runners: Array<{ runner: ChecklistTailorModelRunner; reason: string }> = [
      {
        runner: async () => ({ ok: false, reason: "prompt_unavailable" }),
        reason: "prompt_unavailable",
      },
      {
        runner: async () => ({ ok: false, reason: "model_failed" }),
        reason: "model_failed",
      },
      {
        runner: async () => ({
          ok: true,
          output: { rows: [{ key: "bad", action: "not-an-enum", reason: "" }] },
          modelId: "test",
          latencyMs: 1,
        }),
        reason: "invalid_output",
      },
    ];

    for (const { runner, reason } of runners) {
      emitStructuredEventMock.mockClear();
      const result = await runChecklistTailor(pack, "need lease review", correlationId, runner);
      expect(result.message).toBe(TAILOR_FALLBACK_MESSAGE);
      expect(emitStructuredEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "hive.checklist_tailor.fallback",
          diagnosticReason: reason,
          correlationId,
        }),
      );
    }
  });
});