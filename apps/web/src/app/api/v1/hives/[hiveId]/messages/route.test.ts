import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

const { requireAuthenticatedUserMock, sendMock, getUserByIdMock, processHiveAssistantReplySafelyMock } = vi.hoisted(() => ({
  requireAuthenticatedUserMock: vi.fn(),
  sendMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  processHiveAssistantReplySafelyMock: vi.fn(),
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
vi.mock("@/server/hives/hive-assistant-service", () => ({
  processHiveAssistantReplySafely: (...args: unknown[]) => processHiveAssistantReplySafelyMock(...args),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => void) => callback() };
});

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const KEY = "44444444-4444-4444-8444-444444444444";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET_BODY = "Synthetic note about the lease renewal on Maple Street";

const ROW = {
  id: "55555555-5555-4555-8555-555555555555",
  authorKind: "person",
  authorRole: "staff",
  authorUserId: "66666666-6666-4666-8666-666666666666",
  authorDisplayName: "Jordan Lee",
  authorRoleLabel: "Onboarding associate",
  isMine: true,
  body: SECRET_BODY,
  sourceRefs: [],
  replyToMessageId: null,
  createdAt: "2026-11-18T14:05:00.123456+00:00",
};

const PAGE = {
  messages: [ROW],
  participantRoleLabels: ["Client", "Onboarding associate"],
  participantCount: 2,
  viewerLastReadAt: null,
  nextCursor: null,
};

const context = { params: Promise.resolve({ hiveId: HIVE_ID }) };

function postRequest(body: unknown, key: string | null = KEY): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID };
  if (key) headers["idempotency-key"] = key;
  return new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function getRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/messages${query}`, {
    headers: { "x-correlation-id": CORRELATION_ID },
  });
}

describe("/api/v1/hives/[hiveId]/messages", () => {
  const rpcMock = vi.fn();
  let logSpy: ReturnType<typeof vi.spyOn>;
  const priorSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockReset();
    sendMock.mockReset();
    getUserByIdMock.mockReset();
    requireAuthenticatedUserMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({ ok: true, userId: ROW.authorUserId, client: { rpc: rpcMock } });
    sendMock.mockResolvedValue(undefined);
    getUserByIdMock.mockImplementation(async (id: string) => ({
      data: { user: { email: `${id.slice(0, 4)}@example.test` } },
      error: null,
    }));
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = priorSiteUrl;
    processHiveAssistantReplySafelyMock.mockReset();
    vi.restoreAllMocks();
  });

  function rpcRoutes(post: { data: unknown; error: unknown }) {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "post_hive_message") return post;
      if (name === "get_hive") return { data: { id: HIVE_ID, name: "Ortiz family" }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
  }

  it("posts with the Idempotency-Key as the client request id and emails only notifyUserIds", async () => {
    rpcRoutes({ data: { message: ROW, notifyUserIds: [USER_A, USER_B], duplicate: false }, error: null });
    const response = await POST(postRequest({ body: `  ${SECRET_BODY}  ` }), context);

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json).toEqual({ message: expect.objectContaining({ id: ROW.id, body: SECRET_BODY }), duplicate: false });
    expect(json).not.toHaveProperty("notifyUserIds");
    expect(rpcMock).toHaveBeenCalledWith("post_hive_message", {
      p_hive_id: HIVE_ID,
      p_body: SECRET_BODY,
      p_client_request_id: KEY,
      p_reply_to: null,
    });

    expect(getUserByIdMock.mock.calls.map((call) => call[0]).sort()).toEqual([USER_A, USER_B].sort());
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(processHiveAssistantReplySafelyMock).toHaveBeenCalledWith({
      hiveId: HIVE_ID,
      triggerMessage: expect.objectContaining({ id: ROW.id, body: SECRET_BODY }),
      authorRole: ROW.authorRole,
      correlationId: CORRELATION_ID,
      userClient: expect.objectContaining({ rpc: rpcMock }),
    });

    for (const [mail] of sendMock.mock.calls as [{ to: string; subject: string; text: string; html: string }][]) {
      expect(mail.subject).toBe("New message in your hive");
      expect(mail.text).toContain("There's a new message in Ortiz family.");
      expect(mail.text).toContain(`https://app.example.test/hives/${HIVE_ID}/board`);
      expect(mail.html).toContain("Open the conversation");
      expect(mail.html).toContain(`https://app.example.test/hives/${HIVE_ID}/board`);
      for (const part of [mail.subject, mail.text, mail.html]) {
        expect(part).not.toContain("Maple Street");
        expect(part).not.toContain("lease");
        expect(part).not.toContain("Jordan");
      }
    }
  });

  it("sends nothing on a duplicate replay and returns 200", async () => {
    rpcRoutes({ data: { message: ROW, notifyUserIds: [], duplicate: true }, error: null });
    const response = await POST(postRequest({ body: SECRET_BODY }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).duplicate).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it("sends nothing when nobody is due a notice", async () => {
    rpcRoutes({ data: { message: ROW, notifyUserIds: [], duplicate: false }, error: null });
    const response = await POST(postRequest({ body: SECRET_BODY }), context);
    expect(response.status).toBe(201);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("still succeeds when an email fails, and logs a count without addresses or text", async () => {
    rpcRoutes({ data: { message: ROW, notifyUserIds: [USER_A, USER_B], duplicate: false }, error: null });
    sendMock.mockRejectedValueOnce(new Error("resend down"));
    const response = await POST(postRequest({ body: SECRET_BODY }), context);
    expect(response.status).toBe(201);

    const logged = logSpy.mock.calls.map((call) => String(call[0]));
    const notice = logged.find((line) => line.includes("hive.message.notice_failed"));
    expect(notice).toBeDefined();
    const event = JSON.parse(notice!);
    expect(event).toMatchObject({ correlationId: CORRELATION_ID, totalCount: 1 });
    const allLogs = logged.join("\n");
    expect(allLogs).not.toContain("@example.test");
    expect(allLogs).not.toContain("Maple Street");
  });

  it("rejects a missing or malformed Idempotency-Key before calling the database", async () => {
    for (const key of [null, "not-a-uuid"]) {
      const response = await POST(postRequest({ body: "Hello" }, key), context);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error.retryable).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an empty or too-long body with the field message", async () => {
    for (const body of ["   ", "x".repeat(4001)]) {
      const response = await POST(postRequest({ body }), context);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error.retryable).toBe(false);
      expect(json.error.message).toMatch(/message/i);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "42501", message: "hive_not_found" }, 404, false, "We could not find that hive."],
    [{ code: "22023", message: "invalid_request:body" }, 400, false, null],
    [{ code: "22023", message: "invalid_request:reply_to" }, 400, false, null],
    [{ code: "23505", message: "idempotency_conflict" }, 409, false, null],
    [
      { code: "P0001", message: "rate_limited" },
      429,
      true,
      "You're sending messages quickly. Wait a moment and try again.",
    ],
    [{ code: "XX000", message: "connection reset by peer at 10.0.0.4" }, 503, true, "Could not send right now. Try again."],
  ])("maps %o to %i", async (error, status, retryable, message) => {
    rpcRoutes({ data: null, error });
    const response = await POST(postRequest({ body: "Hello" }), context);
    expect(response.status).toBe(status);
    const json = await response.json();
    expect(json.error.retryable).toBe(retryable);
    if (message) expect(json.error.message).toBe(message);
    expect(json.error.message).not.toContain(error.message);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    requireAuthenticatedUserMock.mockResolvedValue({ ok: false, diagnosticReason: "no_session" });
    expect((await POST(postRequest({ body: "Hello" }), context)).status).toBe(401);
    expect((await GET(getRequest(), context)).status).toBe(401);
  });

  it("returns 404 for a malformed hive id", async () => {
    const response = await GET(getRequest(), { params: Promise.resolve({ hiveId: "nope" }) });
    expect(response.status).toBe(404);
  });

  it("lists the newest page and passes the keyset cursor", async () => {
    rpcMock.mockResolvedValue({ data: PAGE, error: null });
    const first = await GET(getRequest(), context);
    expect(first.status).toBe(200);
    expect((await first.json()).messages[0].id).toBe(ROW.id);
    expect(rpcMock).toHaveBeenLastCalledWith("list_hive_messages", {
      p_hive_id: HIVE_ID,
      p_before_created_at: null,
      p_before_id: null,
      p_limit: 50,
    });

    const before = encodeURIComponent(ROW.createdAt);
    await GET(getRequest(`?before=${before}&beforeId=${ROW.id}`), context);
    expect(rpcMock).toHaveBeenLastCalledWith("list_hive_messages", {
      p_hive_id: HIVE_ID,
      p_before_created_at: ROW.createdAt,
      p_before_id: ROW.id,
      p_limit: 50,
    });
  });

  it("rejects a malformed cursor and maps list failures", async () => {
    expect((await GET(getRequest("?before=yesterday"), context)).status).toBe(400);
    expect((await GET(getRequest(`?before=${encodeURIComponent(ROW.createdAt)}&beforeId=x`), context)).status).toBe(400);

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "hive_not_found" } });
    expect((await GET(getRequest(), context)).status).toBe(404);

    rpcMock.mockResolvedValue({ data: null, error: { code: "08006", message: "boom" } });
    const failed = await GET(getRequest(), context);
    expect(failed.status).toBe(503);
    const json = await failed.json();
    expect(json.error.retryable).toBe(true);
    expect(json.error.message).toBe("Could not load the conversation. Try again.");
  });
});
