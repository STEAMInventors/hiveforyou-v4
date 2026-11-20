"use client";

import { StatusDot } from "@/components/ui/StatusDot";
import { useWorkspaceChrome } from "@/components/workspace/workspace-context";

import {
  DISPLAY_STATES,
  type DisplayState,
  STATE_LABEL,
  stateClass,
  statusToState,
} from "./status-state";

export { DISPLAY_STATES, type DisplayState, STATE_LABEL, stateClass, statusToState };

const BADGE_CLASS = "inline-flex shrink-0 items-center whitespace-nowrap rounded-pill px-2.5 py-[3px] text-caption font-semibold";

/** `neutral` is for work in progress, which has no brand state. */
export function StatusBadge({ state, label }: { state: DisplayState | "neutral"; label?: string }) {
  const workspace = useWorkspaceChrome();
  if (workspace && state !== "neutral") {
    return <StatusDot state={state} label={label} />;
  }
  return (
    <span
      className={`${BADGE_CLASS} ${state === "neutral" ? "border border-line bg-mist text-graphite" : stateClass(state)}`}
      data-state={state}
    >
      {label ?? (state === "neutral" ? "" : STATE_LABEL[state])}
    </span>
  );
}