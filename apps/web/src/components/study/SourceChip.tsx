"use client";

import { CellGlyph } from "./CellGlyph";
import { useEvidenceViewer } from "./EvidenceViewer";

export { type LabelledDocument, shortDocumentLabels, shortTypeLabel } from "./document-labels";

/** One citable page. `quote` is what the chip's sentence or row relies on there, if known. */
export type ChipRef = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly quote?: string;
};

/** One chip per (document, page), first-seen order, quotes for the same page kept together. */
export function dedupeChipRefs(refs: readonly ChipRef[]): ChipRef[] {
  const byKey = new Map<string, { ref: ChipRef; quotes: string[] }>();
  for (const ref of refs) {
    if (!Number.isInteger(ref.pageNumber) || ref.pageNumber < 1) continue;
    const key = `${ref.sourceDocumentId}:${ref.pageNumber}`;
    const entry = byKey.get(key) ?? { ref, quotes: [] };
    const quote = ref.quote?.trim();
    if (quote && !entry.quotes.includes(quote)) entry.quotes.push(quote);
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(({ ref, quotes }) => ({
    sourceDocumentId: ref.sourceDocumentId,
    pageNumber: ref.pageNumber,
    ...(quotes.length > 0 ? { quote: quotes.join("\n") } : {}),
  }));
}

const CHIP_CLASS =
  "inline-flex min-h-[22px] items-center gap-1 whitespace-nowrap rounded-chip border border-honey-chip-border bg-honey-wash px-[7px] py-[2px] align-baseline font-mono text-[12px] leading-[1.3] text-honey-deep hover:bg-honey-chip-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cell-blue max-sm:min-h-[44px] max-sm:px-2.5";

export function useDocumentLabel(sourceDocumentId: string): string {
  return useEvidenceViewer().labelFor(sourceDocumentId);
}

export function SourceChip({ chip }: { chip: ChipRef }) {
  const viewer = useEvidenceViewer();
  const label = viewer.labelFor(chip.sourceDocumentId);
  return (
    <button
      type="button"
      className={CHIP_CLASS}
      aria-label={`Open ${label}, page ${chip.pageNumber}`}
      data-testid="source-chip"
      onClick={(event) => viewer.open(chip, event.currentTarget)}
    >
      <CellGlyph />
      <span>
        {label} · p.{chip.pageNumber}
      </span>
    </button>
  );
}

/** Chips for one sentence or row, de-duplicated by (document, page). */
export function SourceChips({ refs }: { refs: readonly ChipRef[] }) {
  const chips = dedupeChipRefs(refs);
  if (chips.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5 align-baseline">
      {chips.map((chip) => (
        <SourceChip key={`${chip.sourceDocumentId}:${chip.pageNumber}`} chip={chip} />
      ))}
    </span>
  );
}
