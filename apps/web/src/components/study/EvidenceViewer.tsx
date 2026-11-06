"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { sourcePagePath } from "@/lib/hive-routes";

import type { ChipRef } from "./SourceChip";

type EvidenceViewerValue = {
  readonly labelFor: (sourceDocumentId: string) => string;
  readonly open: (chip: ChipRef, trigger?: HTMLElement | null) => void;
};

const FALLBACK: EvidenceViewerValue = { labelFor: () => "Document", open: () => undefined };

const EvidenceViewerContext = createContext<EvidenceViewerValue>(FALLBACK);

export function useEvidenceViewer(): EvidenceViewerValue {
  return useContext(EvidenceViewerContext);
}

type EvidenceViewerProviderProps = {
  hiveId: string;
  labels: ReadonlyMap<string, string>;
  fileNames: Readonly<Record<string, { readonly fileName: string }>>;
  children: ReactNode;
};

/**
 * Opens a cited page in a side sheet: the document's label, file name, page and the quoted text,
 * with a link to the original physical page. Escape or the close button returns focus to the chip.
 */
export function EvidenceViewerProvider({ hiveId, labels, fileNames, children }: EvidenceViewerProviderProps) {
  const [chip, setChip] = useState<ChipRef | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const labelFor = useCallback((id: string) => labels.get(id) ?? "Document", [labels]);
  const open = useCallback((next: ChipRef, trigger?: HTMLElement | null) => {
    triggerRef.current = trigger ?? null;
    setChip(next);
  }, []);
  const close = useCallback(() => {
    setChip(null);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!chip) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chip, close]);

  const value = useMemo(() => ({ labelFor, open }), [labelFor, open]);
  const quotes = chip?.quote ? chip.quote.split("\n") : [];

  return (
    <EvidenceViewerContext.Provider value={value}>
      {children}
      {chip ? (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-ink/30 sm:items-stretch" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-viewer-title"
            className="flex max-h-[85vh] w-full flex-col gap-4 overflow-y-auto rounded-t-card border border-line bg-paper p-6 sm:max-h-none sm:w-[420px] sm:rounded-none sm:rounded-l-card sm:p-7"
            onClick={(event) => event.stopPropagation()}
            data-testid="evidence-viewer"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 id="evidence-viewer-title" className="m-0 font-brand text-section font-semibold text-ink">
                  {labelFor(chip.sourceDocumentId)}, page {chip.pageNumber}
                </h2>
                <p className="m-0 break-all text-small text-quiet" data-testid="evidence-file-name">
                  {fileNames[chip.sourceDocumentId]?.fileName ?? "Document"}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="inline-flex h-11 shrink-0 items-center rounded-control border border-line bg-paper px-4 text-small font-medium text-ink hover:bg-mist"
              >
                Close
              </button>
            </div>
            {quotes.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="m-0 text-caption font-semibold text-quiet">On this page</p>
                {quotes.map((quote) => (
                  <blockquote
                    key={quote}
                    className="m-0 border-l-2 border-honey-chip-border pl-4 font-quote text-body text-ink"
                  >
                    {quote}
                  </blockquote>
                ))}
              </div>
            ) : null}
            <a
              href={sourcePagePath(hiveId, chip.sourceDocumentId, chip.pageNumber)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-control bg-cell-blue-deep px-4 text-small font-medium text-paper no-underline hover:bg-cell-blue-hover"
            >
              Open page {chip.pageNumber} of the original
            </a>
          </div>
        </div>
      ) : null}
    </EvidenceViewerContext.Provider>
  );
}
