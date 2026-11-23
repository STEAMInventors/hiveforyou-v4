"use client";

import type { ReactNode } from "react";

import { TAB_IDLE, TAB_SELECTED } from "@/components/ui/selection";

export type TabOption<T extends string> = {
  id: T;
  label: string;
  count?: number | null;
  trailing?: ReactNode;
};

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
  testId,
}: {
  options: readonly TabOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
      className={`flex gap-5 overflow-x-auto border-b border-line [scrollbar-width:none] min-[760px]:gap-[26px] ${className}`.trim()}
    >
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`relative -mb-px inline-flex h-11 shrink-0 items-center gap-[7px] border-0 border-b-2 bg-transparent px-0 text-[14px] min-[760px]:h-[42px] ${
              selected ? TAB_SELECTED : TAB_IDLE
            }`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
            {option.count != null ? (
              <span className="rounded-[9px] bg-mist px-[7px] py-px text-[11.5px] font-semibold tabular-nums text-ink-3">
                {option.count}
              </span>
            ) : null}
            {option.trailing}
          </button>
        );
      })}
    </div>
  );
}
