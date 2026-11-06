import { normalizeQuoteText } from "@hiveforyou/contracts";

export type NormalizedSpan = { readonly start: number; readonly end: number };

export function findNormalizedQuoteSpans(pageText: string, quote: string): NormalizedSpan[] | null {
  const normPage = normalizeQuoteText(pageText);
  const raw = quote.trim();
  if (raw === "") return [];
  if (raw.includes("|")) {
    const cells = raw
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c !== "");
    if (cells.length === 0) return [];
    const spans: NormalizedSpan[] = [];
    let searchFrom = 0;
    for (const cell of cells) {
      const nq = normalizeQuoteText(cell);
      if (nq === "") continue;
      const idx = normPage.indexOf(nq, searchFrom);
      if (idx < 0) return null;
      spans.push({ start: idx, end: idx + nq.length });
      searchFrom = idx + nq.length;
    }
    return spans;
  }
  const nq = normalizeQuoteText(raw);
  if (nq === "") return [];
  const idx = normPage.indexOf(nq);
  if (idx < 0) return null;
  return [{ start: idx, end: idx + nq.length }];
}
