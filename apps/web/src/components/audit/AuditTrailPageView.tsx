"use client";

import type { AuditTrailEntry } from "@hiveforyou/contracts";
import { useState } from "react";

import type { ChipRef } from "@/components/study/SourceChip";
import { Section } from "@/components/ui/Section";
import { ShowFewer, ShowMore } from "@/components/ui/ShowMore";
import { SourceRefs } from "@/components/ui/SourceRefs";
import { StatusDot } from "@/components/ui/StatusDot";

const ROW_LIMIT = 6;

function entryDetail(entry: AuditTrailEntry): string {
  return `${entry.method} ${entry.result}`.trim();
}

function toChipRefs(chips: AuditTrailEntry["chips"]): ChipRef[] {
  return chips.map((chip) => ({
    sourceDocumentId: chip.sourceDocumentId,
    pageNumber: chip.pageNumber,
    quote: chip.quote,
    factIds: "factIds" in chip && chip.factIds ? [...chip.factIds] : [],
  }));
}

export function AuditTrailPageView({ entries }: { entries: readonly AuditTrailEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) {
    return (
      <p className="m-0 text-body text-ink-2" data-testid="audit-empty">
        Checks will appear here after a study is accepted.
      </p>
    );
  }

  const visible = expanded ? entries : entries.slice(0, ROW_LIMIT);
  const hidden = entries.length - ROW_LIMIT;

  return (
    <div className="mx-auto w-full max-w-col-read" data-testid="audit-trail">
      <Section title="Checks and methods" headingRight={entries.length}>
        {visible.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-col gap-1 border-b border-line py-4 first:pt-0"
            data-testid="audit-check-row"
          >
            <div className="flex flex-wrap items-start gap-2.5">
              <StatusDot state="checked" label="Checked" />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-item font-semibold text-ink">{entry.title}</p>
                <p className="m-0 mt-1 text-meta text-ink-2">{entryDetail(entry)}</p>
                <SourceRefs refs={toChipRefs(entry.chips)} inert />
              </div>
            </div>
          </div>
        ))}
        {entries.length > ROW_LIMIT ? (
          expanded ? (
            <ShowFewer label="Show fewer" onClick={() => setExpanded(false)} />
          ) : (
            <ShowMore label={`Show all ${entries.length}`} onClick={() => setExpanded(true)} />
          )
        ) : null}
      </Section>
    </div>
  );
}