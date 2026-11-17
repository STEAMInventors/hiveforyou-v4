import type { Hive } from "@hiveforyou/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthenticatedUserMock = vi.fn();
const getHiveViaEdgeMock = vi.fn();
const requestCorrelationIdMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));

vi.mock("@/server/hives/hive-edge-gateway", () => ({
  getHiveViaEdge: (...args: unknown[]) => getHiveViaEdgeMock(...args),
}));

vi.mock("@/server/auth/action-support", () => ({
  requestCorrelationId: () => requestCorrelationIdMock(),
}));

import { loadOwnedHiveOrNotFound } from "./load-owned-hive";

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const CORR = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const RETURN_PATH = `/hives/${HIVE_ID}/board`;

const hive: Hive = {
  id: HIVE_ID,
  hiveId: HIVE_ID,
  name: "Ruth Ortiz",
  description: null,
  kind: "client",
  clientRequestId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("loadOwnedHiveOrNotFound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestCorrelationIdMock.mockResolvedValue(CORR);
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      client: {},
    });
    getHiveViaEdgeMock.mockResolvedValue({ hive });
  });

  it("redirects to sign-in with next when unauthenticated", async () => {
    requireAuthenticatedUserMock.mockResolvedValue({ ok: false, diagnosticReason: "no_session" });

    await expect(loadOwnedHiveOrNotFound(HIVE_ID, RETURN_PATH)).rejects.toThrow(
      `REDIRECT:/sign-in?next=${encodeURIComponent(RETURN_PATH)}`,
    );
    expect(getHiveViaEdgeMock).not.toHaveBeenCalled();
  });

  it("calls notFound on invalid uuid", async () => {
    await expect(loadOwnedHiveOrNotFound("not-a-uuid", RETURN_PATH)).rejects.toThrow("NOT_FOUND");
    expect(requireAuthenticatedUserMock).not.toHaveBeenCalled();
  });

  it.each(["NOT_FOUND", "ACCESS_DENIED", "INVALID_REQUEST"] as const)(
    "calls notFound when edge returns %s",
    async (errorCode) => {
      getHiveViaEdgeMock.mockRejectedValue({ errorCode });
      await expect(loadOwnedHiveOrNotFound(HIVE_ID, RETURN_PATH)).rejects.toThrow("NOT_FOUND");
    },
  );

  it("redirects when edge reports UNAUTHENTICATED", async () => {
    getHiveViaEdgeMock.mockRejectedValue({ errorCode: "UNAUTHENTICATED" });
    await expect(loadOwnedHiveOrNotFound(HIVE_ID, RETURN_PATH)).rejects.toThrow(
      `REDIRECT:/sign-in?next=${encodeURIComponent(RETURN_PATH)}`,
    );
  });

  it("returns the hive when load succeeds", async () => {
    const result = await loadOwnedHiveOrNotFound(HIVE_ID, RETURN_PATH);
    expect(result).toEqual(hive);
    expect(getHiveViaEdgeMock).toHaveBeenCalledWith({}, HIVE_ID, CORR);
  });
});