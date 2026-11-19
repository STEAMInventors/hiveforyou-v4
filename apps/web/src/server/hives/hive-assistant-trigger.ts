import type { HiveMessage, HiveMessageAuthorRole } from "@hiveforyou/contracts";

const ASSISTANT_RUN_HOURLY_CAP = 20;

export type AssistantHiveFlags = {
  contentClass: "synthetic" | "real";
  assistantRepliesOn: boolean;
  firmId?: string | null;
};

export type AssistantTriggerInput = {
  hive: AssistantHiveFlags;
  message: HiveMessage;
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

export function shouldTriggerHiveAssistant(input: AssistantTriggerInput): { trigger: boolean; skipReason?: string } {
  if (input.hive.contentClass !== "synthetic") return { trigger: false };
  if (!input.hive.assistantRepliesOn) return { trigger: false };
  if (input.message.authorKind === "assistant") return { trigger: false };
  let eligible = false;
  if (input.authorRole === "client") eligible = true;
  else if (input.authorRole === "owner" && input.hive.firmId == null) eligible = true;
  else if (
    (input.authorRole === "staff" || input.authorRole === "owner") &&
    staffMessageAddressesAssistant(input.message.body, input.assistantName)
  ) {
    eligible = true;
  }
  if (!eligible) return { trigger: false };
  if (input.runsInLastHour >= ASSISTANT_RUN_HOURLY_CAP) return { trigger: true, skipReason: "rate_limited" };
  return { trigger: true };
}