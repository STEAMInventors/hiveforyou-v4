// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HiveBoardPeople } from "./HiveBoardPeople";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const ownerHive = {
  id: HIVE_ID,
  hiveId: HIVE_ID,
  name: "Widget batch",
  description: null,
  kind: "client" as const,
  clientRequestId: "550e8400-e29b-41d4-a716-446655440000",
  createdAt: "2026-11-15",
  updatedAt: "2026-11-15",
  isOwner: true,
  membershipRole: "owner" as const,
};

afterEach(cleanup);

describe("HiveBoardPeople", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          people: [
            {
              userId: USER_ID,
              role: "owner",
              displayName: "Sam Rivera",
              joined: true,
            },
            {
              userId: "33333333-3333-4333-8333-333333333333",
              role: "client",
              displayName: null,
              email: "client@example.com",
              joined: true,
            },
          ],
          pendingInvitations: [
            { invitationId: "44444444-4444-4444-8444-444444444444", email: "pending@example.com", role: "client" },
          ],
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("formats joined and invited people without using a bare role as a name", async () => {
    render(<HiveBoardPeople hive={ownerHive} currentUserId={USER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("You · owner")).toBeTruthy();
    });
    expect(screen.getByText("client@example.com · client")).toBeTruthy();
    expect(screen.getByText("pending@example.com · invited, not joined yet")).toBeTruthy();
    expect(screen.queryByText(/^owner$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy();
  });

  it("sends again by revoking the open invitation and creating a new one", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        if (url.endsWith("/people")) {
          return Response.json({
            people: [
              {
                userId: USER_ID,
                role: "owner",
                displayName: "Sam Rivera",
                joined: true,
              },
            ],
            pendingInvitations: [
              {
                invitationId: "44444444-4444-4444-8444-444444444444",
                email: "pending@example.com",
                role: "client",
              },
            ],
          });
        }
        return Response.json({ ok: true }, { status: url.endsWith("/invitations") ? 201 : 200 });
      }),
    );

    render(<HiveBoardPeople hive={ownerHive} currentUserId={USER_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Send again" }));

    await waitFor(() => {
      const revokeAt = calls.findIndex((call) => call.url.includes("/revoke") && call.method === "POST");
      const createAt = calls.findIndex((call) => call.url.endsWith("/invitations") && call.method === "POST");
      expect(revokeAt).toBeGreaterThanOrEqual(0);
      expect(createAt).toBeGreaterThan(revokeAt);
    });

    const created = calls.find((call) => call.url.endsWith("/invitations") && call.method === "POST");
    expect(JSON.parse(created?.body ?? "{}")).toEqual({
      email: "pending@example.com",
      role: "client",
      hiveName: "Widget batch",
      inviterName: "Sam Rivera",
    });
  });
});