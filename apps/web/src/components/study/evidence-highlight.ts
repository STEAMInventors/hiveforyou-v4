export type NormalizedSpan = { readonly start: number; readonly end: number };

export type QuoteMatchKind = "exact" | "fuzzy" | "not_found";

export type QuoteMatchResult = {
  readonly kind: QuoteMatchKind;
  readonly spans: readonly NormalizedSpan[];
};

export type PdfTextItem = {
  readonly str: string;
  readonly hasEOL?: boolean;
};

export type ItemHighlightRange = { readonly start: number; readonly end: number };

const FUZZY_TOKEN_RATIO = 0.8;

function foldTypographicPunctuation(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00A0/g, " ");
}

/** Shared normalization for quote ↔ PDF text matching (NFKC, punctuation, whitespace, case-insensitive). */
export function normalizeEvidenceMatchText(text: string): string {
  let t = text.normalize("NFKC");
  t = foldTypographicPunctuation(t.replace(/\r\n?/g, "\n"));
  t = t.replace(/-\s*\n\s*/g, "");
  t = t.replace(/\s+/g, " ");
  return t.trim().toLowerCase();
}

function buildNormalizedWithMap(raw: string): { norm: string; normToRaw: readonly number[] } {
  const source = raw.normalize("NFKC");
  const folded = foldTypographicPunctuation(source);
  const normChars: string[] = [];
  const normToRaw: number[] = [];
  let i = 0;
  while (i < folded.length) {
    const ch = folded[i]!;
    if (/\s/.test(ch)) {
      const start = i;
      while (i < folded.length && /\s/.test(folded[i]!)) i += 1;
      if (normChars.length > 0 && i < folded.length) {
        normChars.push(" ");
        normToRaw.push(start);
      }
      continue;
    }
    normChars.push(ch.toLowerCase());
    normToRaw.push(i);
    i += 1;
  }
  let norm = normChars.join("");
  let toRaw = normToRaw;
  const leading = norm.match(/^\s*/)?.[0].length ?? 0;
  const trailing = norm.match(/\s*$/)?.[0].length ?? 0;
  if (leading > 0 || trailing > 0) {
    norm = norm.slice(leading, norm.length - trailing);
    toRaw = normToRaw.slice(leading, normToRaw.length - trailing);
  }
  return { norm, normToRaw: toRaw };
}

export type PdfTextIndex = {
  readonly normText: string;
  /** normText character index → position in the source item's raw `str`. */
  readonly charMap: readonly { readonly itemIndex: number; readonly offset: number }[];
};

export function buildPdfTextIndex(items: readonly PdfTextItem[]): PdfTextIndex {
  const charMap: { itemIndex: number; offset: number }[] = [];
  let normText = "";
  let hyphenCarry = false;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item?.str) continue;
    let raw = item.str;
    const hyphenJoin = raw.endsWith("-") && item.hasEOL === true;
    if (hyphenJoin) {
      raw = raw.slice(0, -1);
    } else if (item.hasEOL === true) {
      raw = `${raw} `;
    }
    const { norm, normToRaw } = buildNormalizedWithMap(raw);
    if (norm === "") continue;
    const needsSpace = normText.length > 0 && !hyphenCarry;
    if (needsSpace) {
      normText += " ";
      charMap.push({ itemIndex: i, offset: 0 });
    }
    normText += norm;
    for (let j = 0; j < norm.length; j += 1) {
      charMap.push({ itemIndex: i, offset: normToRaw[j] ?? 0 });
    }
    hyphenCarry = hyphenJoin;
  }
  return { normText, charMap };
}

function pushRange(map: Map<number, ItemHighlightRange[]>, itemIndex: number, start: number, end: number) {
  if (start >= end) return;
  const list = [...(map.get(itemIndex) ?? [])];
  const last = list[list.length - 1];
  if (last && last.end === start) {
    list[list.length - 1] = { start: last.start, end };
  } else {
    list.push({ start, end });
  }
  map.set(itemIndex, list);
}

export function spansToItemHighlights(
  index: PdfTextIndex,
  spans: readonly NormalizedSpan[],
): Map<number, ItemHighlightRange[]> {
  const map = new Map<number, ItemHighlightRange[]>();
  for (const span of spans) {
    let currentItem = -1;
    let rangeStart = -1;
    let rangeEnd = -1;
    const flush = () => {
      if (currentItem >= 0 && rangeStart >= 0 && rangeEnd > rangeStart) {
        pushRange(map, currentItem, rangeStart, rangeEnd);
      }
      currentItem = -1;
      rangeStart = -1;
      rangeEnd = -1;
    };
    for (let pos = span.start; pos < span.end; pos += 1) {
      const entry = index.charMap[pos];
      if (!entry) continue;
      if (entry.itemIndex !== currentItem) {
        flush();
        currentItem = entry.itemIndex;
        rangeStart = entry.offset;
        rangeEnd = entry.offset + 1;
      } else {
        rangeEnd = entry.offset + 1;
      }
    }
    flush();
  }
  return map;
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter((t) => t.length > 0);
}

function findFuzzyTokenSpan(normPage: string, normQuote: string): NormalizedSpan | null {
  const qTokens = tokenize(normQuote);
  if (qTokens.length === 0) return null;
  const minMatched = Math.max(1, Math.ceil(qTokens.length * FUZZY_TOKEN_RATIO));
  let searchFrom = 0;
  let matchStart = -1;
  let matchEnd = -1;
  let matched = 0;
  for (const token of qTokens) {
    const idx = normPage.indexOf(token, searchFrom);
    if (idx < 0) break;
    if (matchStart < 0) matchStart = idx;
    matchEnd = idx + token.length;
    searchFrom = matchEnd;
    matched += 1;
  }
  if (matched >= minMatched && matchStart >= 0 && matchEnd > matchStart) {
    return { start: matchStart, end: matchEnd };
  }
  return null;
}

function matchSimpleQuote(normPage: string, normQuote: string): QuoteMatchResult {
  if (normQuote === "") return { kind: "not_found", spans: [] };
  const idx = normPage.indexOf(normQuote);
  if (idx >= 0) {
    return { kind: "exact", spans: [{ start: idx, end: idx + normQuote.length }] };
  }
  const fuzzy = findFuzzyTokenSpan(normPage, normQuote);
  if (fuzzy) return { kind: "fuzzy", spans: [fuzzy] };
  return { kind: "not_found", spans: [] };
}

/** Locate quote in normalized page text (table `|` cells, exact match, then fuzzy token window). */
export function findQuoteMatch(pageText: string, quote: string): QuoteMatchResult {
  const normPage = normalizeEvidenceMatchText(pageText);
  const raw = quote.trim();
  if (raw === "") return { kind: "not_found", spans: [] };
  if (raw.includes("|")) {
    const cells = raw
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c !== "");
    if (cells.length === 0) return { kind: "not_found", spans: [] };
    const spans: NormalizedSpan[] = [];
    let searchFrom = 0;
    let kind: QuoteMatchKind = "exact";
    for (const cell of cells) {
      const nq = normalizeEvidenceMatchText(cell);
      if (nq === "") continue;
      let idx = normPage.indexOf(nq, searchFrom);
      if (idx < 0) {
        const fuzzy = findFuzzyTokenSpan(normPage.slice(searchFrom), nq);
        if (!fuzzy) return { kind: "not_found", spans: [] };
        kind = "fuzzy";
        idx = searchFrom + fuzzy.start;
        spans.push({ start: idx, end: searchFrom + fuzzy.end });
        searchFrom = searchFrom + fuzzy.end;
      } else {
        spans.push({ start: idx, end: idx + nq.length });
        searchFrom = idx + nq.length;
      }
    }
    return { kind, spans };
  }
  return matchSimpleQuote(normPage, normalizeEvidenceMatchText(raw));
}

/** @deprecated Use findQuoteMatch; kept for call sites that only need spans or null. */
export function findNormalizedQuoteSpans(pageText: string, quote: string): NormalizedSpan[] | null {
  const result = findQuoteMatch(pageText, quote);
  if (result.kind === "not_found") return null;
  return [...result.spans];
}

export type CrossPageQuoteParts = {
  readonly currentPageSpan: NormalizedSpan;
  readonly neighborPageSpan: NormalizedSpan;
  readonly neighborPageNumber: number;
};

/** When a quote straddles two persisted page texts, return the span on each side. */
export function findCrossPageQuoteParts(
  quote: string,
  currentPageText: string,
  neighborPageText: string,
  neighborPageNumber: number,
): CrossPageQuoteParts | null {
  const nq = normalizeEvidenceMatchText(quote);
  if (nq === "") return null;
  const cur = normalizeEvidenceMatchText(currentPageText);
  const next = normalizeEvidenceMatchText(neighborPageText);
  if (cur.includes(nq) || next.includes(nq)) return null;
  const maxPrefix = Math.min(nq.length - 1, cur.length);
  for (let len = maxPrefix; len >= 4; len -= 1) {
    const prefix = nq.slice(0, len).trimEnd();
    const suffix = nq.slice(len).trim();
    if (prefix === "" || suffix === "" || !cur.endsWith(prefix)) continue;
    const suffixIdx = next.indexOf(suffix);
    if (suffixIdx < 0) continue;
    return {
      currentPageSpan: { start: cur.length - prefix.length, end: cur.length },
      neighborPageSpan: { start: suffixIdx, end: suffixIdx + suffix.length },
      neighborPageNumber,
    };
  }
  return null;
}

export function escapeHighlightHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderHighlightedItemText(str: string, ranges: readonly ItemHighlightRange[] | undefined): string {
  if (!ranges?.length) return escapeHighlightHtml(str);
  const merged = [...ranges].sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  for (const range of merged) {
    const start = Math.max(0, Math.min(str.length, range.start));
    const end = Math.max(start, Math.min(str.length, range.end));
    if (start > pos) out += escapeHighlightHtml(str.slice(pos, start));
    if (end > start) {
      out += `<mark class="evidence-highlight">${escapeHighlightHtml(str.slice(start, end))}</mark>`;
    }
    pos = end;
  }
  if (pos < str.length) out += escapeHighlightHtml(str.slice(pos));
  return out;
}
