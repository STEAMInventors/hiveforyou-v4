import type { DocExtraction, PageQuote } from "./extraction-contracts";

/** Maps typographic punctuation to ASCII so quotes still match after the same normalization on both sides. */
function foldTypographicPunctuation(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/\u00A0/g, " ");
}

export function normalizeQuoteText(text: string): string {
  return foldTypographicPunctuation(text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ")).trim();
}

/**
 * Why an evidence item was rejected. Every reason is a rejection; the finer reasons only say what
 * went wrong (case, wrong page, ellipsis, table cell) so prompt and extraction problems can be told apart.
 */
export const QUOTE_REJECTION_REASONS = [
  "page_not_provided",
  "quote_empty",
  "quote_case_mismatch",
  "quote_on_other_page",
  "quote_has_ellipsis",
  "table_cell_not_found",
  "quote_not_found",
] as const;
export type QuoteRejectionReason = (typeof QUOTE_REJECTION_REASONS)[number];

export type VerificationPage = { readonly pageNumber: number; readonly text: string };

export type DroppedEvidence = {
  readonly section: "facts" | "emptyFields" | "referencedDocuments" | "document";
  /** Model id of the fact or item, when it has one. */
  readonly itemId: string | null;
  readonly page: number;
  readonly quote: string;
  readonly reason: QuoteRejectionReason;
  /** True when the item lost all its evidence and was dropped. */
  readonly itemDropped: boolean;
};

export type ExtractionVerificationStats = {
  factsIn: number;
  factsKept: number;
  evidenceIn: number;
  /** Fact evidence items rejected. */
  evidenceDropped: number;
  /** Rejected fact evidence items by reason. */
  byReason: Partial<Record<QuoteRejectionReason, number>>;
  emptyFields: { in: number; kept: number };
  referencedDocuments: { in: number; kept: number };
  /** Evidence on the document header (issuer, people, key dates). */
  documentEvidence: { in: number; kept: number };
  dropped: DroppedEvidence[];
};

const ELLIPSIS = /\.\.\.|\u2026/;

/** Both sides normalized. A quote containing `|` is a table row: every non-empty cell must be on the page. */
function onPage(quote: string, page: string): boolean {
  if (page.includes(quote)) return true;
  if (!quote.includes("|")) return false;
  const cells = quote.split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
  return cells.length > 0 && cells.every((cell) => page.includes(cell));
}

/** Checks one quote against the page it claims (`pages` hold normalized text); `null` means verified. */
export function checkQuote(
  item: PageQuote,
  pages: ReadonlyMap<number, string>,
): QuoteRejectionReason | null {
  const page = pages.get(item.page);
  if (page === undefined) return "page_not_provided";
  const quote = normalizeQuoteText(item.quote);
  if (quote === "") return "quote_empty";
  if (onPage(quote, page)) return null;
  if (onPage(quote.toLowerCase(), page.toLowerCase())) return "quote_case_mismatch";
  for (const [number, other] of pages) if (number !== item.page && onPage(quote, other)) return "quote_on_other_page";
  if (ELLIPSIS.test(quote)) return "quote_has_ellipsis";
  if (quote.includes("|")) return "table_cell_not_found";
  return "quote_not_found";
}

/**
 * Keeps only evidence whose normalized quote appears on the stated page (a `|`-joined table row
 * passes when every cell is on that page). A fact, empty field or referenced document with no
 * surviving evidence is dropped. `pages` are the pages the model was given.
 */
export function verifyExtraction(
  extraction: DocExtraction,
  pages: readonly VerificationPage[],
): { extraction: DocExtraction; stats: ExtractionVerificationStats } {
  const normalized = new Map(pages.map((page) => [page.pageNumber, normalizeQuoteText(page.text)]));
  const dropped: DroppedEvidence[] = [];
  const byReason: ExtractionVerificationStats["byReason"] = {};
  let evidenceIn = 0;
  let evidenceDropped = 0;
  let documentIn = 0;
  let documentKept = 0;

  const filter = <T extends PageQuote>(
    section: DroppedEvidence["section"],
    itemId: string | null,
    evidence: readonly T[],
  ): T[] => {
    const results = evidence.map((item) => ({ item, reason: checkQuote(item, normalized) }));
    const kept = results.filter((r) => r.reason === null).map((r) => r.item);
    for (const { item, reason } of results) {
      if (reason === null) continue;
      dropped.push({ section, itemId, page: item.page, quote: item.quote, reason, itemDropped: kept.length === 0 });
      if (section === "facts") {
        evidenceDropped += 1;
        byReason[reason] = (byReason[reason] ?? 0) + 1;
      }
    }
    if (section === "facts") evidenceIn += evidence.length;
    if (section === "document") {
      documentIn += evidence.length;
      documentKept += kept.length;
    }
    return kept;
  };

  const facts = extraction.facts.flatMap((fact) => {
    const evidence = filter("facts", fact.modelId, fact.evidence);
    return evidence.length > 0 ? [{ ...fact, evidence }] : [];
  });
  const emptyFields = extraction.emptyFields.filter((item) => filter("emptyFields", item.modelId, [item]).length > 0);
  const referencedDocuments = extraction.referencedDocuments.filter(
    (item) => filter("referencedDocuments", item.modelId, [item]).length > 0,
  );
  const header = extraction.document;
  const document = {
    ...header,
    issuer: header.issuer ? { ...header.issuer, evidence: filter("document", null, header.issuer.evidence) } : null,
    aboutPeople: header.aboutPeople.flatMap((person) => {
      const evidence = filter("document", person.ref, person.evidence);
      return evidence.length > 0 ? [{ ...person, evidence }] : [];
    }),
    keyDates: header.keyDates.flatMap((date) => {
      const evidence = filter("document", null, date.evidence);
      return evidence.length > 0 ? [{ ...date, evidence }] : [];
    }),
  };

  return {
    extraction: { ...extraction, document, facts, emptyFields, referencedDocuments },
    stats: {
      factsIn: extraction.facts.length,
      factsKept: facts.length,
      evidenceIn,
      evidenceDropped,
      byReason,
      emptyFields: { in: extraction.emptyFields.length, kept: emptyFields.length },
      referencedDocuments: { in: extraction.referencedDocuments.length, kept: referencedDocuments.length },
      documentEvidence: { in: documentIn, kept: documentKept },
      dropped,
    },
  };
}
