import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthenticatedUserMock, loadFirmMock, fetchMyProfileMock, sendMock } = vi.hoisted(() => ({
  requireAuthenticatedUserMock: vi.fn(),
  loadFirmMock: vi.fn(),
  fetchMyProfileMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));
vi.mock("@/server/firm/load-firm", () => ({ loadFirm: () => loadFirmMock() }));
vi.mock("@/lib/auth/profile", () => ({ fetchMyProfile: () => fetchMyProfileMock() }));
vi.mock("@/server/email", () => ({
  resolveEmailSender: () => ({ send: (...args: unknown[]) => sendMock(...args) }),
}));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

describe("POST /api/v1/firm/invitations", () => {
  const rpcMock = vi.fn();

  beforeEach(() => {
    rpcMock.mockReset();
    sendMock.mockReset();
    loadFirmMock.mockReset();
    fetchMyProfileMock.mockReset();
    requireAuthenticatedUserMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      userId: "22222222-2222-4222-8222-222222222222",
      client: { rpc: rpcMock },
    });
    loadFirmMock.mockResolvedValue({
      firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera Law", callerRole: "owner" },
      members: [],
      pendingInvitations: [],
    });
    fetchMyProfileMock.mockResolvedValue({ profile: { displayName: "Maria" }, error: null });
    rpcMock.mockResolvedValue({
      data: { firmMemberId: "44444444-4444-4444-8444-444444444444", email: "dana@example.com" },
      error: null,
    });
    sendMock.mockResolvedValue(undefined);
  });

  it("emails the owner and firm line from step 2", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/api/v1/firm/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ email: "dana@example.com", title: "Paralegal", role: "member" }),
        }),
      );
      expect(response.status).toBe(201);
      expect(rpcMock.mock.calls[0]?.[0]).toBe("invite_firm_member");
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "dana@example.com",
          subject: "Maria added you to Rivera Law on HiveForYou",
        }),
      );
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);

  it("revokes the firm invitation when the email cannot be sent", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      sendMock.mockRejectedValue(new Error("resend_failed secret-token"));
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/api/v1/firm/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
          body: JSON.stringify({ email: "dana@example.com", title: "Paralegal", role: "member" }),
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(body.error.message).toBe("We couldn't send the invitation. Try again.");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(rpcMock.mock.calls.map((call) => call[0])).toEqual(["invite_firm_member", "revoke_firm_invitation"]);
    } finally {
      logSpy.mockRestore();
    }
  }, 20000);
});
