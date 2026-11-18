"use client";

import type {
  CanonicalStudy,
  FindingsOpenItem,
  StudyView,
  StudyViewRow,
  StudyViewSources,
} from "@hiveforyou/contracts";
import { useEffect, useId, useMemo, useRef } from "react";

import { WORKSPACE_PRIMARY, WORKSPACE_SECONDARY } from "@/components/button-classes";
import { ComparisonCard } from "@/components/study/ComparisonCard";
import { EstablishTable } from "@/components/study/EstablishTable";
import { SourceChips } from "@/components/study/SourceChip";

function blockRows(view: StudyView, name: string): readonly StudyViewRow[] {
  return view.blocks.find((block) => block.name === name)?.rows ?? [];
}

function resolveOpenItemContext(
  item: FindingsOpenItem,
  view: StudyView,
  canonicalStudy: CanonicalStudy | null,
): { conflict?: StudyViewRow; spine?: StudyViewRow; gapText?: string } {
  if (item.id.startsWith("conflict-")) {
    const id = item.id.slice("conflict-".length);
    return { conflict: blockRows(view, "conflicts").find((row) => row.id === id) };
  }
  if (item.id.startsWith("spine-")) {
    const id = item.id.slice("spine-".length);
    return { spine: blockRows(view, "spine_table").find((row) => row.id === id) };
  }
  if (item.id.startsWith("gap-") && canonicalStudy) {
    const id = item.id.slice("gap-".length);
    const gap = canonicalStudy.gaps.find((entry) => entry.id === id);
    return { gapText: gap?.statement?.trim() || gap?.why?.trim() || undefined };
  }
  return {};
}

type FindingsReviewDrawerProps = {
  hiveId: string;
  item: FindingsOpenItem;
  view: StudyView;
  sources: StudyViewSources | null;
  canonicalStudy: CanonicalStudy | null;
  documentDate: (sourceDocumentId: string) => string | null | undefined;
  onClose: () => void;
  onMarkReviewed: (itemId: string) => void;
};

export function FindingsReviewDrawer({
  item: reviewItem,
  view,
  sources,
  canonicalStudy,
  documentDate,
  onClose,
  onMarkReviewed,
}: FindingsReviewDrawerProps) {
  const item = reviewItem;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const model = useMemo(() => resolveOpenItemContext(item, view, canonicalStudy), [item, view, canonicalStudy]);

  const chips =
    item.factIds.length > 0
      ? item.factIds.flatMap((factId) => {
          const ref = sources?.facts[factId];
          return ref
            ? [{ sourceDocumentId: ref.sourceDocumentId, pageNumber: ref.pageNumber, quote: ref.quote, factIds: [factId] }]
            : [];
        })
      : [];

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-ink/30" onClick={onClose} aria-hidden data-testid="findings-review-backdrop" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="findings-review-drawer"
        className="fixed inset-y-0 right-0 z-[51] flex w-full max-w-lg flex-col border-l border-line bg-paper shadow-lg"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="m-0 font-brand text-section font-semibold text-ink">
            Review context
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={WORKSPACE_SECONDARY}
            onClick={onClose}
            aria-label="Close review"
          >
            Close
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <p className="m-0 text-body font-medium text-ink">{item.title}</p>
          <p className="m-0 text-small text-graphite">{item.question}</p>
          {chips.length > 0 ? <SourceChips refs={chips} /> : null}
          {model.conflict ? <ComparisonCard row={model.conflict} documentDate={documentDate} /> : null}
          {model.spine ? <EstablishTable rows={[model.spine]} compact={false} statusMode="spine" /> : null}
          {model.gapText ? (
            <p className="m-0 rounded-control border border-line bg-mist p-3 text-small text-graphite">{model.gapText}</p>
          ) : null}
        </div>
        <footer className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
          <button
            type="button"
            className={WORKSPACE_PRIMARY}
            data-testid="findings-mark-reviewed"
            onClick={() => {
              onMarkReviewed(item.id);
              onClose();
            }}
          >
            Mark reviewed
          </button>
          <button type="button" className={WORKSPACE_SECONDARY} onClick={onClose}>
            Leave open
          </button>
        </footer>
      </aside>
    </>
  );
}

export function resolvedFindingsStorageKey(hiveId: string): string {
  return `hive.findings-resolved:${hiveId}`;
}

export function loadResolvedFindingIds(hiveId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(resolvedFindingsStorageKey(hiveId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

export function saveResolvedFindingIds(hiveId: string, ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(resolvedFindingsStorageKey(hiveId), JSON.stringify([...ids]));
}