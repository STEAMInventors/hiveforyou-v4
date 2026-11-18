import type { HiveBoardChecklistItem, HiveBoardProgress } from "./hive-board";
import type { RequestItem, RequestState } from "./hive-request-contracts";

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