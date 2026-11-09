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
function versionQualifier(typeInPlainWords: string | null | undefined): "original" | "amended" | null {
  const lower = (typeInPlainWords ?? "").toLowerCase();
  if (/\bfirst amended\b|\bamended\b/.test(lower)) return "amended";
  if (/\boriginal\b/.test(lower) && !/\bamended\b/.test(lower)) return "original";
  return null;
}

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
  let label = words.join(" ");
  label = label.charAt(0).toUpperCase() + label.slice(1);
  const version = versionQualifier(typeInPlainWords);
  if (version) label = `${label} (${version})`;
  return label;
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

/**
 * Chip line: short type (≤3 words) per document; when two share the same short type, number them in list order.
 */
export function shortTypeChipLabels(documents: readonly LabelledDocument[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const document of documents) {
    if (base.has(document.sourceDocumentId)) continue;
    base.set(document.sourceDocumentId, shortTypeLabel(document.typeInPlainWords) || FALLBACK_LABEL);
  }
  const counts = new Map<string, number>();
  for (const label of base.values()) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const document of documents) {
    const id = document.sourceDocumentId;
    const label = base.get(id);
    if (label === undefined) continue;
    if ((counts.get(label) ?? 0) > 1) {
      const n = (seen.get(label) ?? 0) + 1;
      seen.set(label, n);
      out.set(id, `${label} · ${n}`);
    } else {
      out.set(id, label);
    }
  }
  return out;
}
