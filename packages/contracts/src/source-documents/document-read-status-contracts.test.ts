import { describe, expect, it } from "vitest";

import {
  DOCUMENT_READ_STATUSES,
  documentNeedsReading,
  isActiveDocumentReadStatus,
  isTerminalDocumentReadStatus,
  MAX_DOCUMENT_READS_PER_REQUEST,
  normalizeDocumentReadRecord,
  validateStartDocumentReadsInput,
} from "./document-read-status-contracts";

const READ_ID = "55555555-5555-4555-8555-555555555555";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const CORRELATION_ID = "77777777-7777-4777-8777-777777777777";

function rawRead(overrides: Record<string, unknown> = {}) {
  return {
    id: READ_ID,
    hiveId: HIVE_ID,
    sourceDocumentId: DOC_ID,
    requestId: REQUEST_ID,
    attemptNumber: 1,
    status: "READING",
    totalPhysicalPages: null,
    verifiedPageCount: null,
    unreadablePageCount: null,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: CORRELATION_ID,
    createdAt: "2026-11-01T22:00:00.000Z",
    startedAt: "2026-11-01T22:00:01.000Z",
    updatedAt: "2026-11-01T22:00:02.000Z",
    finishedAt: null,
    ...overrides,
  };
}

describe("document read statuses", () => {
  it("splits the eight statuses into four active and four terminal ones", () => {
    expect(DOCUMENT_READ_STATUSES).toHaveLength(8);
    expect(DOCUMENT_READ_STATUSES.filter(isActiveDocumentReadStatus)).toEqual([
      "QUEUED",
      "READING",
      "SAVING",
      "VERIFYING",
    ]);
    expect(DOCUMENT_READ_STATUSES.filter(isTerminalDocumentReadStatus)).toEqual([
      "SUCCEEDED",
      "PARTIAL",
      "UNREADABLE",
      "FAILED",
    ]);
    expect(isTerminalDocumentReadStatus("DONE")).toBe(false);
  });
});

describe("documentNeedsReading", () => {
  it("is true for registered documents never read or whose last read failed", () => {
    expect(documentNeedsReading({ status: "REGISTERED", readStatus: "PENDING" }, null)).toBe(true);
    expect(
      documentNeedsReading({ status: "REGISTERED", readStatus: "FAILED" }, { status: "FAILED" }),
    ).toBe(true);
  });

  it("is false while a read is active, after a finished read, or before registration", () => {
    expect(
      documentNeedsReading({ status: "REGISTERED", readStatus: "PENDING" }, { status: "VERIFYING" }),
    ).toBe(false);
    for (const readStatus of ["SUCCEEDED", "PARTIAL", "UNREADABLE"] as const) {
      expect(documentNeedsReading({ status: "REGISTERED", readStatus }, null)).toBe(false);
    }
    expect(documentNeedsReading({ status: "PENDING", readStatus: "PENDING" }, null)).toBe(false);
    expect(documentNeedsReading({ status: "REJECTED", readStatus: "PENDING" }, null)).toBe(false);
  });
});

describe("validateStartDocumentReadsInput", () => {
  it("accepts a request ID alone and normalizes case", () => {
    expect(validateStartDocumentReadsInput({ clientRequestId: REQUEST_ID.toUpperCase() })).toEqual({
      ok: true,
      value: { clientRequestId: REQUEST_ID, sourceDocumentIds: null },
    });
  });

  it("de-duplicates selected document IDs", () => {
    const result = validateStartDocumentReadsInput({
      clientRequestId: REQUEST_ID,
      sourceDocumentIds: [DOC_ID, DOC_ID.toUpperCase()],
    });
    expect(result).toEqual({ ok: true, value: { clientRequestId: REQUEST_ID, sourceDocumentIds: [DOC_ID] } });
  });

  it("rejects malformed bodies", () => {
    expect(validateStartDocumentReadsInput(null)).toMatchObject({ ok: false, diagnosticReason: "invalid_payload_shape" });
    expect(validateStartDocumentReadsInput({ clientRequestId: "nope" })).toMatchObject({
      ok: false,
      diagnosticReason: "invalid_client_request_id",
    });
    expect(validateStartDocumentReadsInput({ clientRequestId: REQUEST_ID, force: true })).toMatchObject({
      ok: false,
      diagnosticReason: "unexpected_field",
    });
    expect(
      validateStartDocumentReadsInput({ clientRequestId: REQUEST_ID, sourceDocumentIds: ["x"] }),
    ).toMatchObject({ ok: false, diagnosticReason: "invalid_source_document_id" });
    expect(
      validateStartDocumentReadsInput({ clientRequestId: REQUEST_ID, sourceDocumentIds: [] }),
    ).toMatchObject({ ok: false, diagnosticReason: "invalid_source_document_id" });
    expect(
      validateStartDocumentReadsInput({
        clientRequestId: REQUEST_ID,
        sourceDocumentIds: Array.from({ length: MAX_DOCUMENT_READS_PER_REQUEST + 1 }, () => DOC_ID),
      }),
    ).toMatchObject({ ok: false, diagnosticReason: "invalid_source_document_id" });
  });
});

describe("normalizeDocumentReadRecord", () => {
  it("accepts the database JSON shape", () => {
    expect(normalizeDocumentReadRecord(rawRead())).toMatchObject({ id: READ_ID, status: "READING" });
  });

  it("keeps terminal outcome details", () => {
    const read = normalizeDocumentReadRecord(
      rawRead({
        status: "FAILED",
        errorCode: "PAGE_READ_FAILED",
        errorMessageSafe: "Reading this document timed out. You can try again.",
        retryable: true,
        finishedAt: "2026-11-01T22:03:00.000Z",
      }),
    );
    expect(read).toMatchObject({ status: "FAILED", retryable: true, errorCode: "PAGE_READ_FAILED" });
  });

  it("rejects unknown statuses, bad IDs and bad counts", () => {
    expect(normalizeDocumentReadRecord(rawRead({ status: "DONE" }))).toBeNull();
    expect(normalizeDocumentReadRecord(rawRead({ id: "x" }))).toBeNull();
    expect(normalizeDocumentReadRecord(rawRead({ verifiedPageCount: -1 }))).toBeNull();
    expect(normalizeDocumentReadRecord(rawRead({ attemptNumber: 0 }))).toBeNull();
    expect(normalizeDocumentReadRecord("not a record")).toBeNull();
  });
});
