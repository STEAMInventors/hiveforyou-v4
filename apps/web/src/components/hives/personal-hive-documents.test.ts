import { describe, expect, it } from "vitest";

import { resolvePersonalUploadedDocuments } from "./personal-hive-documents";

const DOC = { id: "doc-1", fileName: "lease.pdf", createdAt: "2026-11-02T00:00:00.000Z" };

describe("resolvePersonalUploadedDocuments", () => {
  it("uses the authorized list for the owner, including a genuine empty list", () => {
    expect(resolvePersonalUploadedDocuments("owner", { status: "listed", documents: [DOC] }, "corr").documents).toEqual([
      DOC,
    ]);
    const empty = resolvePersonalUploadedDocuments("owner", { status: "listed", documents: [] }, "corr");
    expect(empty.documents).toEqual([]);
    expect(empty.loadError).toBeNull();
  });

  it("reports a listing failure instead of an empty hive", () => {
    const failed = resolvePersonalUploadedDocuments("owner", { status: "failed" }, "corr-9");
    expect(failed.documents).toEqual([]);
    expect(failed.loadError).toEqual({
      message: "Could not load your documents.",
      correlationId: "corr-9",
      retryable: true,
    });
    expect(resolvePersonalUploadedDocuments("owner", null, "corr").loadError?.message).toBe(
      "Could not load your documents.",
    );
  });

  it("does not show the owner's files to another member", () => {
    const listed = { status: "listed" as const, documents: [DOC] };
    expect(resolvePersonalUploadedDocuments("professional", listed, "corr")).toEqual({
      documents: [],
      loadError: null,
    });
    expect(resolvePersonalUploadedDocuments("pending-professional", { status: "failed" }, "corr").loadError).toBeNull();
    expect(resolvePersonalUploadedDocuments("member", null, "corr")).toEqual({ documents: [], loadError: null });
  });
});
