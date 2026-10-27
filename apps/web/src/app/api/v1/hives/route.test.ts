import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthenticatedUserMock = vi.fn();
const listHivesViaEdgeMock = vi.fn();
const createHiveViaEdgeMock = vi.fn();
const getHiveViaEdgeMock = vi.fn();

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));

vi.mock("@/server/hives/hive-edge-gateway", () => ({
  listHivesViaEdge: (...args: unknown[]) => listHivesViaEdgeMock(...args),
  createHiveViaEdge: (...args: unknown[]) => createHiveViaEdgeMock(...args),
  getHiveViaEdge: (...args: unknown[]) => getHiveViaEdgeMock(...args),
}));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_REQ_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("/api/v1/hives and /api/v1/hives/[hiveId] routes", () => {
  beforeEach(() => {
    requireAuthenticatedUserMock.mockReset();
    listHivesViaEdgeMock.mockReset();
    createHiveViaEdgeMock.mockReset();
    getHiveViaEdgeMock.mockReset();
  });

  it("denies unauthenticated GET and POST requests with 401 UNAUTHENTICATED and correlationId", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      requireAuthenticatedUserMock.mockResolvedValue({
        ok: false,
        diagnosticReason: "no_session",
      });

      const { GET, POST } = await import("./route");
      const getRes = await GET(
        new NextRequest("http://localhost/api/v1/hives", {
          headers: { "x-correlation-id": CORRELATION_ID },
        }),
      );
      const getBody = await getRes.json();
      expect(getRes.status).toBe(401);
      expect(getRes.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
      expect(getBody.error.errorCode).toBe("UNAUTHENTICATED");
      expect(getBody.error.correlationId).toBe(CORRELATION_ID);

      const postRes = await POST(
        new NextRequest("http://localhost/api/v1/hives", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": CORRELATION_ID,
          },
          body: JSON.stringify({
            name: "Test",
            clientRequestId: CLIENT_REQ_ID,
          }),
        }),
      );
      expect(postRes.status).toBe(401);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns 201 on new Hive creation and 200 on idempotent replay", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      requireAuthenticatedUserMock.mockResolvedValue({
        ok: true,
        userId: "user-1",
        client: {},
      });

      const sampleHive = {
        id: HIVE_ID,
        hiveId: HIVE_ID,
        name: "My Hive",
        description: null,
        clientRequestId: CLIENT_REQ_ID,
        createdAt: "2026-10-26T21:00:00Z",
        updatedAt: "2026-10-26T21:00:00Z",
      };

      createHiveViaEdgeMock.mockResolvedValueOnce({
        hive: sampleHive,
        created: true,
      });
      createHiveViaEdgeMock.mockResolvedValueOnce({
        hive: sampleHive,
        created: false,
      });

      const { POST } = await import("./route");
      const firstRes = await POST(
        new NextRequest("http://localhost/api/v1/hives", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": CORRELATION_ID,
          },
          body: JSON.stringify({
            name: "My Hive",
            clientRequestId: CLIENT_REQ_ID,
          }),
        }),
      );
      expect(firstRes.status).toBe(201);

      const secondRes = await POST(
        new NextRequest("http://localhost/api/v1/hives", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": CORRELATION_ID,
          },
          body: JSON.stringify({
            name: "My Hive",
            clientRequestId: CLIENT_REQ_ID,
          }),
        }),
      );
      expect(secondRes.status).toBe(200);
      const secondBody = await secondRes.json();
      expect(secondBody.created).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns 409 IDEMPOTENCY_CONFLICT when createHiveViaEdge throws IDEMPOTENCY_CONFLICT", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      requireAuthenticatedUserMock.mockResolvedValue({
        ok: true,
        userId: "user-1",
        client: {},
      });

      createHiveViaEdgeMock.mockRejectedValueOnce(
        createHiveError({
          errorCode: "IDEMPOTENCY_CONFLICT",
          category: "PERSISTENCE",
          stage: "SHELL",
          retryable: false,
          safeMessage:
            "This create request ID was already used with different Hive details.",
          correlationId: CORRELATION_ID,
          diagnosticReason: "idempotency_conflict",
        }),
      );

      const { POST } = await import("./route");
      const res = await POST(
        new NextRequest("http://localhost/api/v1/hives", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": CORRELATION_ID,
          },
          body: JSON.stringify({
            name: "Conflicting Name",
            clientRequestId: CLIENT_REQ_ID,
          }),
        }),
      );
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body.error.errorCode).toBe("IDEMPOTENCY_CONFLICT");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("validates hiveId UUID parameter and returns 404 NOT_FOUND for cross-user Hive access", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      requireAuthenticatedUserMock.mockResolvedValue({
        ok: true,
        userId: "user-b",
        client: {},
      });

      const { GET: getHiveById } = await import("./[hiveId]/route");

      const badIdRes = await getHiveById(
        new NextRequest("http://localhost/api/v1/hives/not-a-uuid", {
          headers: { "x-correlation-id": CORRELATION_ID },
        }),
        { params: Promise.resolve({ hiveId: "not-a-uuid" }) },
      );
      expect(badIdRes.status).toBe(422);

      getHiveViaEdgeMock.mockRejectedValueOnce(
        createHiveError({
          errorCode: "NOT_FOUND",
          category: "SECURITY",
          stage: "SHELL",
          retryable: false,
          safeMessage: "We could not find that Hive.",
          correlationId: CORRELATION_ID,
          diagnosticReason: "not_found",
        }),
      );

      const notFoundRes = await getHiveById(
        new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}`, {
          headers: { "x-correlation-id": CORRELATION_ID },
        }),
        { params: Promise.resolve({ hiveId: HIVE_ID }) },
      );
      const notFoundBody = await notFoundRes.json();
      expect(notFoundRes.status).toBe(404);
      expect(notFoundBody.error.errorCode).toBe("NOT_FOUND");
    } finally {
      logSpy.mockRestore();
    }
  });
});
