export const DISPLAY_STATES = ["needs", "missing", "changed", "checked"] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

/** Short labels for inline row badges; summary chips use {@link statePillText} instead. */
export const STATE_LABEL: Record<DisplayState, string> = {
  needs: "To review",
  missing: "Missing",
  changed: "Changed",
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