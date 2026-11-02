import { describe, expect, it } from "vitest";

import {
  DOCX_MIME_TYPE,
  MAX_SOURCE_DOCUMENT_BYTES,
  detectSourceMimeType,
  normalizeSourceDocumentRecord,
  sourceMimeTypeForFileName,
  validateCreateIntentRequestInput,
  validatePrepareSourceDocumentInput,
  validateSourceFileCandidate,
} from "./source-document-contracts";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

describe("source file candidates", () => {
  it("maps supported extensions case-insensitively and rejects others", () => {
    expect(sourceMimeTypeForFileName("Receipt.PDF")).toBe("application/pdf");
    expect(sourceMimeTypeForFileName("scan.jpeg")).toBe("image/jpeg");
    expect(sourceMimeTypeForFileName("letter.docx")).toBe(DOCX_MIME_TYPE);
    expect(sourceMimeTypeForFileName("notes.txt")).toBeNull();
    expect(sourceMimeTypeForFileName("no-extension")).toBeNull();
  });

  it("rejects empty, oversize and path-like files", () => {
    expect(validateSourceFileCandidate({ name: "a.pdf", size: 0 }).ok).toBe(false);
    expect(
      validateSourceFileCandidate({ name: "a.pdf", size: MAX_SOURCE_DOCUMENT_BYTES + 1 }).ok,
    ).toBe(false);
    expect(validateSourceFileCandidate({ name: "dir/a.pdf", size: 10 }).ok).toBe(false);
    expect(validateSourceFileCandidate({ name: "a.pdf", size: MAX_SOURCE_DOCUMENT_BYTES }).ok).toBe(
      true,
    );
  });
});

describe("detectSourceMimeType", () => {
  it("identifies files by their bytes, not their name", () => {
    expect(detectSourceMimeType(new Uint8Array(ascii("%PDF-1.7\n")))).toBe("application/pdf");
    expect(
      detectSourceMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe("image/png");
    expect(detectSourceMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(
      detectSourceMimeType(
        new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...ascii("....word/document.xml")]),
      ),
    ).toBe(DOCX_MIME_TYPE);
  });

  it("rejects a plain ZIP, text and empty input", () => {
    expect(detectSourceMimeType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBeNull();
    expect(detectSourceMimeType(new Uint8Array(ascii("hello")))).toBeNull();
    expect(detectSourceMimeType(new Uint8Array())).toBeNull();
  });
});

describe("request validation", () => {
  it("accepts a well-formed prepare request and rejects a mismatched type", () => {
    const valid = validatePrepareSourceDocumentInput({
      fileName: " Receipt.pdf ",
      mimeType: "application/pdf",
      byteSize: 1200,
      sha256: "a".repeat(64),
      clientRequestId: REQUEST_ID.toUpperCase(),
    });
    expect(valid).toEqual({
      ok: true,
      value: {
        fileName: "Receipt.pdf",
        mimeType: "application/pdf",
        byteSize: 1200,
        sha256: "a".repeat(64),
        clientRequestId: REQUEST_ID,
      },
    });
    const mismatched = validatePrepareSourceDocumentInput({
      fileName: "Receipt.pdf",
      mimeType: "image/png",
      byteSize: 1200,
      sha256: "b".repeat(64),
      clientRequestId: REQUEST_ID,
    });
    expect(mismatched.ok).toBe(false);
  });

  it("requires intent text and rejects unexpected fields", () => {
    expect(
      validateCreateIntentRequestInput({ intentText: "   ", clientRequestId: REQUEST_ID }).ok,
    ).toBe(false);
    expect(
      validateCreateIntentRequestInput({
        intentText: "Compare my bills",
        clientRequestId: REQUEST_ID,
        ownerUserId: REQUEST_ID,
      }).ok,
    ).toBe(false);
    expect(
      validateCreateIntentRequestInput({ intentText: " Compare my bills ", clientRequestId: REQUEST_ID }),
    ).toEqual({ ok: true, value: { intentText: "Compare my bills", clientRequestId: REQUEST_ID, audience: null } });
  });

  it("accepts an optional audience, collapsing whitespace, and rejects invalid ones", () => {
    expect(
      validateCreateIntentRequestInput({
        intentText: "Compare my bills",
        clientRequestId: REQUEST_ID,
        audience: "  My   accountant ",
      }),
    ).toEqual({ ok: true, value: { intentText: "Compare my bills", clientRequestId: REQUEST_ID, audience: "My accountant" } });
    expect(
      validateCreateIntentRequestInput({ intentText: "Compare my bills", clientRequestId: REQUEST_ID, audience: "   " }),
    ).toMatchObject({ ok: true, value: { audience: null } });
    expect(
      validateCreateIntentRequestInput({ intentText: "Compare my bills", clientRequestId: REQUEST_ID, audience: 7 }).ok,
    ).toBe(false);
    expect(
      validateCreateIntentRequestInput({
        intentText: "Compare my bills",
        clientRequestId: REQUEST_ID,
        audience: "x".repeat(201),
      }).ok,
    ).toBe(false);
  });
});

describe("normalizeSourceDocumentRecord", () => {
  it("accepts an RPC row and rejects unknown statuses", () => {
    const row = {
      id: REQUEST_ID,
      hiveId: HIVE_ID,
      clientRequestId: REQUEST_ID,
      fileName: "Receipt.pdf",
      mimeType: "application/pdf",
      byteSize: 1200,
      status: "REGISTERED",
      failureReason: null,
      scanStatus: "UNKNOWN_TO_SCANNER",
      readStatus: "PENDING",
      registeredAt: "2026-10-30T15:00:00Z",
      createdAt: "2026-10-30T15:00:00Z",
      updatedAt: "2026-10-30T15:00:00Z",
    };
    expect(normalizeSourceDocumentRecord(row)?.sourceDocumentId).toBe(REQUEST_ID);
    expect(normalizeSourceDocumentRecord({ ...row, status: "DONE" })).toBeNull();
  });
});
