import type { Hive } from "@hiveforyou/contracts";

import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { personFirstName } from "@/lib/hives/firm-board";
import type { HiveChatConfig } from "@/lib/hive-chat-context";

const CHAT_LOAD_FAILED: ConversationLoad = {
  ok: false,
  message: "Could not load the conversation. Try again.",
  correlationId: null,
  retryable: true,
};

function isClientViewer(hive: Hive, staffView: boolean): boolean {
  return !staffView && hive.kind === "client" && Boolean(hive.firmId);
}

/** Chat provider input from hive workspace props — identical on server and first client render. */
export function buildHiveChatConfig(input: {
  hive: Hive;
  staffView: boolean;
  assigneeLabel: string | null;
  currentUserId: string | null;
  assistantName: string;
  initialAssistant: ConversationLoad;
  initialClientAssistant: ConversationLoad | null;
  documentCount: number | null;
  viewerDisplayName: string | null | undefined;
}): HiveChatConfig {
  const audience = isClientViewer(input.hive, input.staffView) ? "client" : "staff";
  return {
    hiveId: input.hive.id,
    assistantName: input.assistantName.trim() || "HiveForYou",
    audience,
    viewerFirstName: input.viewerDisplayName?.trim() ? personFirstName(input.viewerDisplayName) : null,
    staffFirstName: input.assigneeLabel ?? null,
    clientName: input.hive.kind === "client" ? input.hive.name : null,
    currentUserId: input.currentUserId,
    firmless: input.hive.firmId == null,
    firmId: input.hive.firmId ?? null,
    documentCount: input.documentCount,
    initialAssistant: input.initialAssistant,
    initialClientAssistant: input.initialClientAssistant ?? null,
  };
}

export function emptyHiveChatLoad(): ConversationLoad {
  return CHAT_LOAD_FAILED;
}