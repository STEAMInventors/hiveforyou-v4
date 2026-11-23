import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const { requireAuthenticatedUserMock, sendMock, getUserByIdMock } = vi.hoisted(() => ({
  requireAuthenticatedUserMock: vi.fn(),
  sendMock: vi.fn(),
  getUserByIdMock: vi.fn(),
}));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));
vi.mock("@/server/email", () => ({
  resolveEmailSender: () => ({ send: (...args: unknown[]) => sendMock(...args) }),
}));
vi.mock("@hives/persistence/env", () => ({ loadSupabaseAdminEnv: () => ({}) }));
vi.mock("@hives/persistence/storage/supabase-client", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { getUserById: (id: string) => getUserByIdMock(id) } } }),
}));

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const KEY = "55555555-5555-4555-8555-555555555555";
const STAFF_ID = "66666666-6666-4666-8666-666666666666";
const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

const LIST = {
  requests: [
    { id: REQUEST_ID, hiveId: HIVE_ID, source: "staff", title: "Pay stubs", position: 1, state: "WAITING", history: [], messages: [] },
  ],
  countsByState: { WAITING: 1 },
};

const context = (requestId = REQUEST_ID) => ({ params: Promise.resolve({ hiveId: HIVE_ID, requestId }) });

function post(body: unknown, key: string | null = null): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID };
  if (key) headers["idempotency-key"] = key;
  return new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/requests/${REQUEST_ID}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/hives/[hiveId]/requests/[requestId]", () => {
  const rpcMock = vi.fn();
  const priorSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockReset();
    sendMock.mockReset();
    sendMock.mockResolvedValue(undefined);
    getUserByIdMock.mockReset();
    getUserByIdMock.mockResolvedValue({ data: { user: { email: "pro@example.test" } }, error: null });
    requireAuthenticatedUserMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({ ok: true, userId: "client", client: { rpc: rpcMock } });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = priorSiteUrl;
    vi.restoreAllMocks();
  });

  function routes(action: { name: string; result: { data: unknown; error: unknown } }) {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "list_requests") return { data: LIST, error: null };
      if (name === "get_hive") return { data: { name: "Ortiz family" }, error: null };
      if (name === action.name) return action.result;
      throw new Error(`unexpected rpc ${name}`);
    });
  }

  it("records a client response and returns the refreshed list", async () => {
    routes({ name: "respond_to_request", result: { data: { state: "NEEDS_REVIEW", duplicate: false }, error: null } });
    const response = await POST(post({ action: "respond", response: "DONT_HAVE", note: "  Never filed  " }), context());
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("respond_to_request", {
      p_request_id: REQUEST_ID,
      p_response: "DONT_HAVE",
      p_note: "Never filed",
    });
    const json = await response.json();
    expect(json.requests[0].id).toBe(REQUEST_ID);
  });

  it("attaches an uploaded document", async () => {
    routes({ name: "attach_document_to_request", result: { data: { state: "RECEIVED" }, error: null } });
    const response = await POST(post({ action: "attach", sourceDocumentId: DOCUMENT_ID }), context());
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("attach_document_to_request", {
      p_request_id: REQUEST_ID,
      p_source_document_id: DOCUMENT_ID,
    });
  });

  it("sends a reply with the idempotency key and emails only the users the database names", async () => {
    routes({
      name: "reply_to_request",
      result: { data: { message: { id: "m1" }, notifyUserIds: [STAFF_ID], duplicate: false }, error: null },
    });
    const response = await POST(post({ action: "reply", body: "Sending tonight" }, KEY), context());
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("reply_to_request", {
      p_request_id: REQUEST_ID,
      p_body: "Sending tonight",
      p_client_request_id: KEY,
    });
    expect(getUserByIdMock).toHaveBeenCalledWith(STAFF_ID);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a reply without an idempotency key", async () => {
    routes({ name: "reply_to_request", result: { data: null, error: null } });
    const response = await POST(post({ action: "reply", body: "hi" }), context());
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalledWith("reply_to_request", expect.anything());
  });

  it("returns 404 for a request that is not in this hive without calling the action", async () => {
    routes({ name: "staff_resolve_request", result: { data: null, error: null } });
    const response = await POST(post({ action: "resolve", resolution: "ACCEPT" }), context(OTHER_REQUEST_ID));
    expect(response.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalledWith("staff_resolve_request", expect.anything());
  });

  it("maps a refused client resolution to 403 without leaking RPC text", async () => {
    routes({
      name: "staff_resolve_request",
      result: { data: null, error: { code: "42501", message: "access_denied secret detail" } },
    });
    const response = await POST(post({ action: "resolve", resolution: "NOT_NEEDED" }), context());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("secret detail");
  });

  it("maps a stale state to 409", async () => {
    routes({ name: "respond_to_request", result: { data: null, error: { code: "22023", message: "invalid_transition" } } });
    const response = await POST(post({ action: "respond", response: "DOESNT_APPLY" }), context());
    expect(response.status).toBe(409);
  });

  it("rejects an unknown action and an unknown response", async () => {
    routes({ name: "respond_to_request", result: { data: null, error: null } });
    expect((await POST(post({ action: "delete" }), context())).status).toBe(400);
    expect((await POST(post({ action: "respond", response: "MAYBE" }), context())).status).toBe(400);
  });

  it("requires sign-in", async () => {
    requireAuthenticatedUserMock.mockResolvedValue({ ok: false, diagnosticReason: "no_session" });
    const response = await POST(post({ action: "respond", response: "DONT_HAVE" }), context());
    expect(response.status).toBe(401);
  });
});
