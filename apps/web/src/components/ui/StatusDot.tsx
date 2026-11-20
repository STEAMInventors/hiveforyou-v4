import { STATE_LABEL, type DisplayState } from "@/components/study/status-state";

const DOT_CLASS: Record<DisplayState, string> = {
  needs: "text-blue-deep",
  missing: "text-coral-deep",
  changed: "text-honey-deep",
  checked: "text-leaf-deep",
};

export type StatusDotProps = {
  state: DisplayState | "uncertain" | "duplicate" | "grey";
  label?: string;
};

const EXTRA_LABEL: Record<string, string> = {
  uncertain: "Uncertain",
  duplicate: "Duplicate",
  grey: "Not read yet",
};

const EXTRA_CLASS: Record<string, string> = {
  uncertain: "text-honey-deep",
  duplicate: "text-honey-deep",
  grey: "text-ink-3",
};

export function StatusDot({ state, label }: StatusDotProps) {
  const isCore = state === "needs" || state === "missing" || state === "changed" || state === "checked";
  const text = label ?? (isCore ? STATE_LABEL[state] : EXTRA_LABEL[state]);
  const tone = isCore ? DOT_CLASS[state] : EXTRA_CLASS[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-meta font-semibold ${tone}`} data-state={state}>
      <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-pill bg-current" />
      {text}
    </span>
  );
}