import { describe, expect, it } from "vitest";

import { formatEvidenceSource, parseEvidenceSource } from "./evidence-source-query";

const DOC = "33333333-3333-4333-8333-333333333333";

describe("evidence-source-query", () => {
  it("round-trips document id and page", () => {
    const formatted = formatEvidenceSource({ sourceDocumentId: DOC, pageNumber: 12 });
    expect(parseEvidenceSource(formatted)).toEqual({ sourceDocumentId: DOC, pageNumber: 12 });
  });

  it("rejects malformed values", () => {
    expect(parseEvidenceSource(null)).toBeNull();
    expect(parseEvidenceSource("")).toBeNull();
    expect(parseEvidenceSource("nocolon")).toBeNull();
    expect(parseEvidenceSource("doc:0")).toBeNull();
    expect(parseEvidenceSource(":3")).toBeNull();
  });
});