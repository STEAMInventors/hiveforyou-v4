import type { HiveMessage } from "@hiveforyou/contracts";
import type { ReactNode } from "react";
import { vi } from "vitest";

import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { OmniCatalogProvider } from "@/components/ui/omni-catalog";
import { HiveChatProvider, type HiveChatConfig } from "@/lib/hive-chat-context";

export const HIVE_ID = "11111111-1111-4111-8111-111111111111";
export const STAFF_ID = "22222222-2222-4222-8222-222222222222";
export const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
export const FIRM_ID = "44444444-4444-4444-8444-444444444444";

let counter = 0;
export function uuid(): string {
  counter += 1;
  return `c0a80101-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

export function personMessage(body: string, over: Partial<HiveMessage> = {}): HiveMessage {
  return {
    id: uuid(),
    body,
    authorKind: "person",
    authorRole: "staff",
    authorUserId: STAFF_ID,
    authorDisplayName: "Priya Shah",
    authorRoleLabel: "Staff",
    createdAt: "2026-11-18T14:05:00.123456+00:00",
    isMine: true,
    sourceRefs: [],
    replyToMessageId: null,
    ...over,
  } as HiveMessage;
}

export function assistantMessage(body: string, triggerMessageId: string, over: Partial<HiveMessage> = {}): HiveMessage {
  return {
    id: uuid(),
    body,
    authorKind: "assistant",
    authorRole: "assistant",
    authorUserId: null,
    authorDisplayName: "Rowan",
    authorRoleLabel: "AI assistant",
    triggerMessageId,
    createdAt: "2026-11-18T14:05:05.123456+00:00",
    isMine: false,
    sourceRefs: [],
    replyToMessageId: null,
    handoffFromMessageId: null,
    ...over,
  } as HiveMessage;
}

export function loadOf(
  messages: HiveMessage[],
  extra: Record<string, unknown> = {},
): ConversationLoad {
  return {
    ok: true,
    page: {
      messages,
      participantRoleLabels: [],
      participantCount: 1,
      viewerLastReadAt: null,
      nextCursor: null,
      pendingAssistant: false,
      assistantAvailable: true,
      assistantRepliesOn: true,
      ...extra,
    } as never,
  };
}

export function chatConfig(over: Partial<HiveChatConfig> = {}): HiveChatConfig {
  return {
    hiveId: HIVE_ID,
    assistantName: "Rowan",
    audience: "staff",
    viewerFirstName: "Priya",
    staffFirstName: "Priya Shah",
    clientName: "Dana Ellis",
    currentUserId: STAFF_ID,
    firmless: false,
    firmId: FIRM_ID,
    documentCount: 4,
    initialAssistant: loadOf([]),
    initialClientAssistant: null,
    ...over,
  };
}

export function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } };
}

export type RecordedPost = { channel: string; body: string; handoffFrom: string | null; threadOwner: string | null };

/** A fake messages API: GET returns the thread, POST appends to it. Records every post. */
export function installChatFetch(initial: HiveMessage[] = [], options: { failPostsWith?: Record<string, unknown> } = {}) {
  const state = { messages: [...initial], posts: [] as RecordedPost[], gets: [] as string[] };
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (init?.method === "POST") {
      const payload = JSON.parse(String(init.body)) as { body: string; channel: string; handoffFrom?: string };
      state.posts.push({
        channel: payload.channel,
        body: payload.body,
        handoffFrom: payload.handoffFrom ?? null,
        threadOwner: null,
      });
      if (options.failPostsWith) return jsonResponse(options.failPostsWith, 500);
      const message = personMessage(payload.body);
      if (payload.channel === "assistant") state.messages.push(message);
      return jsonResponse({ message, duplicate: false });
    }
    state.gets.push(href);
    return jsonResponse({
      messages: state.messages,
      participantRoleLabels: [],
      participantCount: 1,
      viewerLastReadAt: null,
      nextCursor: null,
      pendingAssistant: false,
      assistantAvailable: true,
      assistantRepliesOn: true,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, state };
}

/** Stubs matchMedia so `(min-width: Npx)` matches when the pretend viewport is at least N wide. */
export function stubViewport(width: number) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min ? width >= Number(min[1]) : false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        onchange: null,
        dispatchEvent: () => false,
      };
    },
  );
}

export function ChatWrap({ config, children }: { config: HiveChatConfig | null; children: ReactNode }) {
  return (
    <OmniCatalogProvider>
      <HiveChatProvider config={config}>{children}</HiveChatProvider>
    </OmniCatalogProvider>
  );
}

export const PUBLIC_ERROR = (retryable: boolean) => ({
  error: { errorCode: "internal", message: "Could not send right now.", correlationId: "abcd1234-0000-4000-8000-000000000000", retryable },
});
