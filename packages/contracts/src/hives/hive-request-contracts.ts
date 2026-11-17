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