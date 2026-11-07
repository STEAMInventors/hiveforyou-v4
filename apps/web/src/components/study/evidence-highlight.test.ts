import { describe, expect, it } from "vitest";

import {
  buildPdfTextIndex,
  escapeHighlightHtml,
  findCrossPageQuoteParts,
  findNormalizedQuoteSpans,
  findQuoteMatch,
  normalizeEvidenceMatchText,
  renderHighlightedItemText,
  spansToItemHighlights,
  type PdfTextItem,
} from "./evidence-highlight";

describe("normalizeEvidenceMatchText", () => {
  it("NFKC, curly quotes, dashes, whitespace, and case", () => {
    expect(normalizeEvidenceMatchText("  The Trustee\u2019s \u201Cobjection\u201D  ")).toBe("the trustee's \"objection\"");
    expect(normalizeEvidenceMatchText("9\u201330 a.m.")).toBe("9-30 a.m.");
  });

  it("joins hyphenated line breaks", () => {
    expect(normalizeEvidenceMatchText("prepeti-\ntion arrearage")).toBe("prepetition arrearage");
  });
});

describe("buildPdfTextIndex and spansToItemHighlights", () => {
  it("matches across multiple text items and line breaks", () => {
    const items: PdfTextItem[] = [
      { str: "The fee is " },
      { str: "$10.00", hasEOL: true },
      { str: " for service." },
    ];
    const index = buildPdfTextIndex(items);
    const match = findQuoteMatch(index.normText, "The fee is $10.00 for service.");
    expect(match.kind).toBe("exact");
    const byItem = spansToItemHighlights(index, match.spans);
    expect(byItem.get(0)?.length).toBeGreaterThan(0);
    expect(byItem.get(1)?.length).toBeGreaterThan(0);
    expect(byItem.get(2)?.length).toBeGreaterThan(0);
  });

  it("maps hyphenated line break in PDF items", () => {
    const items: PdfTextItem[] = [
      { str: "prepeti-", hasEOL: true },
      { str: "tion arrearage" },
    ];
    const index = buildPdfTextIndex(items);
    const match = findQuoteMatch(index.normText, "prepetition arrearage");
    expect(match.kind).toBe("exact");
  });
});

describe("findQuoteMatch", () => {
  it("matches table cells in order", () => {
    const page =
      "Service        Amount          Location\nSpeech-Language Therapy   60 min/week   Therapy room";
    const match = findQuoteMatch(page, "Speech-Language Therapy | 60 min/week | Therapy room");
    expect(match.kind).toBe("exact");
    expect(match.spans.length).toBe(3);
  });

  it("returns not_found when a table cell is missing", () => {
    expect(findQuoteMatch("a b c", "a | missing | c").kind).toBe("not_found");
  });

  it("fuzzy fallback at >= 80% tokens in order", () => {
    const page = "alpha beta gamma delta epsilon zeta eta theta iota";
    const quote = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const match = findQuoteMatch(page, quote);
    expect(match.kind).toBe("fuzzy");
    expect(match.spans.length).toBe(1);
  });

  it("returns not_found when fuzzy threshold is not met", () => {
    const match = findQuoteMatch("totally unrelated text", "The Trustee asks the Court to deny confirmation");
    expect(match.kind).toBe("not_found");
  });

  it("matches curly quotes in quote against straight in page", () => {
    const page = 'The Trustee\'s objection was filed.';
    const match = findQuoteMatch(page, "The Trustee\u2019s objection was filed.");
    expect(match.kind).toBe("exact");
  });
});

describe("findNormalizedQuoteSpans", () => {
  it("returns null when not found", () => {
    expect(findNormalizedQuoteSpans("abc", "xyz")).toBeNull();
  });
});

describe("findCrossPageQuoteParts", () => {
  it("splits a quote across two page texts", () => {
    const quote = "segment one segment two";
    const cross = findCrossPageQuoteParts(quote, "intro segment one", "segment two outro", 2);
    expect(cross).not.toBeNull();
    expect(cross!.neighborPageNumber).toBe(2);
  });
});

describe("renderHighlightedItemText", () => {
  it("escapes HTML in PDF text and never injects raw markup", () => {
    const out = renderHighlightedItemText("<script>x</script>", [{ start: 8, end: 9 }]);
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
    expect(out).toContain('<mark class="evidence-highlight">');
  });

  it("escapes without highlight ranges", () => {
    expect(escapeHighlightHtml(`a & b <c>`)).toBe("a &amp; b &lt;c&gt;");
  });
});
