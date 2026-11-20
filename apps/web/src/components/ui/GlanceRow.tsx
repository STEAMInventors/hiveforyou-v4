import type { ReactNode } from "react";

import { Button } from "./Button";

export type GlanceEntry = {
  id: string;
  label: string;
  value: string;
  sub?: string;
  onHowCalculated?: () => void;
};

export function GlanceRow({ entries }: { entries: readonly GlanceEntry[] }) {
  const items = entries.slice(0, 4);
  if (items.length === 0) return null;
  return (
    <dl
      className="grid border-y border-line max-[399px]:grid-cols-1 min-[400px]:grid-cols-2 min-[768px]:grid-cols-4"
      data-testid="glance-row"
    >
      {items.map((entry, index) => (
        <div
          key={entry.id}
          className={`px-4 py-3.5 ${index > 0 ? "border-line min-[400px]:border-l" : ""}`}
        >
          <dt className="text-label text-ink-3">{entry.label}</dt>
          <dd className="m-0 font-brand text-state font-semibold tabular-nums text-ink">{entry.value}</dd>
          {entry.sub ? <p className="m-0 mt-0.5 text-label text-ink-3">{entry.sub}</p> : null}
          {entry.onHowCalculated ? (
            <Button variant="text" size="small" type="button" className="!mt-1 !min-h-8 !text-label" onClick={entry.onHowCalculated}>
              How it&apos;s calculated
            </Button>
          ) : null}
        </div>
      ))}
    </dl>
  );
}