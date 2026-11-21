"use client";

import { useState } from "react";

import {
  CONVERSATION_CHIP_CAP,
  dedupeChipRefs,
  type ChipRef,
} from "@/components/study/SourceChip";

import { Button } from "./Button";
import { SourceRef } from "./SourceRef";

export function SourceRefs({
  refs,
  maxVisible = CONVERSATION_CHIP_CAP,
  inert = false,
}: {
  refs: readonly ChipRef[];
  maxVisible?: number;
  inert?: boolean;
}) {
  const chips = dedupeChipRefs(refs);
  if (chips.length === 0) return null;
  if (chips.length <= maxVisible) {
    return (
      <span className="mt-2 flex max-w-full flex-wrap gap-1.5" data-testid="source-refs">
        {chips.map((chip) => (
          <SourceRef key={`${chip.sourceDocumentId}:${chip.pageNumber}`} chip={chip} inert={inert} />
        ))}
      </span>
    );
  }
  return <SourceRefsOverflow chips={chips} maxVisible={maxVisible} inert={inert} />;
}

function SourceRefsOverflow({ chips, maxVisible, inert }: { chips: ChipRef[]; maxVisible: number; inert: boolean }) {
  const [open, setOpen] = useState(false);
  const visible = chips.slice(0, maxVisible);
  const hidden = chips.slice(maxVisible);
  return (
    <span className="mt-2 flex max-w-full flex-wrap items-center gap-1.5" data-testid="source-refs">
      {visible.map((chip) => (
        <SourceRef key={`${chip.sourceDocumentId}:${chip.pageNumber}`} chip={chip} inert={inert} />
      ))}
      <Button
        variant="text"
        size="small"
        type="button"
        data-testid="source-refs-more"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="!h-6 !min-h-0 !px-1.5 !text-[12px] max-[759px]:!h-10"
      >
        +{hidden.length} more
      </Button>
      {open
        ? hidden.map((chip) => (
            <SourceRef key={`${chip.sourceDocumentId}:${chip.pageNumber}:more`} chip={chip} inert={inert} />
          ))
        : null}
    </span>
  );
}
