import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthenticatedUserMock = vi.fn();
const runNewClientFlowMock = vi.fn();
const fetchMyProfileMock = vi.fn();

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));

vi.mock("@/lib/auth/profile", () => ({
  fetchMyProfile: (...args: unknown[]) => fetchMyProfileMock(...args),
}));

vi.mock("@/server/hives/new-client-service", () => ({
  runNewClientFlow: (...args: unknown[]) => runNewClientFlowMock(...args),
}));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const IDEMPOTENCY_KEY = "11111111-1111-4111-8111-111111111111";
const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";

const { POST } = await import("./route");

describe("POST /api/v1/hives/new-client", () => {
  beforeEach(() => {
    requireAuthenticatedUserMock.mockReset();
    runNewClientFlowMock.mockReset();
    fetchMyProfileMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({ ok: true, client: { rpc: vi.fn() }, userId: HIVE_ID });
    fetchMyProfileMock.mockResolvedValue({ profile: { displayName: "Dana Rivera" } });
  });

  it("refuses unauthenticated callers", async () => {
    requireAuthenticatedUserMock.mockResolvedValueOnce({ ok: false, diagnosticReason: "no_session" });
    const response = await POST(
      new NextRequest("http://localhost/api/v1/hives/new-client", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": IDEMPOTENCY_KEY,
          "x-correlation-id": CORRELATION_ID,
        },
        body: JSON.stringify({ name: "Ruth", mode: "documents" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns hive id on success", async () => {
    runNewClientFlowMock.mockResolvedValueOnce({ ok: true, hiveId: HIVE_ID, hiveName: "Ruth", mode: "documents", requestedItemCount: 0 });
    const response = await POST(
      new NextRequest("http://localhost/api/v1/hives/new-client", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": IDEMPOTENCY_KEY,
          "x-correlation-id": CORRELATION_ID,
        },
        body: JSON.stringify({ name: "Ruth", mode: "documents", packId: null, items: [] }),
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.hiveId).toBe(HIVE_ID);
  });

  it("returns partial payload with completed steps", async () => {
    runNewClientFlowMock.mockResolvedValueOnce({
      ok: false,
      hiveId: HIVE_ID,
      completed: ["hive"],
      failedStep: "checklist",
      error: {
        errorCode: "INTERNAL_ERROR",
        category: "INTERNAL",
        stage: "SHELL",
        message: "Could not save the checklist.",
        correlationId: CORRELATION_ID,
        retryable: true,
      },
    });
    const response = await POST(
      new NextRequest("http://localhost/api/v1/hives/new-client", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": IDEMPOTENCY_KEY,
          "x-correlation-id": CORRELATION_ID,
        },
        body: JSON.stringify({
          name: "Ruth",
          mode: "invite",
          email: "ruth@example.com",
          packId: "widget-review",
          items: [{ key: "pay stubs", title: "Pay stubs", custom: false }],
        }),
      }),
    );
    const body = await response.json();
    expect(body.hiveId).toBe(HIVE_ID);
    expect(body.completed).toEqual(["hive"]);
    expect(body.failedStep).toBe("checklist");
  });
});