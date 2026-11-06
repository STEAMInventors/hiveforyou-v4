import { describe, expect, it } from "vitest";

import { findNormalizedQuoteSpans } from "./evidence-highlight";

describe("findNormalizedQuoteSpans", () => {
  it("matches verify-quotes table rule: each cell must appear on the page in order", () => {
    const page =
      "Service        Amount          Location\nSpeech-Language Therapy   60 min/week   Therapy room";
    const spans = findNormalizedQuoteSpans(page, "Speech-Language Therapy | 60 min/week | Therapy room");
    expect(spans).not.toBeNull();
    expect(spans!.length).toBe(3);
  });

  it("returns null when a table cell is missing", () => {
    const page = "a b c";
    expect(findNormalizedQuoteSpans(page, "a | missing | c")).toBeNull();
  });
});
