import { describe, expect, it, vi } from "vitest";

const emitStructuredEvent = vi.fn();

vi.mock("@/server/observability/logger", () => ({
  emitStructuredEvent: (...args: unknown[]) => emitStructuredEvent(...args),
}));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

describe("instrumentation onRequestError", () => {
  it(
    "logs with digest and correlation id from the request",
    async () => {
    const { onRequestError } = await import("./instrumentation");
    emitStructuredEvent.mockReset();
    await onRequestError(new Error("render failed"), {
      headers: new Headers({ "x-correlation-id": CORRELATION_ID }),
    } as unknown as Parameters<typeof onRequestError>[1], {
      digest: "digest-123",
    });
    expect(emitStructuredEvent).toHaveBeenCalledOnce();
    expect(emitStructuredEvent.mock.calls[0]?.[0]).toMatchObject({
      eventName: "request.error",
      correlationId: CORRELATION_ID,
      errorDetail: "digest-123",
    });
  },
    30_000,
  );
});