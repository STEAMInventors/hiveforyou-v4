import type { HiveMessage, HiveMessageAuthorRole } from "@hiveforyou/contracts";

/** Whose side the thread is drawn from. "client" is the staff-only Preview as Client. */
export type ConversationViewer = "self" | "client";

function timeOf(message: Pick<HiveMessage, "createdAt">): number {
  const ms = Date.parse(message.createdAt);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Oldest first; equal timestamps by id, matching the server's keyset order. */
export function compareMessages(left: HiveMessage, right: HiveMessage): number {
  const byTime = timeOf(left) - timeOf(right);
  if (byTime !== 0) return byTime;
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Union by id, later copies win, oldest first. */
export function mergeMessages(existing: readonly HiveMessage[], incoming: readonly HiveMessage[]): HiveMessage[] {
  const byId = new Map<string, HiveMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareMessages);
}

export function showsAsMine(message: HiveMessage, viewer: ConversationViewer): boolean {
  return viewer === "client" ? message.authorRole === "client" : message.isMine;
}

/** Id of the first message from someone else that is newer than the viewer's read mark. */
export function firstUnreadMessageId(messages: readonly HiveMessage[], lastReadAt: string | null): string | null {
  const mark = lastReadAt ? Date.parse(lastReadAt) : Number.NEGATIVE_INFINITY;
  const first = messages.find((message) => !message.isMine && timeOf(message) > mark);
  return first?.id ?? null;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function messageDayKey(createdAt: string): string {
  return localDayKey(new Date(createdAt));
}

/** "Today", "Yesterday", "Nov 12" (with the year when it is not this year). */
export function messageDayLabel(createdAt: string, now: Date): string {
  const date = new Date(createdAt);
  if (localDayKey(date) === localDayKey(now)) return "Today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (localDayKey(date) === localDayKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

/** "9:14 AM" */
export function messageTimeLabel(createdAt: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
    .format(new Date(createdAt))
    .replace(/\u202f/g, " ");
}

const AVATAR_CLASS: Record<HiveMessageAuthorRole, string> = {
  client: "bg-leaf-wash text-leaf-deep",
  staff: "bg-blue-wash text-blue-deep",
  owner: "bg-blue-wash text-blue-deep",
  professional: "bg-blue-wash text-blue-deep",
  former: "bg-blue-wash text-blue-deep",
  assistant: "bg-paper text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
};

export function avatarClassFor(role: HiveMessageAuthorRole): string {
  return AVATAR_CLASS[role];
}

/** Card sub-line: who is in this conversation. */
export function participantLine(
  labels: readonly string[],
  participantCount: number,
  assistantAvailable = false,
): string {
  if (labels.length === 0) return "Only you so far.";
  const hasAssistantLabel = labels.some((label) => label.includes("(AI assistant)"));
  if (participantCount <= 1 && !assistantAvailable && !hasAssistantLabel) return "Only you so far.";
  return labels.join(" · ");
}

/** Byline role, omitted when it would repeat the name. */
export function bylineRole(message: HiveMessage): string | null {
  const label = message.authorRoleLabel?.trim();
  if (!label || label === message.authorDisplayName) return null;
  return label;
}
