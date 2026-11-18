import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthenticatedUserMock, loadFirmMock, sendMock } = vi.hoisted(() => ({
  requireAuthenticatedUserMock: vi.fn(),
  loadFirmMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));
vi.mock("@/server/firm/load-firm", () => ({ loadFirm: () => loadFirmMock() }));
vi.mock("@/server/email", () => ({
  resolveEmailSender: () => ({ send: (...args: unknown[]) => sendMock(...args) }),
}));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const IDEMPOTENCY_KEY = "44444444-4444-4444-8444-444444444444";

describe("POST /api/v1/firm/practice-area-requests", () => {
  const rpcMock = vi.fn();
  const priorEnv = process.env.OWNER_ALERT_EMAIL;

  beforeEach(() => {
    process.env.OWNER_ALERT_EMAIL = "owner@example.com";
    rpcMock.mockReset();
    sendMock.mockReset();
    loadFirmMock.mockReset();
    requireAuthenticatedUserMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      email: "dana@example.com",
      client: { rpc: rpcMock },
    });
    loadFirmMock.mockResolvedValue({
      firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera Law", callerRole: "owner" },
    });
    rpcMock.mockResolvedValue({
      data: { requestId: "55555555-5555-4555-8555-555555555555", duplicate: false },
      error: null,
    });
    sendMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.OWNER_ALERT_EMAIL = priorEnv;
  });

  it("sends owner email only once when duplicate is false", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { POST } = await import("./route");
      await POST(
        new NextRequest("http://localhost/api/v1/firm/practice-area-requests", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": CORRELATION_ID,
            "idempotency-key": IDEMPOTENCY_KEY,
          },
          body: JSON.stringify({ body: "Probate planning" }),
        }),
      );
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(rpcMock.mock.calls[0]?.[1]).toEqual({
        p_body: "Probate planning",
        p_idempotency_key: IDEMPOTENCY_KEY,
      });
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);

  it("skips email when duplicate is true", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      rpcMock.mockResolvedValue({
        data: { requestId: "55555555-5555-4555-8555-555555555555", duplicate: true },
        error: null,
      });
      const { POST } = await import("./route");
      await POST(
        new NextRequest("http://localhost/api/v1/firm/practice-area-requests", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": CORRELATION_ID,
            "idempotency-key": IDEMPOTENCY_KEY,
          },
          body: JSON.stringify({ body: "Probate planning" }),
        }),
      );
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);

  it("maps rate limit to 429", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "rate_limited" } });
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/api/v1/firm/practice-area-requests", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": CORRELATION_ID,
            "idempotency-key": IDEMPOTENCY_KEY,
          },
          body: JSON.stringify({ body: "Probate planning" }),
        }),
      );
      expect(response.status).toBe(429);
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);
});