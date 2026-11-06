"use client";

import { CellGlyph } from "./CellGlyph";
import { useEvidenceViewer } from "./EvidenceViewer";

/** One citable page. `quote` is what the chip's sentence or row relies on there, if known. */
export type ChipRef = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly quote?: string;
};

export type LabelledDocument = {
  readonly sourceDocumentId: string;
  readonly typeInPlainWords?: string | null;
  readonly date?: string | null;
};

const MAX_LABEL_WORDS = 3;
const FALLBACK_LABEL = "Document";

const MONTH_NAMES: ReadonlySet<string> = (() => {
  const names = new Set<string>();
  for (let month = 0; month < 12; month += 1) {
    const day = new Date(Date.UTC(2000, month, 15));
    for (const style of ["long", "short"] as const) {
      names.add(new Intl.DateTimeFormat("en-US", { month: style, timeZone: "UTC" }).format(day).toLowerCase());
    }
  }
  return names;
})();

const LEADING_ARTICLE = /^(a|an|the)$/i;
/** A lowercase short word inside a longer phrase usually joins two phrases ("to", "of", "and"). */
const SHORT_JOINING_WORD = /^[a-z]{1,3}$/;
const PAST_PARTICIPLE = /^[a-z]+ed$/;

function isDateWord(word: string): boolean {
  const bare = word.toLowerCase().replace(/[.,]+$/, "");
  return (
    MONTH_NAMES.has(bare) ||
    /^(19|20)\d{2}$/.test(bare) ||
    /^\d{4}-\d{2}-\d{2}$/.test(bare) ||
    /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(bare)
  );
}

/**
 * At most three words naming the kind of document, from `typeInPlainWords`: the first phrase
 * (before punctuation), without a leading date, cut before any later date (and a dangling
 * "dated"-style word), without a leading article, and, when still longer
 * than three words, cut before the first short joining word and then reduced to its last words,
 * where the head noun sits. Pure shape rules; no vocabulary beyond articles and month names.
 */
export function shortTypeLabel(typeInPlainWords: string | null | undefined): string {
  const firstPhrase = (typeInPlainWords ?? "").split(/[,;:()[\]]|\s[-–—]\s/)[0] ?? "";
  let words = firstPhrase.trim().split(/\s+/).filter((word) => word !== "");
  while (words.length > 0 && (isDateWord(words[0]!) || /^\d{1,2},?$/.test(words[0]!))) words = words.slice(1);
  let cut = false;
  const dateIndex = words.findIndex(isDateWord);
  if (dateIndex >= 0) {
    words = words.slice(0, dateIndex);
    cut = true;
  }
  while (words.length > 1 && LEADING_ARTICLE.test(words[0]!)) words = words.slice(1);
  if (words.length > MAX_LABEL_WORDS) {
    const joinIndex = words.findIndex((word, index) => index > 0 && SHORT_JOINING_WORD.test(word));
    if (joinIndex > 0) {
      words = words.slice(0, joinIndex);
      cut = true;
    }
  }
  if (cut) {
    while (words.length > 1 && (SHORT_JOINING_WORD.test(words.at(-1)!) || PAST_PARTICIPLE.test(words.at(-1)!))) {
      words = words.slice(0, -1);
    }
  }
  if (words.length > MAX_LABEL_WORDS) words = words.slice(-MAX_LABEL_WORDS);
  if (words.length === 0 || (words.length === 1 && LEADING_ARTICLE.test(words[0]!))) return "";
  const label = words.join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function monthYearOf(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : monthYear.format(parsed);
}

/**
 * Short label per document id. Documents that share a label get their month and year
 * ("Plan · Mar 2026"); any still sharing one are numbered in document order.
 */
export function shortDocumentLabels(documents: readonly LabelledDocument[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const document of documents) {
    if (base.has(document.sourceDocumentId)) continue;
    base.set(document.sourceDocumentId, shortTypeLabel(document.typeInPlainWords) || FALLBACK_LABEL);
  }
  const countBy = (labels: Map<string, string>) => {
    const counts = new Map<string, number>();
    for (const label of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
    return counts;
  };
  const baseCounts = countBy(base);
  const dated = new Map<string, string>();
  for (const document of documents) {
    const label = base.get(document.sourceDocumentId);
    if (label === undefined || dated.has(document.sourceDocumentId)) continue;
    const when = monthYearOf(document.date);
    dated.set(document.sourceDocumentId, (baseCounts.get(label) ?? 0) > 1 && when ? `${label} · ${when}` : label);
  }
  const datedCounts = countBy(dated);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const [id, label] of dated) {
    if ((datedCounts.get(label) ?? 0) > 1) {
      const n = (seen.get(label) ?? 0) + 1;
      seen.set(label, n);
      out.set(id, `${label} · ${n}`);
    } else {
      out.set(id, label);
    }
  }
  return out;
}

/** One chip per (document, page), first-seen order, quotes for the same page kept together. */
export function dedupeChipRefs(refs: readonly ChipRef[]): ChipRef[] {
  const byKey = new Map<string, { ref: ChipRef; quotes: string[] }>();
  for (const ref of refs) {
    if (!Number.isInteger(ref.pageNumber) || ref.pageNumber < 1) continue;
    const key = `${ref.sourceDocumentId}:${ref.pageNumber}`;
    const entry = byKey.get(key) ?? { ref, quotes: [] };
    const quote = ref.quote?.trim();
    if (quote && !entry.quotes.includes(quote)) entry.quotes.push(quote);
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(({ ref, quotes }) => ({
    sourceDocumentId: ref.sourceDocumentId,
    pageNumber: ref.pageNumber,
    ...(quotes.length > 0 ? { quote: quotes.join("\n") } : {}),
  }));
}

const CHIP_CLASS =
  "inline-flex min-h-[22px] items-center gap-1 whitespace-nowrap rounded-chip border border-honey-chip-border bg-honey-wash px-[7px] py-[2px] align-baseline font-mono text-[12px] leading-[1.3] text-honey-deep hover:bg-honey-chip-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cell-blue max-sm:min-h-[44px] max-sm:px-2.5";

export function useDocumentLabel(sourceDocumentId: string): string {
  return useEvidenceViewer().labelFor(sourceDocumentId);
}

export function SourceChip({ chip }: { chip: ChipRef }) {
  const viewer = useEvidenceViewer();
  const label = viewer.labelFor(chip.sourceDocumentId);
  return (
    <button
      type="button"
      className={CHIP_CLASS}
      aria-label={`Open ${label}, page ${chip.pageNumber}`}
      data-testid="source-chip"
      onClick={(event) => viewer.open(chip, event.currentTarget)}
    >
      <CellGlyph />
      <span>
        {label} · p.{chip.pageNumber}
      </span>
    </button>
  );
}

/** Chips for one sentence or row, de-duplicated by (document, page). */
export function SourceChips({ refs }: { refs: readonly ChipRef[] }) {
  const chips = dedupeChipRefs(refs);
  if (chips.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5 align-baseline">
      {chips.map((chip) => (
        <SourceChip key={`${chip.sourceDocumentId}:${chip.pageNumber}`} chip={chip} />
      ))}
    </span>
  );
}
