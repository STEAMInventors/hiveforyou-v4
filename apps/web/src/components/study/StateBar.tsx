import type { StudyViewRow } from "@hiveforyou/contracts";

import { DISPLAY_STATES, type DisplayState, stateClass, statusToState } from "./StatusBadge";

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
      return `${n} ${n === 1 ? "needs" : "need"} you`;
    case "changed":
      return `${n} changed`;
    case "missing":
      return `${n} missing`;
    case "checked":
      return `${n} checked`;
  }
}

type StateBarProps = {
  counts: StateCounts;
  /** Section id each state links to. */
  targets: Readonly<Record<DisplayState, string>>;
  onNavigate?: (sectionId: string) => void;
};

export function StateBar({ counts, targets, onNavigate }: StateBarProps) {
  const shown = DISPLAY_STATES.filter((state) => counts[state] > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Summary of this study" data-testid="state-bar">
      {shown.map((state) => (
        <li key={state}>
          <a
            href={`#${targets[state]}`}
            className={`inline-flex min-h-[32px] items-center rounded-pill px-3 text-small font-semibold no-underline hover:underline max-sm:min-h-[44px] ${stateClass(state)}`}
            data-state={state}
            onClick={(event) => {
              if (!onNavigate) return;
              event.preventDefault();
              onNavigate(targets[state]);
            }}
          >
            {statePillText(state, counts[state])}
          </a>
        </li>
      ))}
    </ul>
  );
}
