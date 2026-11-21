"use client";

import type { StudyViewRow } from "@hiveforyou/contracts";

import { SourceRefs } from "@/components/ui/SourceRefs";

import { formatDocumentDate } from "@/components/study/Timeline";
import { rowChips } from "@/components/study/Timeline";

export function FindingsTimelineList({ rows }: { rows: readonly StudyViewRow[] }) {
  return (
    <div className="flex flex-col" data-testid="findings-timeline-list">
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid gap-x-4 gap-y-1 border-b border-line py-3.5 min-[500px]:grid-cols-[120px_minmax(0,1fr)]"
          data-row-id={row.id}
        >
          <span className="text-meta tabular-nums text-ink-2">
            {formatDocumentDate(row.date) ?? row.asWritten?.trim() ?? "Undated"}
          </span>
          <div className="min-w-0">
            <p className="m-0 text-body text-ink">{row.statement}</p>
            <SourceRefs refs={rowChips(row)} />
          </div>
        </div>
      ))}
    </div>
  );
}