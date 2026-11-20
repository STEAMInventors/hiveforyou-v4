"use client";

import type { ChipRef } from "@/components/study/SourceChip";
import { useEvidenceViewer } from "@/components/study/EvidenceViewer";

export type SourceRefProps = {
  chip: ChipRef;
  title?: string;
};

function DocumentOutlineIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-70"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function SourceRef({ chip, title }: SourceRefProps) {
  const viewer = useEvidenceViewer();
  const chipLabel = chip.shortLabel?.trim() || viewer.chipLabelFor(chip.sourceDocumentId);
  const fullLabel = chip.shortLabel?.trim() || viewer.labelFor(chip.sourceDocumentId);
  const display =
    chipLabel.length > 24 ? `${chipLabel.slice(0, 21)}…` : chipLabel;
  return (
    <button
      type="button"
      className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-chip border border-line bg-paper px-1.5 text-label font-medium text-ink-2 hover:border-line-strong hover:bg-blue-wash hover:text-blue-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue max-sm:min-h-10 max-sm:py-2"
      title={title ?? `${fullLabel} · p.${chip.pageNumber}`}
      aria-label={`Open ${fullLabel}, page ${chip.pageNumber}`}
      data-testid="source-ref"
      onClick={(event) => viewer.open(chip, event.currentTarget)}
    >
      <DocumentOutlineIcon />
      <span className="truncate">
        {display} · <span className="text-ink-3">p.{chip.pageNumber}</span>
      </span>
    </button>
  );
}