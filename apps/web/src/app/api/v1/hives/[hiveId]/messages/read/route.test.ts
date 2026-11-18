import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const { requireAuthenticatedUserMock } = vi.hoisted(() => ({ requireAuthenticatedUserMock: vi.fn() }));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const UP_TO = "2026-11-18T14:05:00.123456+00:00";
const context = { params: Promise.resolve({ hiveId: HIVE_ID }) };

function request(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/messages/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": "2eb8421a-b784-4bf8-ac2b-540299b61d13" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/hives/[hiveId]/messages/read", () => {
  const rpcMock = vi.fn();

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    rpcMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({ ok: true, userId: "u", client: { rpc: rpcMock } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks read up to the given time", async () => {
    rpcMock.mockResolvedValue({ data: { lastReadAt: UP_TO }, error: null });
    const response = await POST(request({ upTo: UP_TO }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lastReadAt: UP_TO });
    expect(rpcMock).toHaveBeenCalledWith("mark_hive_messages_read", { p_hive_id: HIVE_ID, p_up_to: UP_TO });
  });

  it("rejects a missing or malformed upTo", async () => {
    for (const body of [{}, { upTo: "soon" }, { upTo: 12 }]) {
      expect((await POST(request(body), context)).status).toBe(400);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps no access to 404 and other failures to 503", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "hive_not_found" } });
    expect((await POST(request({ upTo: UP_TO }), context)).status).toBe(404);
    rpcMock.mockResolvedValue({ data: null, error: { code: "08006", message: "boom" } });
    const failed = await POST(request({ upTo: UP_TO }), context);
    expect(failed.status).toBe(503);
    expect((await failed.json()).error.message).not.toContain("boom");
  });
});
