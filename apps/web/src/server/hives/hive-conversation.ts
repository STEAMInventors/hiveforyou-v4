import { HIVE_MESSAGE_PAGE_SIZE, normalizeHiveMessagePage, type HiveMessagePage } from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CONVERSATION_LOAD_FAILED, mapConversationRpcError } from "./map-conversation-rpc-error";

export type HiveConversationLoad =
  | { ok: true; page: HiveMessagePage }
  | { ok: false; message: string; correlationId: string; retryable: boolean };

/** First page for the board. Failures become a safe message the card can show. */
export async function loadHiveConversation(
  client: SupabaseClient,
  hiveId: string,
  correlationId: string,
  options: { channel?: "people" | "assistant"; threadOwnerUserId?: string | null } = {},
): Promise<HiveConversationLoad> {
  const channel = options.channel ?? "people";
  try {
    const { data, error } = await client.rpc("list_hive_messages", {
      p_hive_id: hiveId,
      p_channel: channel,
      p_thread_owner: channel === "assistant" ? options.threadOwnerUserId ?? null : null,
      p_limit: HIVE_MESSAGE_PAGE_SIZE,
    });
    if (error) {
      const mapped = mapConversationRpcError(error, correlationId, CONVERSATION_LOAD_FAILED);
      return { ok: false, message: mapped.safeMessage, correlationId, retryable: mapped.retryable };
    }
    const page = normalizeHiveMessagePage(data);
    if (!page) return { ok: false, message: CONVERSATION_LOAD_FAILED, correlationId, retryable: true };
    return { ok: true, page };
  } catch {
    return { ok: false, message: CONVERSATION_LOAD_FAILED, correlationId, retryable: true };
  }
}

/** Rail badge. Null on any failure so the rail never shows a wrong number; null at 0 so it stays hidden. */
export async function loadUnreadMessageCount(client: SupabaseClient, hiveId: string): Promise<number | null> {
  try {
    const { data, error } = await client.rpc("hive_unread_message_count", { p_hive_id: hiveId });
    if (error || typeof data !== "number" || !Number.isInteger(data) || data < 0) return null;
    return data > 0 ? data : null;
  } catch {
    return null;
  }
}
