"use client";

export type TabOption<T extends string> = { id: T; label: string };

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
    <div role="tablist" aria-label={ariaLabel} data-testid={testId} className={`flex gap-6 border-b border-line ${className}`.trim()}>
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`-mb-px border-b-2 bg-transparent px-0 py-3 text-meta font-semibold ${
              selected ? "border-blue-deep text-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}