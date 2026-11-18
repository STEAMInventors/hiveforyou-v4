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

describe("PATCH /api/v1/firm/practice-areas", () => {
  const rpcMock = vi.fn();

  beforeEach(() => {
    rpcMock.mockReset();
    loadFirmMock.mockReset();
    requireAuthenticatedUserMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      client: { rpc: rpcMock },
    });
    loadFirmMock.mockResolvedValue({
      firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera Law", callerRole: "owner", practiceAreas: ["pack-alpha"] },
      members: [],
      pendingInvitations: [],
    });
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("updates practice areas for owner", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { PATCH } = await import("./route");
      const response = await PATCH(
        new NextRequest("http://localhost/api/v1/firm/practice-areas", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ practiceAreas: ["pack-alpha", "pack-beta"] }),
        }),
      );
      expect(response.status).toBe(200);
      expect(rpcMock.mock.calls[0]?.[0]).toBe("update_firm_profile");
      expect(rpcMock.mock.calls[0]?.[1]?.p_practice_areas).toEqual(["pack-alpha", "pack-beta"]);
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);

  it("rejects members with 403", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      loadFirmMock.mockResolvedValue({
        firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera Law", callerRole: "member" },
        members: [],
        pendingInvitations: [],
      });
      const { PATCH } = await import("./route");
      const response = await PATCH(
        new NextRequest("http://localhost/api/v1/firm/practice-areas", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ practiceAreas: ["pack-alpha"] }),
        }),
      );
      expect(response.status).toBe(403);
      expect(rpcMock).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);

  it("rejects unknown ids with 400", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { PATCH } = await import("./route");
      const response = await PATCH(
        new NextRequest("http://localhost/api/v1/firm/practice-areas", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ practiceAreas: ["bogus-pack"] }),
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.error.message).toBe("Choose from the listed areas.");
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);
});