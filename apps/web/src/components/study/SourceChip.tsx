"use client";

import { useState } from "react";

import { SourceRef } from "@/components/ui/SourceRef";

import { useEvidenceViewer } from "./EvidenceViewer";

export {
  type LabelledDocument,
  findingsChipLabels,
  shortDocumentLabels,
  shortTypeChipLabels,
  shortTypeLabel,
} from "./document-labels";

/** One citable page. `quote` is what the chip's sentence or row relies on there, if known. */
export type ChipRef = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly shortLabel?: string;
  readonly quote?: string;
  /** Fact ids cited on this chip (merged when the same page has multiple quotes). */
  readonly factIds?: readonly string[];
};

/** One chip per (document, page), first-seen order, quotes for the same page kept together. */
export function dedupeChipRefs(refs: readonly ChipRef[]): ChipRef[] {
  const byKey = new Map<string, { ref: ChipRef; quotes: string[]; factIds: Set<string> }>();
  for (const ref of refs) {
    if (!Number.isInteger(ref.pageNumber) || ref.pageNumber < 1) continue;
    const key = `${ref.sourceDocumentId}:${ref.pageNumber}`;
    const entry = byKey.get(key) ?? { ref, quotes: [], factIds: new Set<string>() };
    const quote = ref.quote?.trim();
    if (quote && !entry.quotes.includes(quote)) entry.quotes.push(quote);
    for (const id of ref.factIds ?? []) {
      if (id.trim() !== "") entry.factIds.add(id);
    }
    const shortLabel = ref.shortLabel?.trim();
    if (shortLabel && !entry.ref.shortLabel?.trim()) {
      entry.ref = { ...entry.ref, shortLabel };
    }
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(({ ref, quotes, factIds }) => ({
    sourceDocumentId: ref.sourceDocumentId,
    pageNumber: ref.pageNumber,
    ...(ref.shortLabel?.trim() ? { shortLabel: ref.shortLabel.trim() } : {}),
    ...(quotes.length > 0 ? { quote: quotes.join("\n") } : {}),
    ...(factIds.size > 0 ? { factIds: [...factIds] } : {}),
  }));
}

export const CONVERSATION_CHIP_CAP = 6;

export function SourceChipsCapped({
  refs,
  maxVisible = CONVERSATION_CHIP_CAP,
}: {
  refs: readonly ChipRef[];
  maxVisible?: number;
}) {
  const chips = dedupeChipRefs(refs);
  if (chips.length === 0) return null;
  if (chips.length <= maxVisible) {
    return (
      <span className="inline-flex max-w-full flex-wrap gap-1.5 align-baseline">
        {chips.map((chip) => (
          <SourceChip key={`${chip.sourceDocumentId}:${chip.pageNumber}`} chip={chip} />
        ))}
      </span>
    );
  }
  return <SourceChipsOverflow chips={chips} maxVisible={maxVisible} />;
}

function SourceChipsOverflow({ chips, maxVisible }: { chips: ChipRef[]; maxVisible: number }) {
  const [open, setOpen] = useState(false);
  const visible = chips.slice(0, maxVisible);
  const hidden = chips.slice(maxVisible);
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 align-baseline">
      {visible.map((chip) => (
        <SourceChip key={`${chip.sourceDocumentId}:${chip.pageNumber}`} chip={chip} />
      ))}
      <button
        type="button"
        className="rounded-chip border border-line bg-paper px-2 py-0.5 text-label font-medium text-blue-deep hover:bg-blue-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue max-sm:min-h-10 max-sm:px-2.5 max-sm:py-2"
        data-testid="source-chips-more"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        +{hidden.length} more
      </button>
      {open ? (
        <span className="flex w-full flex-col gap-1.5" data-testid="source-chips-overflow-list">
          {hidden.map((chip) => (
            <SourceChip key={`${chip.sourceDocumentId}:${chip.pageNumber}:more`} chip={chip} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function useDocumentLabel(sourceDocumentId: string): string {
  return useEvidenceViewer().labelFor(sourceDocumentId);
}

export function useChipShortLabel(sourceDocumentId: string): string {
  return useEvidenceViewer().chipLabelFor(sourceDocumentId);
}

export function SourceChip({ chip }: { chip: ChipRef; honeyStyle?: boolean }) {
  return (
    <span data-testid="source-chip" className="inline-flex max-w-full align-baseline">
      <SourceRef chip={chip} />
    </span>
  );
}

/** Chips for one sentence or row, de-duplicated by (document, page). */
export function SourceChips({ refs }: { refs: readonly ChipRef[] }) {
  const chips = dedupeChipRefs(refs);
  if (chips.length === 0) return null;
  return (
    <span className="inline-flex max-w-full flex-wrap gap-1.5 align-baseline">
      {chips.map((chip) => (
        <SourceChip key={`${chip.sourceDocumentId}:${chip.pageNumber}`} chip={chip} />
      ))}
    </span>
  );
}