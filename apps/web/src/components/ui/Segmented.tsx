"use client";

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
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[9px] bg-hover p-[3px] [scrollbar-width:none]"
    >
      {options.map((option) => {
        const pressed = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={pressed}
            className={`h-[30px] shrink-0 rounded-[7px] border-0 px-3 text-meta font-medium text-ink-2 min-[900px]:h-[30px] max-[899px]:h-10 ${
              pressed
                ? "bg-paper font-semibold text-ink shadow-[0_1px_2px_rgba(20,30,50,0.08),0_0_0_1px_var(--color-line)]"
                : "bg-transparent hover:text-ink"
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