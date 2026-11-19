"use client";

import { HiveMark } from "@/components/study/HiveMark";
import type { ChipRef } from "@/components/study/SourceChip";
import { useEvidenceViewer } from "@/components/study/EvidenceViewer";

export type SourceRefProps = {
  chip: ChipRef;
  title?: string;
};

export function SourceRef({ chip, title }: SourceRefProps) {
  const viewer = useEvidenceViewer();
  const chipLabel = chip.shortLabel?.trim() || viewer.chipLabelFor(chip.sourceDocumentId);
  const fullLabel = chip.shortLabel?.trim() || viewer.labelFor(chip.sourceDocumentId);
  const display =
    chipLabel.length > 24 ? `${chipLabel.slice(0, 21)}…` : chipLabel;
  return (
    <button
      type="button"
      className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-chip border border-line bg-paper px-1.5 text-label font-medium text-ink-2 hover:border-line-strong hover:bg-blue-wash hover:text-blue-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
      title={title ?? `${fullLabel} · p.${chip.pageNumber}`}
      aria-label={`Open ${fullLabel}, page ${chip.pageNumber}`}
      data-testid="source-ref"
      onClick={(event) => viewer.open(chip, event.currentTarget)}
    >
      <HiveMark className="h-3.5 w-3.5 shrink-0 opacity-80" />
      <span className="truncate">
        {display} · p.{chip.pageNumber}
      </span>
    </button>
  );
}