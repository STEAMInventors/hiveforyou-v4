"use client";

import type { StudyViewRow } from "@hiveforyou/contracts";

import { SourceChips } from "./SourceChip";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const longDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "May 14, 2026" for an ISO date; null for anything else. */
export function formatDocumentDate(date: string | null | undefined): string | null {
  if (!date || !ISO_DATE.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : longDate.format(parsed);
}

/**
 * The earliest dated event after the newest document's own date: something the documents say is
 * still ahead. Null when no document is dated or nothing comes after it, so urgency is never invented.
 */
export function selectUpcoming(
  timelineRows: readonly StudyViewRow[],
  documentDates: readonly (string | null | undefined)[],
): StudyViewRow | null {
  const newest = documentDates.filter((date): date is string => !!date && ISO_DATE.test(date)).sort().at(-1);
  if (!newest) return null;
  let upcoming: StudyViewRow | null = null;
  for (const row of timelineRows) {
    if (!row.date || !ISO_DATE.test(row.date) || row.date <= newest) continue;
    if (!upcoming || row.date < upcoming.date!) upcoming = row;
  }
  return upcoming;
}

export function timelineDateText(row: StudyViewRow): string {
  return formatDocumentDate(row.date) ?? (row.asWritten?.trim() || "Undated");
}

export function rowChips(row: StudyViewRow) {
  return row.values.map((value) => ({
    sourceDocumentId: value.sourceRef.sourceDocumentId,
    pageNumber: value.sourceRef.pageNumber,
    quote: value.sourceRef.quote,
    factIds: [value.factId],
  }));
}

export function Timeline({ rows, upcomingId }: { rows: readonly StudyViewRow[]; upcomingId: string | null }) {
  return (
    <ol className="relative m-0 flex list-none flex-col gap-5 p-0" data-testid="timeline">
      <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-[2px] bg-line" />
      {rows.map((row) => {
        const upcoming = row.id === upcomingId;
        return (
          <li key={row.id} className="relative flex gap-4 pl-0" data-row-id={row.id} data-upcoming={upcoming || undefined}>
            <span
              aria-hidden
              className={`relative mt-[5px] h-3 w-3 shrink-0 rounded-pill border-2 ${
                upcoming ? "border-cell-blue bg-cell-blue" : "border-quiet bg-paper"
              }`}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="m-0 font-brand text-[15px] font-semibold text-ink">
                {timelineDateText(row)}
                {upcoming ? <span className="sr-only"> (upcoming)</span> : null}
              </p>
              <p className="m-0 max-w-prose text-body text-ink">
                {row.statement} <SourceChips refs={rowChips(row)} />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
