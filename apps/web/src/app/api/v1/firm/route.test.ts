import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthenticatedUserMock, loadFirmMock, allowlistMock } = vi.hoisted(() => ({
  requireAuthenticatedUserMock: vi.fn(),
  loadFirmMock: vi.fn(),
  allowlistMock: vi.fn(() => new Set(["pack-alpha", "pack-beta"])),
}));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));
vi.mock("@/server/firm/load-firm", () => ({ loadFirm: () => loadFirmMock() }));
vi.mock("@/server/firm/practice-area-options", () => ({
  practiceAreaAllowlistFromPacks: () => allowlistMock(),
}));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const FIRM_RESPONSE = {
  firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera Law", callerRole: "owner" },
  members: [],
  pendingInvitations: [],
};

describe("POST /api/v1/firm", () => {
  const rpcMock = vi.fn();

  beforeEach(() => {
    rpcMock.mockReset();
    loadFirmMock.mockReset();
    requireAuthenticatedUserMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      userId: "22222222-2222-4222-8222-222222222222",
      client: { rpc: rpcMock },
    });
    rpcMock.mockResolvedValue({
      data: { firmId: FIRM_RESPONSE.firm.firmId, name: "Rivera Law", practiceAreas: ["pack-alpha"] },
      error: null,
    });
    loadFirmMock.mockResolvedValue(FIRM_RESPONSE);
  });

  it("rejects unknown practice-area ids with 400", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/api/v1/firm", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ name: "Rivera Law", practiceAreas: ["not-a-pack"] }),
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.error.message).toBe("Choose from the listed areas.");
      expect(rpcMock).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);

  it("retries create after a lost response when the same firm name exists", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: "23505", message: "firm_membership_exists" },
      });
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/api/v1/firm", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ name: "Rivera Law", practiceAreas: ["pack-alpha"] }),
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.firm.name).toBe("Rivera Law");
      expect(loadFirmMock).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);

  it("returns 409 when a different firm name is submitted after membership exists", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: "23505", message: "firm_membership_exists" },
      });
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/api/v1/firm", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ name: "Other Name", practiceAreas: ["pack-alpha"] }),
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(409);
      expect(body.error.message).toBe("You already have a practice set up.");
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);

  it("maps rpc 42501 to 404", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "access_denied" } });
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/api/v1/firm", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ name: "Rivera Law", practiceAreas: ["pack-alpha"] }),
        }),
      );
      expect(response.status).toBe(404);
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);

  it("maps unknown rpc errors to retryable 503 with reference", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      rpcMock.mockResolvedValue({ data: null, error: { code: "58000", message: "boom" } });
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/api/v1/firm", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ name: "Rivera Law", practiceAreas: ["pack-alpha"] }),
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body.error.retryable).toBe(true);
      expect(body.error.message).toBe("Could not save right now. Try again.");
      expect(body.error.correlationId).toBe(CORRELATION_ID);
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);
});