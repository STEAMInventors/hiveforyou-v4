import type { BoundRef, BoundValue, NumericStatus } from "@hiveforyou/contracts";

export const CARD_CLASS = "flex flex-col gap-3 rounded-card border border-line bg-paper px-5 py-5 sm:px-6";
export const HEADING_CLASS = "m-0 font-brand text-[19px] font-semibold text-ink";

/**
 * Page citations for one item. Every rendered claim, row or value carries its sources. With `pageHref`
 * each chip is a link that opens the original physical page.
 */
export function SourceChips({
  refs,
  pageHref,
}: {
  refs: readonly BoundRef[];
  pageHref?: (ref: BoundRef) => string;
}) {
  if (refs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5" aria-label="Sources">
      {refs.map((ref) => {
        const key = `${ref.sourceDocumentId}:${ref.pageNumber}`;
        const label = `${ref.fileName} p.${ref.pageNumber}`;
        const title = `${ref.fileName}, page ${ref.pageNumber}`;
        return pageHref ? (
          <a
            key={key}
            href={pageHref(ref)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-[240px] items-center truncate rounded-full bg-honey-wash px-2 py-0.5 font-mono text-[11.5px] text-honey-deep hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-cell-blue"
            title={`Open ${title}`}
            aria-label={`Open ${title}`}
          >
            {label}
          </a>
        ) : (
          <span
            key={key}
            className="inline-flex max-w-[240px] items-center truncate rounded-full bg-mist px-2 py-0.5 text-[11.5px] text-ink-muted"
            title={title}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}

type ValueStatus = BoundValue["status"] | NumericStatus;

const STATUS_BADGE: Record<ValueStatus, { label: string; className: string }> = {
  VERIFIED: { label: "Verified", className: "bg-leaf-wash text-leaf-deep" },
  CALCULATED: { label: "Calculated", className: "bg-cell-blue-wash text-cell-blue-deep" },
  UNVERIFIED: { label: "Not verified", className: "bg-honey-wash text-honey-deep" },
  NONCALCULABLE: { label: "Not calculable", className: "bg-mist text-ink-muted" },
};

/** Verified, unverified and noncalculable values always look different (D-041). */
export function StatusBadge({ status, usesAssumptions = false }: { status: ValueStatus; usesAssumptions?: boolean }) {
  const badge = STATUS_BADGE[status];
  return (
    <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium ${badge.className}`}>
      {badge.label}
      {usesAssumptions ? " · uses assumptions" : ""}
    </span>
  );
}

export function formatValue(value: string | null, unit: string | null): string {
  if (value === null) return "Not calculable";
  return unit ? `${value} ${unit}` : value;
}
