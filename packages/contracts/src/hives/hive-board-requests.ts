import type { HiveBoardChecklistItem, HiveBoardProgress } from "./hive-board";
import type {
  ClientRequestResponse,
  RequestDocumentSummary,
  RequestHistoryEvent,
  RequestItem,
  RequestMessage,
  RequestState,
} from "./hive-request-contracts";

const REQUEST_STATUS_TEXT: Partial<Record<RequestState, string>> = {
  WAITING: "Waiting",
  RECEIVED: "Received",
  READING: "Reading…",
  CHECKED: "Checked",
  NEEDS_FIX: "Needs a fix",
  DOESNT_MATCH: "Doesn't match",
  NEEDS_REVIEW: "Needs review",
  NOT_NEEDED: "Not needed",
};

function requestChecklistStatus(state: RequestState): HiveBoardChecklistItem["status"] {
  if (state === "CHECKED" || state === "NOT_NEEDED") return "in";
  if (state === "RECEIVED" || state === "READING") return "added_pending";
  return "not_in";
}

export function buildHiveBoardChecklistFromRequests(
  requests: readonly RequestItem[],
  documentsPath: string,
): { checklist: HiveBoardChecklistItem[]; progress: HiveBoardProgress | null; checklistNote: string } {
  if (requests.length === 0) {
    return { checklist: [], progress: null, checklistNote: "From what the documents refer to or usually include." };
  }
  const active = requests.filter((row) => row.state !== "NOT_NEEDED");
  const checklist: HiveBoardChecklistItem[] = active.map((row) => {
    const status = requestChecklistStatus(row.state);
    const statusText = row.stateNote?.trim() || REQUEST_STATUS_TEXT[row.state] || row.state;
    return {
      gapId: row.id,
      title: row.title,
      status,
      statusText,
      action:
        status === "not_in"
          ? { kind: "link", label: "Add it", href: documentsPath }
          : { kind: "link", label: "View", href: documentsPath },
    };
  });
  const total = checklist.length;
  const inCount = checklist.filter((row) => row.status === "in" || row.status === "added_pending").length;
  return {
    checklist,
    progress: { in: inCount, total, segments: checklist.map((row) => row.status) },
    checklistNote: `${inCount} of ${total} in, from the starting checklist.`,
  };
}

// ---------------------------------------------------------------------------
// My Work & Pro Requests (D-059): grouping from persisted request state only.
// ---------------------------------------------------------------------------

export type MyWorkViewer = "client" | "staff";
export type MyWorkGroupKey = "waiting_on_me" | "waiting_on_other" | "done";
export type MyWorkAction = "upload" | "respond" | "reply" | "accept" | "not_needed" | "ask_again";

export type MyWorkHistoryLine = {
  readonly id: string;
  readonly at: string;
  readonly actorName: string;
  readonly text: string;
  readonly note: string | null;
};

export type MyWorkRequest = {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  readonly state: RequestState;
  readonly group: MyWorkGroupKey;
  readonly statusText: string;
  readonly stateNote: string | null;
  readonly requesterName: string;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly documents: readonly RequestDocumentSummary[];
  readonly messages: readonly RequestMessage[];
  readonly history: readonly MyWorkHistoryLine[];
  readonly actions: readonly MyWorkAction[];
};

export type MyWorkActivityLine = {
  readonly id: string;
  readonly at: string;
  readonly requestId: string;
  readonly text: string;
};

export type MyWorkGroup = {
  readonly key: MyWorkGroupKey;
  readonly label: string;
  readonly requests: readonly MyWorkRequest[];
};

export type MyWorkModel = {
  readonly viewer: MyWorkViewer;
  readonly groups: readonly MyWorkGroup[];
  /** The viewer's own recorded actions and uploads, newest first. */
  readonly myActivity: readonly MyWorkActivityLine[];
};

const CLIENT_SIDE_STATES: ReadonlySet<RequestState> = new Set(["WAITING", "NEEDS_FIX", "DOESNT_MATCH"]);
const DONE_STATES: ReadonlySet<RequestState> = new Set(["CHECKED", "NOT_NEEDED"]);

const RESPONSE_TEXT: Record<ClientRequestResponse, { mine: string; theirs: string }> = {
  DONT_HAVE: { mine: "You said you don't have it", theirs: "Client says they don't have it" },
  DOESNT_APPLY: { mine: "You said it doesn't apply", theirs: "Client says it doesn't apply" },
};

function groupFor(state: RequestState, viewer: MyWorkViewer): MyWorkGroupKey {
  if (DONE_STATES.has(state)) return "done";
  if (CLIENT_SIDE_STATES.has(state)) return viewer === "client" ? "waiting_on_me" : "waiting_on_other";
  return viewer === "client" ? "waiting_on_other" : "waiting_on_me";
}

function latestResponse(history: readonly RequestHistoryEvent[]): RequestHistoryEvent | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index]!;
    if (event.kind === "response") return event;
    if (event.kind === "state") return null;
  }
  return null;
}

function statusText(item: RequestItem, viewer: MyWorkViewer): string {
  if (item.state === "NEEDS_REVIEW") {
    const response = latestResponse(item.history ?? []);
    if (response?.response) return RESPONSE_TEXT[response.response][viewer === "client" ? "mine" : "theirs"];
  }
  if (item.state === "WAITING" && (item.history ?? []).some((event) => event.kind === "state" && event.fromState)) {
    return "Asked again";
  }
  return REQUEST_STATUS_TEXT[item.state] ?? item.state;
}

function actionsFor(item: RequestItem, group: MyWorkGroupKey, viewer: MyWorkViewer): MyWorkAction[] {
  if (viewer === "client") {
    if (group === "waiting_on_me") return ["upload", "reply", "respond"];
    if (group === "waiting_on_other") return item.state === "NEEDS_REVIEW" ? ["reply"] : ["upload", "reply"];
    return ["reply"];
  }
  if (group === "waiting_on_me") {
    return item.documents.length > 0
      ? ["accept", "ask_again", "not_needed", "reply"]
      : ["ask_again", "not_needed", "reply"];
  }
  if (group === "waiting_on_other") return ["not_needed", "reply"];
  return ["ask_again", "reply"];
}

function actorName(event: RequestHistoryEvent, viewerUserId: string): string {
  if (event.actorKind === "system") return "HiveForYou";
  if (event.actor && event.actor.userId.toLowerCase() === viewerUserId.toLowerCase()) return "You";
  return event.actor?.displayName ?? "Former member";
}

function historyText(event: RequestHistoryEvent, byViewer: boolean): string {
  if (event.kind === "reply") return "replied";
  if (event.kind === "response") {
    if (event.response === "DOESNT_APPLY") return "said it doesn't apply";
    return byViewer ? "said you don't have it" : "said they don't have it";
  }
  switch (event.toState) {
    case "WAITING":
      return event.fromState ? "asked again" : "requested this";
    case "RECEIVED":
      return "added a document";
    case "READING":
      return "started checking the document";
    case "CHECKED":
      return event.actorKind === "system" ? "checked the document" : "accepted it";
    case "NOT_NEEDED":
      return "marked it not needed";
    case "NEEDS_FIX":
      return "found the document needs a fix";
    case "DOESNT_MATCH":
      return "found the document doesn't match";
    case "NEEDS_REVIEW":
      return "flagged it for review";
  }
}

function historyLines(item: RequestItem, viewerUserId: string): MyWorkHistoryLine[] {
  const messages = new Map((item.messages ?? []).map((message) => [message.id, message]));
  return (item.history ?? []).map((event) => ({
    id: event.id,
    at: event.createdAt,
    actorName: actorName(event, viewerUserId),
    text: historyText(event, event.actorKind === "person" && isMine(event.actor?.userId, viewerUserId)),
    note: event.kind === "reply" ? (event.messageId ? messages.get(event.messageId)?.body ?? null : null) : event.note,
  }));
}

function completedAt(item: RequestItem): string | null {
  if (!DONE_STATES.has(item.state)) return null;
  const history = item.history ?? [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index]!;
    if (event.kind === "state" && DONE_STATES.has(event.toState)) return event.createdAt;
  }
  return item.updatedAt || null;
}

function requesterName(item: RequestItem, viewerUserId: string): string {
  const person = item.requestedBy;
  if (person && person.userId.toLowerCase() === viewerUserId.toLowerCase()) return "You";
  if (person) return person.displayName;
  return item.source === "pack" ? "Starting checklist" : "Former member";
}

function isMine(userId: string | null | undefined, viewerUserId: string): boolean {
  return !!userId && userId.toLowerCase() === viewerUserId.toLowerCase();
}

function myActivity(requests: readonly RequestItem[], viewerUserId: string): MyWorkActivityLine[] {
  const lines: MyWorkActivityLine[] = [];
  for (const item of requests) {
    for (const event of item.history ?? []) {
      if (event.actorKind !== "person" || !isMine(event.actor?.userId, viewerUserId)) continue;
      if (event.kind === "state" && event.toState === "RECEIVED") continue;
      lines.push({ id: event.id, at: event.createdAt, requestId: item.id, text: `You ${historyText(event, true)}: ${item.title}` });
    }
    for (const document of item.documents) {
      if (!isMine(document.uploadedByUserId, viewerUserId)) continue;
      lines.push({
        id: `${item.id}:${document.id}`,
        at: document.addedAt ?? document.createdAt,
        requestId: item.id,
        text: `You uploaded ${document.fileName} for ${item.title}`,
      });
    }
  }
  return lines.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

const GROUP_LABELS: Record<MyWorkViewer, Record<MyWorkGroupKey, string>> = {
  client: { waiting_on_me: "Waiting on me", waiting_on_other: "Waiting on Pro", done: "What I've done" },
  staff: { waiting_on_me: "Waiting on me", waiting_on_other: "Waiting on client", done: "Done" },
};

/** Groups requests for one viewer; the only inputs are stored request state, history and documents. */
export function buildMyWorkModel(
  requests: readonly RequestItem[],
  viewer: MyWorkViewer,
  viewerUserId: string,
): MyWorkModel {
  const built = requests.map((item): MyWorkRequest => {
    const group = groupFor(item.state, viewer);
    return {
      id: item.id,
      title: item.title,
      detail: item.detail,
      state: item.state,
      group,
      statusText: statusText(item, viewer),
      stateNote: item.stateNote,
      requesterName: requesterName(item, viewerUserId),
      requestedAt: item.createdAt,
      completedAt: completedAt(item),
      documents: item.documents,
      messages: item.messages ?? [],
      history: historyLines(item, viewerUserId),
      actions: actionsFor(item, group, viewer),
    };
  });

  const order: MyWorkGroupKey[] = viewer === "client"
    ? ["done", "waiting_on_me", "waiting_on_other"]
    : ["waiting_on_me", "waiting_on_other", "done"];
  const groups = order.map((key) => {
    const rows = built.filter((row) => row.group === key);
    if (key === "done") {
      rows.sort((left, right) => Date.parse(right.completedAt ?? "") - Date.parse(left.completedAt ?? "") || 0);
    }
    return { key, label: GROUP_LABELS[viewer][key], requests: rows };
  });

  return { viewer, groups, myActivity: myActivity(requests, viewerUserId) };
}