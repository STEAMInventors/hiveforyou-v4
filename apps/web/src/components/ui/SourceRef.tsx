"use client";

import type { ChipRef } from "@/components/study/SourceChip";
import { useEvidenceViewer } from "@/components/study/EvidenceViewer";
import { truncateChipLabel } from "@/components/study/truncate-chip-label";

export type SourceRefProps = {
  chip: ChipRef;
  title?: string;
  /** Visual only, for use inside a parent button. */
  inert?: boolean;
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

const REF_CLASS =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-ref border border-line bg-paper px-2 text-[12px] font-medium text-ink-2 max-[759px]:min-h-10";

export function SourceRef({ chip, title, inert = false }: SourceRefProps) {
  const viewer = useEvidenceViewer();
  const chipLabel = chip.shortLabel?.trim() || viewer.chipLabelFor(chip.sourceDocumentId);
  const fullLabel = chip.shortLabel?.trim() || viewer.labelFor(chip.sourceDocumentId);
  const display = truncateChipLabel(chipLabel);
  const fullTitle = title ?? `${fullLabel} · p.${chip.pageNumber}`;
  const body = (
    <>
      <DocumentOutlineIcon />
      <span className="min-w-0 truncate">
        {display} · <span className="text-ink-3">p.{chip.pageNumber}</span>
      </span>
    </>
  );
  if (inert) {
    return (
      <span className={REF_CLASS} title={fullTitle} data-testid="source-ref">
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${REF_CLASS} hover:border-blue hover:bg-blue-wash hover:text-blue-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue`}
      title={fullTitle}
      aria-label={`Open ${fullLabel}, page ${chip.pageNumber}`}
      data-testid="source-ref"
      onClick={(event) => viewer.open(chip, event.currentTarget)}
    >
      {body}
    </button>
  );
}
