import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthenticatedUserMock = vi.fn();
const sendInvitationEmailMock = vi.fn();

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));

vi.mock("@/server/hives/send-invitation-email", () => ({
  sendInvitationEmail: (...args: unknown[]) => sendInvitationEmailMock(...args),
}));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "44444444-4444-4444-8444-444444444444";

// The route graph takes several seconds to import. Loading it inside a test
// sits on Vitest's 5s limit, and a timed-out request then leaks into the next test.
const { POST } = await import("./route");

describe("POST /api/v1/hives/[hiveId]/invitations", () => {
  const rpcMock = vi.fn();

  beforeEach(() => {
    rpcMock.mockReset();
    sendInvitationEmailMock.mockReset();
    requireAuthenticatedUserMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      userId: "22222222-2222-4222-8222-222222222222",
      client: { rpc: rpcMock },
    });
  });

  it("revokes the invitation and returns a plain error when sending fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const order: string[] = [];
    try {
      rpcMock.mockImplementation(async (name: string, args: { p_invitation_id?: string }) => {
        order.push(name);
        if (name === "create_invitation") {
          return {
            data: { invitationId: INVITATION_ID, email: "guest@example.com", role: "client" },
            error: null,
          };
        }
        if (name === "revoke_invitation") {
          expect(args.p_invitation_id).toBe(INVITATION_ID);
          return { data: null, error: { message: "revoke failed" } };
        }
        throw new Error(`unexpected rpc ${name}`);
      });
      sendInvitationEmailMock.mockImplementation(async () => {
        order.push("send");
        throw new Error("resend_failed https://app.example/invite/secret-token");
      });

      const response = await POST(
        new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/invitations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": CORRELATION_ID,
          },
          body: JSON.stringify({
            email: "guest@example.com",
            role: "client",
            inviterName: "Sam",
            hiveName: "Widget batch",
          }),
        }),
        { params: Promise.resolve({ hiveId: HIVE_ID }) },
      );
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(body.error.message).toBe("We couldn't send the invitation. Try again.");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(order).toEqual(["create_invitation", "send", "revoke_invitation"]);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not revoke an invitation whose email was sent", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      rpcMock.mockResolvedValue({
        data: { invitationId: INVITATION_ID, email: "guest@example.com", role: "client" },
        error: null,
      });
      sendInvitationEmailMock.mockResolvedValue(undefined);

      const response = await POST(
        new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/invitations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": CORRELATION_ID,
          },
          body: JSON.stringify({
            email: "guest@example.com",
            role: "client",
            inviterName: "Sam",
            hiveName: "Widget batch",
          }),
        }),
        { params: Promise.resolve({ hiveId: HIVE_ID }) },
      );
      expect(response.status).toBe(201);
      expect(sendInvitationEmailMock).toHaveBeenCalledOnce();
      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect(rpcMock.mock.calls[0]?.[0]).toBe("create_invitation");
    } finally {
      logSpy.mockRestore();
    }
  });
});
