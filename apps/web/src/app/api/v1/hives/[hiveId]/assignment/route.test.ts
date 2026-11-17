import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthenticatedUserMock = vi.fn();

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const ASSIGNEE = "22222222-2222-4222-8222-222222222222";

const { POST: assignPost } = await import("./route");
const { POST: stagePost } = await import("../stage/route");

describe("POST /api/v1/hives/[hiveId]/assignment", () => {
  const rpcMock = vi.fn();

  beforeEach(() => {
    rpcMock.mockReset();
    requireAuthenticatedUserMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      userId: ASSIGNEE,
      client: { rpc: rpcMock },
    });
  });

  it("returns 200 when assign_hive reports no change (idempotent replay)", async () => {
    rpcMock.mockResolvedValue({
      data: { hiveId: HIVE_ID, assigneeUserId: ASSIGNEE, changed: false },
      error: null,
    });

    const response = await assignPost(
      new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/assignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
        body: JSON.stringify({ assigneeUserId: ASSIGNEE, note: "Same person" }),
      }),
      { params: Promise.resolve({ hiveId: HIVE_ID }) },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.changed).toBe(false);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe("assign_hive");
  });

  it("returns 200 on first assign when changed", async () => {
    rpcMock.mockResolvedValue({
      data: { hiveId: HIVE_ID, assigneeUserId: ASSIGNEE, changed: true },
      error: null,
    });

    const response = await assignPost(
      new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/assignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
        body: JSON.stringify({ assigneeUserId: ASSIGNEE, note: null }),
      }),
      { params: Promise.resolve({ hiveId: HIVE_ID }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(true);
  });
});

describe("POST /api/v1/hives/[hiveId]/stage idempotent", () => {
  const rpcMock = vi.fn();

  beforeEach(() => {
    rpcMock.mockReset();
    requireAuthenticatedUserMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      userId: ASSIGNEE,
      client: { rpc: rpcMock },
    });
  });

  it("returns unchanged when set_hive_stage reports changed false", async () => {
    rpcMock.mockResolvedValue({
      data: { hiveId: HIVE_ID, stage: "open", changed: false },
      error: null,
    });

    const response = await stagePost(
      new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
        body: JSON.stringify({ stage: "open" }),
      }),
      { params: Promise.resolve({ hiveId: HIVE_ID }) },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.changed).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith("set_hive_stage", {
      p_hive_id: HIVE_ID,
      p_stage: "open",
    });
  });
});