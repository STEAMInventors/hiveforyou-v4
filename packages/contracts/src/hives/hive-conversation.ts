import { isValidUuid } from "./hive-contracts";

export const HIVE_MESSAGE_BODY_MAX = 4000;
/** The composer shows a character counter from this length. */
export const HIVE_MESSAGE_COUNTER_FROM = 3500;
export const HIVE_MESSAGE_PAGE_SIZE = 50;

export type HiveMessageAuthorKind = "person" | "assistant";

/** Who wrote a message, from the hive's point of view. Drives avatar colour and Preview as. */
export type HiveMessageAuthorRole = "client" | "staff" | "owner" | "professional" | "assistant" | "former";

export type HiveMessageSourceRef = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly shortLabel?: string;
  readonly factId?: string;
  readonly studyRevisionId?: string;
  readonly itemKey?: string;
};

export type HiveMessageChannel = "people" | "assistant";

export type HiveAssistantThreadSummary = {
  readonly userId: string;
  readonly displayName: string;
  readonly roleLabel: string;
  readonly messageCount: number;
  readonly lastAt: string | null;
};

export type HiveMessage = {
  readonly id: string;
  readonly authorKind: HiveMessageAuthorKind;
  readonly authorRole: HiveMessageAuthorRole;
  readonly authorUserId: string | null;
  readonly authorDisplayName: string;
  readonly authorRoleLabel: string | null;
  readonly isMine: boolean;
  readonly body: string;
  readonly sourceRefs: readonly HiveMessageSourceRef[];
  readonly replyToMessageId: string | null;
  readonly handoffFromMessageId?: string | null;
  readonly triggerMessageId?: string | null;
  readonly assistantRunStatus?: string | null;
  /** Database timestamp as returned; kept as text so cursors and read marks keep full precision. */
  readonly createdAt: string;
};

export type HiveMessageCursor = {
  readonly beforeCreatedAt: string;
  readonly beforeId: string;
};

export type HiveMessagePage = {
  /** Newest first. */
  readonly messages: readonly HiveMessage[];
  readonly participantRoleLabels: readonly string[];
  readonly participantCount: number;
  readonly viewerLastReadAt: string | null;
  readonly nextCursor: HiveMessageCursor | null;
  readonly pendingAssistant?: boolean;
  readonly assistantRepliesOn?: boolean;
  readonly assistantAvailable?: boolean;
  readonly failedAssistantForMessageIds?: readonly string[];
  readonly assistantName?: string;
  readonly assistantThreads?: readonly HiveAssistantThreadSummary[];
  readonly threadOwnerUserId?: string;
};

export type PostHiveMessageRequest = {
  readonly body: string;
  readonly replyTo?: string | null;
  readonly channel?: HiveMessageChannel;
  readonly handoffFrom?: string | null;
};

/** What the API returns to the browser. */
export type PostHiveMessageResponse = {
  readonly message: HiveMessage;
  readonly duplicate: boolean;
};

/** What the database returns to the server. `notifyUserIds` never leaves the server. */
export type PostHiveMessageResult = PostHiveMessageResponse & {
  readonly notifyUserIds: readonly string[];
};

export type MarkHiveMessagesReadResponse = {
  readonly lastReadAt: string;
};

const AUTHOR_KINDS = new Set<HiveMessageAuthorKind>(["person", "assistant"]);
const AUTHOR_ROLES = new Set<HiveMessageAuthorRole>(["client", "staff", "owner", "professional", "assistant", "former"]);

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && isValidUuid(value.trim())) return value.trim().toLowerCase();
  return undefined;
}

function normalizeSourceRefs(raw: unknown): HiveMessageSourceRef[] {
  if (!Array.isArray(raw)) return [];
  const refs: HiveMessageSourceRef[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const itemKey = typeof record.itemKey === "string" ? record.itemKey.trim() : "";
    if (itemKey) {
      refs.push({ sourceDocumentId: "", pageNumber: 0, itemKey });
      continue;
    }
    const sourceDocumentId = typeof record.sourceDocumentId === "string" ? record.sourceDocumentId.trim() : "";
    const pageNumber = record.pageNumber;
    const shortLabel = typeof record.shortLabel === "string" ? record.shortLabel.trim() : "";
    const factId = typeof record.factId === "string" ? record.factId.trim() : "";
    const studyRevisionId =
      typeof record.studyRevisionId === "string" && isValidUuid(record.studyRevisionId.trim())
        ? record.studyRevisionId.trim().toLowerCase()
        : "";
    if (!isValidUuid(sourceDocumentId) || typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1) {
      continue;
    }
    refs.push({
      sourceDocumentId: sourceDocumentId.toLowerCase(),
      pageNumber,
      ...(shortLabel ? { shortLabel } : {}),
      ...(factId ? { factId } : {}),
      ...(studyRevisionId ? { studyRevisionId } : {}),
    });
  }
  return refs;
}

export function normalizeHiveMessage(raw: unknown): HiveMessage | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = optionalUuid(record.id);
  const authorKind = typeof record.authorKind === "string" ? record.authorKind : "";
  const authorRole = typeof record.authorRole === "string" ? record.authorRole : "";
  const authorUserId = optionalUuid(record.authorUserId);
  const replyToMessageId = optionalUuid(record.replyToMessageId);
  const body = typeof record.body === "string" ? record.body : "";
  const authorDisplayName = typeof record.authorDisplayName === "string" ? record.authorDisplayName.trim() : "";
  if (
    !id ||
    !AUTHOR_KINDS.has(authorKind as HiveMessageAuthorKind) ||
    !AUTHOR_ROLES.has(authorRole as HiveMessageAuthorRole) ||
    authorUserId === undefined ||
    replyToMessageId === undefined ||
    body.length === 0 ||
    !authorDisplayName ||
    !isTimestamp(record.createdAt)
  ) {
    return null;
  }
  const roleLabel = typeof record.authorRoleLabel === "string" ? record.authorRoleLabel.trim() : "";
  const handoffFromMessageId = optionalUuid(record.handoffFromMessageId);
  const triggerMessageId = optionalUuid(record.triggerMessageId);
  const assistantRunStatus =
    typeof record.assistantRunStatus === "string" ? record.assistantRunStatus.trim() : null;
  if (handoffFromMessageId === undefined || triggerMessageId === undefined) return null;
  return {
    id,
    authorKind: authorKind as HiveMessageAuthorKind,
    authorRole: authorRole as HiveMessageAuthorRole,
    authorUserId,
    authorDisplayName,
    authorRoleLabel: roleLabel || null,
    isMine: record.isMine === true,
    body,
    sourceRefs: normalizeSourceRefs(record.sourceRefs),
    replyToMessageId,
    handoffFromMessageId,
    ...(triggerMessageId ? { triggerMessageId } : {}),
    ...(assistantRunStatus ? { assistantRunStatus } : {}),
    createdAt: record.createdAt,
  };
}

function normalizeCursor(raw: unknown): HiveMessageCursor | null | undefined {
  if (raw === null || raw === undefined) return null;
  const record = asRecord(raw);
  if (!record) return undefined;
  const beforeId = optionalUuid(record.beforeId);
  if (!beforeId || !isTimestamp(record.beforeCreatedAt)) return undefined;
  return { beforeCreatedAt: record.beforeCreatedAt, beforeId };
}

export function normalizeHiveMessagePage(raw: unknown): HiveMessagePage | null {
  const record = asRecord(raw);
  if (!record || !Array.isArray(record.messages) || !Array.isArray(record.participantRoleLabels)) return null;
  const messages: HiveMessage[] = [];
  for (const item of record.messages) {
    const message = normalizeHiveMessage(item);
    if (!message) return null;
    messages.push(message);
  }
  const participantRoleLabels = record.participantRoleLabels
    .filter((label): label is string => typeof label === "string")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  const participantCount =
    typeof record.participantCount === "number" && Number.isInteger(record.participantCount) && record.participantCount >= 0
      ? record.participantCount
      : null;
  const nextCursor = normalizeCursor(record.nextCursor);
  const viewerLastReadAt =
    record.viewerLastReadAt === null || record.viewerLastReadAt === undefined
      ? null
      : isTimestamp(record.viewerLastReadAt)
        ? record.viewerLastReadAt
        : undefined;
  if (participantCount === null || nextCursor === undefined || viewerLastReadAt === undefined) return null;
  const pendingAssistant = record.pendingAssistant === true ? true : record.pendingAssistant === false ? false : undefined;
  const assistantRepliesOn =
    record.assistantRepliesOn === true ? true : record.assistantRepliesOn === false ? false : undefined;
  const assistantAvailable =
    record.assistantAvailable === true ? true : record.assistantAvailable === false ? false : undefined;
  const assistantName = typeof record.assistantName === "string" ? record.assistantName.trim() : undefined;
  const failedAssistantForMessageIds = Array.isArray(record.failedAssistantForMessageIds)
    ? record.failedAssistantForMessageIds
        .map((id) => (typeof id === "string" && isValidUuid(id.trim()) ? id.trim().toLowerCase() : null))
        .filter((id): id is string => id !== null)
    : undefined;
  const assistantThreads = Array.isArray(record.assistantThreads)
    ? record.assistantThreads
        .map((raw) => {
          const thread = asRecord(raw);
          if (!thread) return null;
          const userId = optionalUuid(thread.userId);
          const displayName = typeof thread.displayName === "string" ? thread.displayName.trim() : "";
          const roleLabel = typeof thread.roleLabel === "string" ? thread.roleLabel.trim() : "";
          const messageCount =
            typeof thread.messageCount === "number" &&
            Number.isInteger(thread.messageCount) &&
            thread.messageCount >= 0
              ? thread.messageCount
              : null;
          const lastAt =
            thread.lastAt === null || thread.lastAt === undefined
              ? null
              : isTimestamp(thread.lastAt)
                ? thread.lastAt
                : undefined;
          if (!userId || !displayName || !roleLabel || messageCount === null || lastAt === undefined) return null;
          return { userId, displayName, roleLabel, messageCount, lastAt };
        })
        .filter((row): row is HiveAssistantThreadSummary => row !== null)
    : undefined;
  const threadOwnerUserId =
    typeof record.threadOwnerUserId === "string" && isValidUuid(record.threadOwnerUserId.trim())
      ? record.threadOwnerUserId.trim().toLowerCase()
      : undefined;
  return {
    messages,
    participantRoleLabels,
    participantCount,
    viewerLastReadAt,
    nextCursor,
    ...(pendingAssistant !== undefined ? { pendingAssistant } : {}),
    ...(assistantRepliesOn !== undefined ? { assistantRepliesOn } : {}),
    ...(assistantAvailable !== undefined ? { assistantAvailable } : {}),
    ...(failedAssistantForMessageIds ? { failedAssistantForMessageIds } : {}),
    ...(assistantName ? { assistantName } : {}),
    ...(assistantThreads ? { assistantThreads } : {}),
    ...(threadOwnerUserId ? { threadOwnerUserId } : {}),
  };
}

export function normalizePostHiveMessageResult(raw: unknown): PostHiveMessageResult | null {
  const record = asRecord(raw);
  if (!record || typeof record.duplicate !== "boolean" || !Array.isArray(record.notifyUserIds)) return null;
  const message = normalizeHiveMessage(record.message);
  if (!message) return null;
  const notifyUserIds: string[] = [];
  for (const id of record.notifyUserIds) {
    const parsed = optionalUuid(id);
    if (!parsed) return null;
    notifyUserIds.push(parsed);
  }
  return { message, duplicate: record.duplicate, notifyUserIds };
}

export function normalizePostHiveMessageResponse(raw: unknown): PostHiveMessageResponse | null {
  const record = asRecord(raw);
  if (!record || typeof record.duplicate !== "boolean") return null;
  const message = normalizeHiveMessage(record.message);
  return message ? { message, duplicate: record.duplicate } : null;
}

export type ParsedPostHiveMessageRequest =
  | { ok: true; value: { body: string; replyTo: string | null; channel: HiveMessageChannel; handoffFrom: string | null } }
  | { ok: false; field: "body" | "replyTo" | "channel" | "handoffFrom" };

export function parsePostHiveMessageRequest(raw: unknown): ParsedPostHiveMessageRequest {
  const record = asRecord(raw);
  const body = typeof record?.body === "string" ? record.body.trim() : "";
  if (body.length < 1 || body.length > HIVE_MESSAGE_BODY_MAX) return { ok: false, field: "body" };
  const replyTo = optionalUuid(record?.replyTo);
  if (replyTo === undefined) return { ok: false, field: "replyTo" };
  const channelRaw = typeof record?.channel === "string" ? record.channel.trim().toLowerCase() : "people";
  const channel = channelRaw === "assistant" ? "assistant" : channelRaw === "people" ? "people" : null;
  if (!channel) return { ok: false, field: "channel" };
  const handoffFrom = optionalUuid(record?.handoffFrom);
  if (handoffFrom === undefined) return { ok: false, field: "handoffFrom" };
  return { ok: true, value: { body, replyTo, channel, handoffFrom } };
}

/** Up to two initials from a display name, for the avatar square. */
export function hiveMessageInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return letters.map((word) => word!.charAt(0).toUpperCase()).join("") || "?";
}
