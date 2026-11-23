import type { Pack } from "../pipeline/pack-contracts";
import { normalizeGapTitle } from "../pipeline/gap-fill";

/** Mirrored in supabase/migrations/20261117100000_hive_checklist_and_requests.sql (hive.requests.state). */
export const REQUEST_STATES = [
  "WAITING",
  "RECEIVED",
  "READING",
  "CHECKED",
  "NEEDS_FIX",
  "DOESNT_MATCH",
  "NEEDS_REVIEW",
  "NOT_NEEDED",
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

/** Mirrored in supabase/migrations/20261117100000_hive_checklist_and_requests.sql (hive.request_checks.verdict). */
export const REQUEST_CHECK_VERDICTS = ["FITS", "WRONG_DOCUMENT", "WRONG_PERIOD", "UNSURE"] as const;
export type RequestCheckVerdict = (typeof REQUEST_CHECK_VERDICTS)[number];

export const STAFF_RESOLVE_ACTIONS = ["ACCEPT", "NOT_NEEDED", "ASK_AGAIN"] as const;
export type StaffResolveAction = (typeof STAFF_RESOLVE_ACTIONS)[number];

/** Mirrored in supabase/migrations/20261122100000_my_work_requests.sql (respond_to_request). */
export const CLIENT_REQUEST_RESPONSES = ["DONT_HAVE", "DOESNT_APPLY"] as const;
export type ClientRequestResponse = (typeof CLIENT_REQUEST_RESPONSES)[number];

export const REQUEST_EVENT_KINDS = ["state", "response", "reply"] as const;
export type RequestEventKind = (typeof REQUEST_EVENT_KINDS)[number];

export const MAX_REQUEST_NOTE_LENGTH = 1000;

export const MAX_CHECKLIST_ITEMS = 60;

export type PackChecklistItem = {
  key: string;
  title: string;
  detail: string | null;
  appliesWhen: string | null;
  position: number;
};

export type RequestDocumentSummary = {
  id: string;
  fileName: string;
  pageCount: number | null;
  createdAt: string;
  uploadedByDisplayName: string | null;
  uploadedByUserId?: string | null;
  addedAt?: string | null;
};

export type RequestPerson = {
  userId: string;
  displayName: string;
  roleKind: string | null;
  roleLabel: string | null;
};

export type RequestHistoryEvent = {
  id: string;
  kind: RequestEventKind;
  fromState: RequestState | null;
  toState: RequestState;
  response: ClientRequestResponse | null;
  note: string | null;
  actorKind: "person" | "system";
  actor: RequestPerson | null;
  messageId: string | null;
  createdAt: string;
};

export type RequestMessage = {
  id: string;
  body: string;
  author: RequestPerson | null;
  createdAt: string;
};

export type RequestCheck = {
  verdict: RequestCheckVerdict;
  sentence: string;
  pageRefs: unknown[];
};

export type RequestCheckSummary = RequestCheck;

export type RequestItem = {
  id: string;
  hiveId: string;
  source: "pack" | "staff";
  packRowKey: string | null;
  title: string;
  detail: string | null;
  position: number;
  state: RequestState;
  stateNote: string | null;
  acceptedBy: string | null;
  createdAt: string;
  updatedAt: string;
  documents: RequestDocumentSummary[];
  latestCheck: RequestCheckSummary | null;
  requestedBy?: RequestPerson | null;
  history?: RequestHistoryEvent[];
  messages?: RequestMessage[];
};

export function isClientRequestResponse(value: unknown): value is ClientRequestResponse {
  return typeof value === "string" && (CLIENT_REQUEST_RESPONSES as readonly string[]).includes(value);
}

export const MAX_REQUEST_REPLY_LENGTH = 4000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestAction =
  | { readonly action: "attach"; readonly sourceDocumentId: string }
  | { readonly action: "respond"; readonly response: ClientRequestResponse; readonly note: string | null }
  | { readonly action: "reply"; readonly body: string }
  | { readonly action: "resolve"; readonly resolution: StaffResolveAction; readonly note: string | null };

export type RequestActionField = "action" | "sourceDocumentId" | "response" | "note" | "body" | "resolution";

function optionalNote(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (trimmed.length > MAX_REQUEST_NOTE_LENGTH) return { ok: false };
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

/** Body of POST /api/v1/hives/{hiveId}/requests/{requestId}. */
export function parseRequestAction(
  raw: unknown,
): { ok: true; value: RequestAction } | { ok: false; field: RequestActionField } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, field: "action" };
  const row = raw as Record<string, unknown>;
  switch (row.action) {
    case "attach": {
      const id = typeof row.sourceDocumentId === "string" ? row.sourceDocumentId.trim().toLowerCase() : "";
      return UUID_PATTERN.test(id)
        ? { ok: true, value: { action: "attach", sourceDocumentId: id } }
        : { ok: false, field: "sourceDocumentId" };
    }
    case "respond": {
      if (!isClientRequestResponse(row.response)) return { ok: false, field: "response" };
      const note = optionalNote(row.note);
      return note.ok
        ? { ok: true, value: { action: "respond", response: row.response, note: note.value } }
        : { ok: false, field: "note" };
    }
    case "reply": {
      const body = typeof row.body === "string" ? row.body.trim() : "";
      return body.length >= 1 && body.length <= MAX_REQUEST_REPLY_LENGTH
        ? { ok: true, value: { action: "reply", body } }
        : { ok: false, field: "body" };
    }
    case "resolve": {
      if (!isStaffResolveAction(row.resolution)) return { ok: false, field: "resolution" };
      const note = optionalNote(row.note);
      return note.ok
        ? { ok: true, value: { action: "resolve", resolution: row.resolution, note: note.value } }
        : { ok: false, field: "note" };
    }
    default:
      return { ok: false, field: "action" };
  }
}

/** Body of POST /api/v1/hives/{hiveId}/requests (staff adds a request). */
export function parseAddRequest(
  raw: unknown,
): { ok: true; value: { title: string; detail: string | null } } | { ok: false; field: "title" | "detail" } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, field: "title" };
  const row = raw as Record<string, unknown>;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (title.length < 1 || title.length > 500) return { ok: false, field: "title" };
  const detail = optionalNote(row.detail);
  if (!detail.ok) return { ok: false, field: "detail" };
  return { ok: true, value: { title, detail: detail.value } };
}

export function isRequestState(value: unknown): value is RequestState {
  return typeof value === "string" && (REQUEST_STATES as readonly string[]).includes(value);
}

export function isRequestCheckVerdict(value: unknown): value is RequestCheckVerdict {
  return typeof value === "string" && (REQUEST_CHECK_VERDICTS as readonly string[]).includes(value);
}

export function isStaffResolveAction(value: unknown): value is StaffResolveAction {
  return typeof value === "string" && (STAFF_RESOLVE_ACTIONS as readonly string[]).includes(value);
}

export function normalizeRequestCheckSummary(raw: unknown): RequestCheck | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!isRequestCheckVerdict(row.verdict) || typeof row.sentence !== "string" || !Array.isArray(row.pageRefs)) {
    return null;
  }
  return { verdict: row.verdict, sentence: row.sentence, pageRefs: row.pageRefs };
}

export type ListRequestsResponse = {
  requests: RequestItem[];
  countsByState: Partial<Record<RequestState, number>>;
};

function normalizeRequestDocumentSummary(raw: unknown): RequestDocumentSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.fileName !== "string" || typeof row.createdAt !== "string") return null;
  return {
    id: row.id,
    fileName: row.fileName,
    pageCount: typeof row.pageCount === "number" ? row.pageCount : null,
    createdAt: row.createdAt,
    uploadedByDisplayName: typeof row.uploadedByDisplayName === "string" ? row.uploadedByDisplayName : null,
    uploadedByUserId: typeof row.uploadedByUserId === "string" ? row.uploadedByUserId : null,
    addedAt: typeof row.addedAt === "string" ? row.addedAt : null,
  };
}

function normalizeRequestPerson(raw: unknown): RequestPerson | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.userId !== "string" || typeof row.displayName !== "string") return null;
  return {
    userId: row.userId,
    displayName: row.displayName,
    roleKind: typeof row.roleKind === "string" ? row.roleKind : null,
    roleLabel: typeof row.roleLabel === "string" ? row.roleLabel : null,
  };
}

function normalizeRequestHistoryEvent(raw: unknown): RequestHistoryEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.createdAt !== "string" || !isRequestState(row.toState)) return null;
  const kind = (REQUEST_EVENT_KINDS as readonly unknown[]).includes(row.kind) ? (row.kind as RequestEventKind) : "state";
  return {
    id: row.id,
    kind,
    fromState: isRequestState(row.fromState) ? row.fromState : null,
    toState: row.toState,
    response: isClientRequestResponse(row.response) ? row.response : null,
    note: typeof row.note === "string" ? row.note : null,
    actorKind: row.actorKind === "system" ? "system" : "person",
    actor: normalizeRequestPerson(row.actor),
    messageId: typeof row.messageId === "string" ? row.messageId : null,
    createdAt: row.createdAt,
  };
}

function normalizeRequestMessage(raw: unknown): RequestMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.body !== "string" || typeof row.createdAt !== "string") return null;
  return { id: row.id, body: row.body, author: normalizeRequestPerson(row.author), createdAt: row.createdAt };
}

function normalizedList<T>(raw: unknown, normalize: (value: unknown) => T | null): T[] {
  return Array.isArray(raw) ? raw.map(normalize).filter((item): item is T => item !== null) : [];
}

export function normalizeRequestItem(raw: unknown): RequestItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.hiveId !== "string" ||
    typeof row.title !== "string" ||
    typeof row.position !== "number" ||
    !isRequestState(row.state)
  ) {
    return null;
  }
  const source = row.source === "pack" || row.source === "staff" ? row.source : null;
  if (!source) return null;
  const documents = Array.isArray(row.documents)
    ? row.documents.map(normalizeRequestDocumentSummary).filter((item): item is RequestDocumentSummary => item !== null)
    : [];
  return {
    id: row.id,
    hiveId: row.hiveId,
    source,
    packRowKey: typeof row.packRowKey === "string" ? row.packRowKey : null,
    title: row.title,
    detail: typeof row.detail === "string" ? row.detail : null,
    position: row.position,
    state: row.state,
    stateNote: typeof row.stateNote === "string" ? row.stateNote : null,
    acceptedBy: typeof row.acceptedBy === "string" ? row.acceptedBy : null,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
    documents,
    latestCheck: normalizeRequestCheckSummary(row.latestCheck),
    requestedBy: normalizeRequestPerson(row.requestedBy),
    history: normalizedList(row.history, normalizeRequestHistoryEvent),
    messages: normalizedList(row.messages, normalizeRequestMessage),
  };
}

export function normalizeListRequestsResponse(raw: unknown): ListRequestsResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const requests = Array.isArray(record.requests)
    ? record.requests.map(normalizeRequestItem).filter((item): item is RequestItem => item !== null)
    : [];
  const countsByState: Partial<Record<RequestState, number>> = {};
  if (record.countsByState && typeof record.countsByState === "object" && !Array.isArray(record.countsByState)) {
    for (const state of REQUEST_STATES) {
      const value = (record.countsByState as Record<string, unknown>)[state];
      if (typeof value === "number") countsByState[state] = value;
    }
  }
  return { requests, countsByState };
}

export function packChecklistItems(pack: Pack): PackChecklistItem[] {
  const items: PackChecklistItem[] = [];
  let position = 0;
  for (const row of pack.documentsUsuallyNeeded) {
    if (row.gapKind === "FUTURE_RECORD") continue;
    const title = row.document.replace(/\s+/g, " ").trim();
    if (title === "") continue;
    position += 1;
    items.push({
      key: normalizeGapTitle(title),
      title,
      detail: row.when.replace(/\s+/g, " ").trim() || null,
      appliesWhen: row.appliesWhen,
      position,
    });
  }
  return items;
}