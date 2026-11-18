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

export const MAX_CHECKLIST_ITEMS = 60;

export type PackChecklistItem = {
  key: string;
  title: string;
  detail: string | null;
  position: number;
};

export type RequestDocumentSummary = {
  id: string;
  fileName: string;
  pageCount: number | null;
  createdAt: string;
  uploadedByDisplayName: string | null;
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
};

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
  };
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
      position,
    });
  }
  return items;
}