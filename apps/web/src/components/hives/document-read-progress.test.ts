import type { DocumentRead, DocumentReadStatus } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_READ_STALE_UPDATE_MS,
  isReadProgressStale,
  pollStateFromFailures,
  readArrivalMessage,
  readCounter,
  readModalOutcome,
  retryableFailedReads,
} from "./document-read-progress";

function read(status: DocumentReadStatus, overrides: Partial<DocumentRead> = {}): DocumentRead {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    hiveId: "11111111-1111-4111-8111-111111111111",
    sourceDocumentId: "33333333-3333-4333-8333-333333333333",
    requestId: "66666666-6666-4666-8666-666666666666",
    attemptNumber: 1,
    status,
    totalPhysicalPages: null,
    verifiedPageCount: null,
    unreadablePageCount: null,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: "77777777-7777-4777-8777-777777777777",
    createdAt: "2026-11-01T22:00:00.000Z",
    startedAt: null,
    updatedAt: "2026-11-01T22:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

describe("document read progress", () => {
  it("counts partly read documents as read and keeps unreadable and failed apart", () => {
    expect(
      readCounter([read("SUCCEEDED"), read("PARTIAL"), read("UNREADABLE"), read("FAILED"), read("SAVING")]),
    ).toEqual({ total: 5, read: 2, unreadable: 1, failed: 1, active: 1 });
  });

  it("never reports success while any document is active or not fully read", () => {
    expect(readModalOutcome([read("SUCCEEDED"), read("VERIFYING")])).toBe("active");
    expect(readModalOutcome([read("SUCCEEDED"), read("PARTIAL")])).toBe("finished");
    expect(readModalOutcome([read("SUCCEEDED"), read("FAILED")])).toBe("failed");
    expect(readModalOutcome([read("SUCCEEDED")])).toBe("succeeded");
  });

  it("only offers retry for failures the server marked retryable", () => {
    const retryable = read("FAILED", { retryable: true });
    expect(retryableFailedReads([retryable, read("FAILED", { retryable: false }), read("UNREADABLE")])).toEqual([
      retryable,
    ]);
  });

  it("announces newly finished documents between polls", () => {
    const before = readCounter([read("READING"), read("READING"), read("READING")]);
    expect(readArrivalMessage(before, before)).toBeNull();
    expect(readArrivalMessage(before, readCounter([read("SUCCEEDED"), read("READING"), read("READING")]))).toBe(
      "Another document is read.",
    );
    expect(
      readArrivalMessage(before, readCounter([read("SUCCEEDED"), read("PARTIAL"), read("UNREADABLE")])),
    ).toBe("2 more documents are read. 1 document couldn't be read.");
  });

  it("flags progress as stale only when no active read was updated recently", () => {
    const updatedAt = "2026-11-01T22:00:00.000Z";
    const updated = Date.parse(updatedAt);
    expect(isReadProgressStale([read("READING", { updatedAt })], updated + DOCUMENT_READ_STALE_UPDATE_MS - 1)).toBe(
      false,
    );
    expect(isReadProgressStale([read("READING", { updatedAt })], updated + DOCUMENT_READ_STALE_UPDATE_MS)).toBe(true);
    expect(isReadProgressStale([read("SUCCEEDED", { updatedAt })], updated + 10 * DOCUMENT_READ_STALE_UPDATE_MS)).toBe(
      false,
    );
  });

  it("raises the reconnecting notice only after repeated failures", () => {
    expect(pollStateFromFailures(2, false)).toBe("ok");
    expect(pollStateFromFailures(3, false)).toBe("reconnecting");
    expect(pollStateFromFailures(0, true)).toBe("auth_expired");
  });
});
