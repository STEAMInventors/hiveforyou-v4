import { STATE_LABEL, type DisplayState } from "@/components/study/status-state";

const WORD_CLASS: Record<string, string> = {
  needs: "text-blue-deep",
  missing: "text-coral-deep",
  changed: "text-honey-deep",
  checked: "text-leaf-deep",
  uncertain: "text-honey-deep",
  duplicate: "text-honey-deep",
  received: "text-leaf-deep",
  grey: "text-ink-3",
};

const EXTRA_LABEL: Record<string, string> = {
  uncertain: "Uncertain",
  duplicate: "Duplicate",
  received: "Received",
  grey: "Not read yet",
};

const HONEY_DOT = new Set(["changed", "uncertain", "duplicate"]);

export type StatusDotState = DisplayState | "uncertain" | "duplicate" | "received" | "grey";

export type StatusDotProps = {
  state: StatusDotState;
  label?: string;
};

export function StatusDot({ state, label }: StatusDotProps) {
  const isCore = state === "needs" || state === "missing" || state === "changed" || state === "checked";
  const text = label ?? (isCore ? STATE_LABEL[state] : EXTRA_LABEL[state]);
  const honeyDot = HONEY_DOT.has(state);
  return (
    <span className={`inline-flex items-center gap-[7px] whitespace-nowrap text-[12.5px] font-semibold ${WORD_CLASS[state]}`} data-state={state}>
      <span
        aria-hidden
        className={`inline-block h-[7px] w-[7px] rounded-full ${honeyDot ? "bg-honey shadow-[0_0_0_1px_var(--ink-ring)]" : "bg-current"}`}
      />
      {text}
    </span>
  );
}
