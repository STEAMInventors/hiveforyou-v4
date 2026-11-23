"use client";

import { SEGMENTED_ON } from "@/components/ui/selection";

export type SegmentedOption<T extends string> = {
  id: T;
  label: string;
  count?: number | null;
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testId,
  size = "default",
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  testId?: string;
  /** `large` is the front page "who is this for" control (DESIGN §2 radius: 11, buttons 8). */
  size?: "default" | "large";
}) {
  const large = size === "large";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className={`inline-flex max-w-full overflow-x-auto [scrollbar-width:none] ${
        large ? "gap-1 rounded-[11px] bg-mist p-1" : "gap-0.5 rounded-[9px] bg-hover p-[3px]"
      }`}
    >
      {options.map((option) => {
        const pressed = value === option.id;
        const shape = large
          ? "h-10 rounded-[8px] px-4 text-[14px]"
          : "h-[30px] rounded-[7px] px-3 text-meta min-[900px]:h-[30px] max-[899px]:h-10";
        const tone = large ? "text-ink-3" : "text-ink-2";
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={pressed}
            className={`shrink-0 border-0 font-medium ${shape} ${
              pressed ? SEGMENTED_ON : `bg-transparent ${tone} hover:text-ink`
            }`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
            {option.count != null ? ` ${option.count}` : ""}
          </button>
        );
      })}
    </div>
  );
}
