import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

const { requireAuthenticatedUserMock, afterCallbacks } = vi.hoisted(() => ({
  requireAuthenticatedUserMock: vi.fn(),
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));
vi.mock("@/server/hives/hive-assistant-service", () => ({
  runHiveAssistantReply: vi.fn(),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterCallbacks.push(cb) };
});

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ hiveId: HIVE_ID }) };

describe("message channels", () => {
  const rpcMock = vi.fn();

  beforeEach(() => {
    afterCallbacks.length = 0;
    rpcMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      client: { rpc: rpcMock },
    });
  });

  it("triggers the assistant only for assistant-channel posts", async () => {
    const row = {
      id: "55555555-5555-4555-8555-555555555555",
      authorKind: "person",
      authorRole: "client",
      authorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authorDisplayName: "Client",
      authorRoleLabel: "Client",
      isMine: true,
      body: "Question",
      sourceRefs: [],
      replyToMessageId: null,
      handoffFromMessageId: null,
      createdAt: "2026-11-19T12:00:00.000Z",
    };
    rpcMock.mockResolvedValue({ data: { message: row, notifyUserIds: [], duplicate: false }, error: null });
    const req = new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "idempotency-key": "44444444-4444-4444-8444-444444444444" },
      body: JSON.stringify({ body: "Question", channel: "assistant" }),
    });
    await POST(req, context);
    expect(afterCallbacks).toHaveLength(1);
  });

  it("does not trigger the assistant for people-channel posts", async () => {
    const row = {
      id: "55555555-5555-4555-8555-555555555555",
      authorKind: "person",
      authorRole: "client",
      authorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authorDisplayName: "Client",
      authorRoleLabel: "Client",
      isMine: true,
      body: "Hello",
      sourceRefs: [],
      replyToMessageId: null,
      handoffFromMessageId: null,
      createdAt: "2026-11-19T12:00:00.000Z",
    };
    rpcMock.mockResolvedValue({ data: { message: row, notifyUserIds: [], duplicate: false }, error: null });
    const req = new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "idempotency-key": "44444444-4444-4444-8444-444444444444" },
      body: JSON.stringify({ body: "Hello", channel: "people" }),
    });
    await POST(req, context);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("passes channel and threadOwner on list", async () => {
    rpcMock.mockResolvedValue({
      data: { messages: [], participantRoleLabels: [], participantCount: 0, viewerLastReadAt: null, nextCursor: null },
      error: null,
    });
    const thread = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await GET(
      new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/messages?channel=assistant&threadOwner=${thread}`),
      context,
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "list_hive_messages",
      expect.objectContaining({ p_channel: "assistant", p_thread_owner: thread }),
    );
  });
});