"use client";

import { DISPLAY_STATES, type DisplayState, stateClass } from "./status-state";
import { statePillText, type StateCounts } from "./state-counts";

export {
  countStates,
  spineRowState,
  statePillText,
  type StateCounts,
} from "./state-counts";

type StateBarProps = {
  counts: StateCounts;
  /** Section id each state links to. */
  targets: Readonly<Record<DisplayState, string>>;
  onNavigate?: (sectionId: string) => void;
  /** Page the section ids live on, when the bar sits on another page. */
  hrefBase?: string;
};

export function StateBar({ counts, targets, onNavigate, hrefBase = "" }: StateBarProps) {
  const shown = DISPLAY_STATES.filter((state) => counts[state] > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Summary of this study" data-testid="state-bar">
      {shown.map((state) => (
        <li key={state}>
          <a
            href={`${hrefBase}#${targets[state]}`}
            className={`inline-flex min-h-[32px] items-center rounded-pill px-3 text-small font-semibold no-underline hover:underline max-sm:min-h-[44px] ${stateClass(state)}${state === "checked" ? " opacity-80" : ""}`}
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