"use client";

import { useState } from "react";

import {
  CONVERSATION_CHIP_CAP,
  dedupeChipRefs,
  type ChipRef,
} from "@/components/study/SourceChip";

import { Button } from "./Button";
import { SourceRef } from "./SourceRef";

export function SourceRefs({ refs, maxVisible = CONVERSATION_CHIP_CAP }: { refs: readonly ChipRef[]; maxVisible?: number }) {
  const chips = dedupeChipRefs(refs);
  if (chips.length === 0) return null;
  if (chips.length <= maxVisible) {
    return (
      <span className="mt-1.5 flex max-w-full flex-wrap gap-1.5" data-testid="source-refs">
        {chips.map((chip) => (
          <SourceRef key={`${chip.sourceDocumentId}:${chip.pageNumber}`} chip={chip} />
        ))}
      </span>
    );
  }
  return <SourceRefsOverflow chips={chips} maxVisible={maxVisible} />;
}

function SourceRefsOverflow({ chips, maxVisible }: { chips: ChipRef[]; maxVisible: number }) {
  const [open, setOpen] = useState(false);
  const visible = chips.slice(0, maxVisible);
  const hidden = chips.slice(maxVisible);
  return (
    <span className="mt-1.5 flex max-w-full flex-wrap items-center gap-1.5" data-testid="source-refs">
      {visible.map((chip) => (
        <SourceRef key={`${chip.sourceDocumentId}:${chip.pageNumber}`} chip={chip} />
      ))}
      <Button
        variant="text"
        size="small"
        type="button"
        data-testid="source-refs-more"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="!min-h-6 !text-label"
      >
        +{hidden.length} more
      </Button>
      {open
        ? hidden.map((chip) => <SourceRef key={`${chip.sourceDocumentId}:${chip.pageNumber}:more`} chip={chip} />)
        : null}
    </span>
  );
}