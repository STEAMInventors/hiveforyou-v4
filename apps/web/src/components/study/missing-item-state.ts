import type { StudyViewRow } from "@hiveforyou/contracts";

import { type DisplayState, statusToState } from "./status-state";

function conflictItemState(row: StudyViewRow): DisplayState {
  return (
    statusToState(row.status, {
      updated: row.values.some((value) => value.relation === "updating"),
    }) ?? "needs"
  );
}

export function missingItemStateForConflict(row: StudyViewRow): DisplayState {
  return conflictItemState(row);
}

export function missingItemStateForRequest(kind: "now" | "later"): DisplayState {
  return kind === "later" ? "missing" : "needs";
}