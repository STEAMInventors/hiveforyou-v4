import type { StudyViewRow } from "@hiveforyou/contracts";

import { type DisplayState, statusToState } from "./status-state";

export type StateCounts = Readonly<Record<DisplayState, number>>;

export function spineRowState(row: StudyViewRow): DisplayState | null {
  return statusToState(row.status, { updated: row.values.some((value) => value.relation === "updating") });
}

/**
 * Counts from the canonical study, identical for every audience: each spine element in its state,
 * plus everything the missing list shows.
 */
export function countStates(spineRows: readonly StudyViewRow[], missingItems: number): StateCounts {
  const counts: Record<DisplayState, number> = { needs: 0, changed: 0, missing: missingItems, checked: 0 };
  for (const row of spineRows) {
    const state = spineRowState(row);
    if (state) counts[state] += 1;
  }
  return counts;
}

export function statePillText(state: DisplayState, n: number): string {
  switch (state) {
    case "needs":
      return `${n} ${n === 1 ? "issue" : "issues"} to resolve`;
    case "missing":
      return `${n} ${n === 1 ? "document would help" : "documents would help"} complete this review`;
    case "changed":
      return `${n} ${n === 1 ? "change" : "changes"} from the original`;
    case "checked":
      return `${n} ${n === 1 ? "fact" : "facts"} confirmed`;
  }
}