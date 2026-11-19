"use client";

import { useWorkspaceChrome } from "@/components/workspace/workspace-context";

import { useEvidenceViewer } from "./EvidenceViewer";
import { HiveMark } from "./HiveMark";

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
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(({ ref, quotes, factIds }) => ({
    sourceDocumentId: ref.sourceDocumentId,
    pageNumber: ref.pageNumber,
    ...(quotes.length > 0 ? { quote: quotes.join("\n") } : {}),
    ...(factIds.size > 0 ? { factIds: [...factIds] } : {}),
  }));
}

const HONEY_CHIP_CLASS =
  "inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-chip border border-honey-chip-border bg-honey-wash px-[6px] py-[1px] align-baseline font-mono text-[12px] leading-none text-honey-deep hover:bg-honey-chip-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cell-blue max-sm:min-h-[44px] max-sm:px-2.5 max-sm:py-1";

const WORKSPACE_CHIP_CLASS =
  "inline-flex min-h-[22px] max-w-full min-w-0 items-center gap-1 whitespace-normal rounded-chip border-0 bg-cell-blue-wash px-[6px] py-[1px] align-baseline font-mono text-caption leading-snug text-cell-blue-deep hover:bg-cell-blue-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cell-blue max-sm:min-h-11";

export function useDocumentLabel(sourceDocumentId: string): string {
  return useEvidenceViewer().labelFor(sourceDocumentId);
}

export function useChipShortLabel(sourceDocumentId: string): string {
  return useEvidenceViewer().chipLabelFor(sourceDocumentId);
}

export function SourceChip({ chip, honeyStyle = false }: { chip: ChipRef; honeyStyle?: boolean }) {
  const viewer = useEvidenceViewer();
  const workspace = useWorkspaceChrome();
  const chipLabel = chip.shortLabel?.trim() || viewer.chipLabelFor(chip.sourceDocumentId);
  const fullLabel = chip.shortLabel?.trim() || viewer.labelFor(chip.sourceDocumentId);
  const chipClass = honeyStyle ? HONEY_CHIP_CLASS : workspace ? WORKSPACE_CHIP_CLASS : HONEY_CHIP_CLASS;
  return (
    <button
      type="button"
      className={chipClass}
      title={`${fullLabel} · p.${chip.pageNumber}`}
      aria-label={`Open ${fullLabel}, page ${chip.pageNumber}`}
      data-testid="source-chip"
      onClick={(event) => viewer.open(chip, event.currentTarget)}
    >
      <HiveMark className="h-4 w-4 shrink-0" />
      <span>
        {chipLabel} · p.{chip.pageNumber}
      </span>
    </button>
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
