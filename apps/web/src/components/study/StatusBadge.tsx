export const DISPLAY_STATES = ["needs", "changed", "missing", "checked"] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

export const STATE_LABEL: Record<DisplayState, string> = {
  needs: "Needs you",
  changed: "Changed",
  missing: "Missing",
  checked: "Checked",
};

const STATE_FROM_STATUS: Readonly<Record<string, DisplayState>> = {
  CONFLICTED: "needs",
  OPEN: "needs",
  SUPERSEDED: "changed",
  UPDATED: "changed",
  CURRENT: "changed",
  GAP: "missing",
  UNSUPPORTED: "missing",
  UNREADABLE: "missing",
  SUPPORTED: "checked",
};

/**
 * The one mapping from internal statuses to what people see. A supported value that a later
 * fact updates is shown as changed. Unknown or missing statuses get no state.
 */
export function statusToState(status: string | null | undefined, options: { updated?: boolean } = {}): DisplayState | null {
  const state = status ? STATE_FROM_STATUS[status.trim().toUpperCase()] : undefined;
  if (!state) return null;
  return state === "checked" && options.updated ? "changed" : state;
}

const STATE_CLASS: Record<DisplayState, string> = {
  needs: "bg-needs-bg text-needs-fg",
  changed: "bg-changed-bg text-changed-fg",
  missing: "bg-missing-bg text-missing-fg",
  checked: "bg-checked-bg text-checked-fg",
};

export function stateClass(state: DisplayState): string {
  return STATE_CLASS[state];
}

const BADGE_CLASS = "inline-flex shrink-0 items-center whitespace-nowrap rounded-pill px-2.5 py-[3px] text-caption font-semibold";

/** `neutral` is for work in progress, which has no brand state. */
export function StatusBadge({ state, label }: { state: DisplayState | "neutral"; label?: string }) {
  return (
    <span
      className={`${BADGE_CLASS} ${state === "neutral" ? "border border-line bg-mist text-graphite" : STATE_CLASS[state]}`}
      data-state={state}
    >
      {label ?? (state === "neutral" ? "" : STATE_LABEL[state])}
    </span>
  );
}
