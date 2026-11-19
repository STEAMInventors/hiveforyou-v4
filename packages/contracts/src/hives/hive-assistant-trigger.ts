import type { HiveMessage, HiveMessageAuthorRole } from "./hive-conversation";

const ASSISTANT_RUN_HOURLY_CAP = 20;

export type AssistantHiveFlags = {
  contentClass: "synthetic" | "real";
  assistantRepliesOn: boolean;
  firmId?: string | null;
};

export type AssistantTriggerInput = {
  hive: AssistantHiveFlags;
  message: Pick<HiveMessage, "body" | "authorKind">;
  authorRole: HiveMessageAuthorRole;
  assistantName: string;
  runsInLastHour: number;
};

function escapedAssistantName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function staffMessageAddressesAssistant(body: string, assistantName: string): boolean {
  const trimmed = body.trim();
  if (trimmed === "") return false;
  const pattern = new RegExp(`^(?:@${escapedAssistantName(assistantName)}\\b|${escapedAssistantName(assistantName)}\\b)`, "i");
  return pattern.test(trimmed);
}

export type AssistantSkipReason =
  | "not_synthetic"
  | "replies_off"
  | "not_eligible"
  | "assistant_author"
  | "rate_limited";

export function shouldTriggerHiveAssistant(
  input: AssistantTriggerInput,
): { trigger: boolean; skipReason?: AssistantSkipReason } {
  if (input.hive.contentClass !== "synthetic") return { trigger: false, skipReason: "not_synthetic" };
  if (!input.hive.assistantRepliesOn) return { trigger: false, skipReason: "replies_off" };
  if (input.message.authorKind === "assistant") return { trigger: false, skipReason: "assistant_author" };
  if (input.runsInLastHour >= ASSISTANT_RUN_HOURLY_CAP) return { trigger: true, skipReason: "rate_limited" };
  return { trigger: true };
}