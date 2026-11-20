"use client";

import type { StudyViewValue } from "@hiveforyou/contracts";

import { type ChipRef, SourceChips } from "./SourceChip";

export type DistinctValue = { readonly text: string; readonly refs: readonly ChipRef[] };

/** Each value once, exactly as first written, with the pages of every fact that states it. */
export function distinctValues(values: readonly StudyViewValue[]): DistinctValue[] {
  const byText = new Map<string, { text: string; refs: ChipRef[] }>();
  for (const value of values) {
    const key = value.valueAsWritten.replace(/\s+/g, " ").trim();
    if (key === "") continue;
    const entry = byText.get(key) ?? { text: value.valueAsWritten.trim(), refs: [] };
    entry.refs.push({
      sourceDocumentId: value.sourceRef.sourceDocumentId,
      pageNumber: value.sourceRef.pageNumber,
      quote: value.sourceRef.quote,
      factIds: [value.factId],
    });
    byText.set(key, entry);
  }
  return [...byText.values()];
}

export function AsWrittenValue({ value }: { value: DistinctValue }) {
  return (
    <span className="inline">
      <span className="font-quote text-body text-ink" data-testid="study-value">
        {value.text}
      </span>{" "}
      <SourceChips refs={value.refs} />
    </span>
  );
}

/** The replaced value struck through, then the value that replaced it, each with its sources. */
export function ChangedValue({ before, after }: { before: readonly StudyViewValue[]; after: readonly StudyViewValue[] }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="changed-value">
      {distinctValues(before).map((value) => (
        <span key={`before-${value.text}`} className="inline">
          <s className="font-quote text-body text-quiet">
            <span className="sr-only">Earlier: </span>
            {value.text}
          </s>{" "}
          <SourceChips refs={value.refs} />
        </span>
      ))}
      <span aria-hidden className="text-quiet">
        →
      </span>
      {distinctValues(after).map((value) => (
        <span key={`after-${value.text}`} className="inline">
          <span className="sr-only">Now: </span>
          <AsWrittenValue value={value} />
        </span>
      ))}
    </span>
  );
}
