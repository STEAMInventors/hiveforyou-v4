"use client";

import type { ChipRef } from "@/components/study/SourceChip";
import { useEvidenceViewer } from "@/components/study/EvidenceViewer";
import { truncateChipLabel } from "@/components/study/truncate-chip-label";

import { SOURCE_REF_CLASS, SourceRefIcon } from "./source-ref-look";

export type SourceRefProps = {
  chip: ChipRef;
  title?: string;
  /** Visual only, for use inside a parent button. */
  inert?: boolean;
};

const REF_CLASS = SOURCE_REF_CLASS;
const DocumentOutlineIcon = SourceRefIcon;

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
