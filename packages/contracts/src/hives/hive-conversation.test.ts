import { describe, expect, it } from "vitest";

import {
  HIVE_MESSAGE_BODY_MAX,
  hiveMessageInitials,
  normalizeHiveMessage,
  normalizeHiveMessagePage,
  normalizePostHiveMessageResponse,
  normalizePostHiveMessageResult,
  parsePostHiveMessageRequest,
} from "./hive-conversation";

const MESSAGE_ID = "c0a80101-0000-4000-8000-0000000000aa";
const USER_ID = "c0a80101-0000-4000-8000-000000000001";
const DOC_ID = "c0a80101-0000-4000-8000-0000000000e1";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MESSAGE_ID,
    authorKind: "person",
    authorRole: "client",
    authorUserId: USER_ID,
    authorDisplayName: "Ruth Ortiz",
    authorRoleLabel: "Client",
    isMine: false,
    body: "Hello\nthere",
    sourceRefs: [],
    replyToMessageId: null,
    createdAt: "2026-11-18T14:05:00.123456+00:00",
    ...overrides,
  };
}

describe("normalizeHiveMessage", () => {
  it("keeps a valid row and the full-precision timestamp", () => {
    const message = normalizeHiveMessage(row());
    expect(message).toEqual({
      id: MESSAGE_ID,
      authorKind: "person",
      authorRole: "client",
      authorUserId: USER_ID,
      authorDisplayName: "Ruth Ortiz",
      authorRoleLabel: "Client",
      isMine: false,
      body: "Hello\nthere",
      sourceRefs: [],
      replyToMessageId: null,
      handoffFromMessageId: null,
      createdAt: "2026-11-18T14:05:00.123456+00:00",
    });
  });

  it("accepts assistant rows without a user and keeps valid source refs only", () => {
    const message = normalizeHiveMessage(
      row({
        authorKind: "assistant",
        authorRole: "assistant",
        authorUserId: null,
        authorDisplayName: "Sam",
        authorRoleLabel: "Sam",
        sourceRefs: [{ sourceDocumentId: DOC_ID, pageNumber: 2 }, { sourceDocumentId: "x", pageNumber: 1 }, { pageNumber: 0 }],
      }),
    );
    expect(message?.authorUserId).toBeNull();
    expect(message?.sourceRefs).toEqual([{ sourceDocumentId: DOC_ID, pageNumber: 2 }]);
  });

  it("reads a former member with no role label", () => {
    const message = normalizeHiveMessage(
      row({ authorRole: "former", authorUserId: null, authorDisplayName: "Former member", authorRoleLabel: null }),
    );
    expect(message?.authorDisplayName).toBe("Former member");
    expect(message?.authorRoleLabel).toBeNull();
  });

  it.each([
    ["bad id", { id: "nope" }],
    ["unknown kind", { authorKind: "bot" }],
    ["unknown role", { authorRole: "admin" }],
    ["bad user id", { authorUserId: "nope" }],
    ["empty body", { body: "" }],
    ["missing name", { authorDisplayName: " " }],
    ["bad timestamp", { createdAt: "yesterday" }],
  ])("rejects %s", (_label, overrides) => {
    expect(normalizeHiveMessage(row(overrides))).toBeNull();
  });
});

describe("normalizeHiveMessagePage", () => {
  const page = {
    messages: [row()],
    participantRoleLabels: ["Client", " Onboarding associate ", ""],
    participantCount: 2,
    viewerLastReadAt: "2026-11-18T14:00:00+00:00",
    nextCursor: { beforeCreatedAt: "2026-11-18T14:05:00.123456+00:00", beforeId: MESSAGE_ID },
  };

  it("parses a page with a cursor", () => {
    const parsed = normalizeHiveMessagePage(page);
    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.participantRoleLabels).toEqual(["Client", "Onboarding associate"]);
    expect(parsed?.nextCursor).toEqual({ beforeCreatedAt: "2026-11-18T14:05:00.123456+00:00", beforeId: MESSAGE_ID });
  });

  it("accepts an empty first page with no read mark", () => {
    expect(
      normalizeHiveMessagePage({ messages: [], participantRoleLabels: ["Owner"], participantCount: 1, viewerLastReadAt: null, nextCursor: null }),
    ).toEqual({ messages: [], participantRoleLabels: ["Owner"], participantCount: 1, viewerLastReadAt: null, nextCursor: null });
  });

  it("rejects a page with one bad row, a bad cursor or a missing count", () => {
    expect(normalizeHiveMessagePage({ ...page, messages: [row(), row({ id: "x" })] })).toBeNull();
    expect(normalizeHiveMessagePage({ ...page, nextCursor: { beforeId: MESSAGE_ID } })).toBeNull();
    expect(normalizeHiveMessagePage({ ...page, participantCount: undefined })).toBeNull();
    expect(normalizeHiveMessagePage(null)).toBeNull();
  });
});

describe("post results", () => {
  it("keeps notify ids on the server result and drops them from the response", () => {
    const raw = { message: row(), duplicate: false, notifyUserIds: [USER_ID] };
    expect(normalizePostHiveMessageResult(raw)?.notifyUserIds).toEqual([USER_ID]);
    const response = normalizePostHiveMessageResponse(raw);
    expect(response).toEqual({ message: normalizeHiveMessage(row()), duplicate: false });
    expect(response && "notifyUserIds" in response).toBe(false);
  });

  it("rejects malformed results", () => {
    expect(normalizePostHiveMessageResult({ message: row(), duplicate: "no", notifyUserIds: [] })).toBeNull();
    expect(normalizePostHiveMessageResult({ message: row(), duplicate: false, notifyUserIds: ["x"] })).toBeNull();
    expect(normalizePostHiveMessageResult({ message: {}, duplicate: false, notifyUserIds: [] })).toBeNull();
  });
});

describe("parsePostHiveMessageRequest", () => {
  it("trims the body and accepts an optional reply", () => {
    expect(parsePostHiveMessageRequest({ body: "  hi  " })).toEqual({
      ok: true,
      value: { body: "hi", replyTo: null, channel: "people", handoffFrom: null },
    });
    expect(parsePostHiveMessageRequest({ body: "hi", replyTo: MESSAGE_ID.toUpperCase() })).toEqual({
      ok: true,
      value: { body: "hi", replyTo: MESSAGE_ID, channel: "people", handoffFrom: null },
    });
  });

  it("rejects empty, too long and bad reply", () => {
    expect(parsePostHiveMessageRequest({ body: "   " })).toEqual({ ok: false, field: "body" });
    expect(parsePostHiveMessageRequest({ body: "a".repeat(HIVE_MESSAGE_BODY_MAX + 1) })).toEqual({ ok: false, field: "body" });
    expect(parsePostHiveMessageRequest({ body: "a".repeat(HIVE_MESSAGE_BODY_MAX) }).ok).toBe(true);
    expect(parsePostHiveMessageRequest({ body: "hi", replyTo: "nope" })).toEqual({ ok: false, field: "replyTo" });
    expect(parsePostHiveMessageRequest(null)).toEqual({ ok: false, field: "body" });
  });
});

describe("hiveMessageInitials", () => {
  it("uses first and last word", () => {
    expect(hiveMessageInitials("Ruth Ortiz")).toBe("RO");
    expect(hiveMessageInitials("Maria de la Cruz")).toBe("MC");
    expect(hiveMessageInitials("Sam")).toBe("S");
    expect(hiveMessageInitials("  ")).toBe("?");
  });
});
