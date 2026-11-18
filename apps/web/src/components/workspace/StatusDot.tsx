import { STATE_LABEL, type DisplayState } from "@/components/study/status-state";

const DOT_CLASS: Record<DisplayState, string> = {
  needs: "text-cell-blue-deep",
  missing: "text-coral-deep",
  changed: "text-honey-deep",
  checked: "text-leaf-deep",
};

export function StatusDot({ state, label }: { state: DisplayState; label?: string }) {
  const text = label ?? STATE_LABEL[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-caption font-semibold ${DOT_CLASS[state]}`} data-state={state}>
      <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-pill bg-current" />
      {text}
    </span>
  );
}