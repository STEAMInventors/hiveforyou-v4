import { describe, expect, it } from "vitest";

import {
  computePageSetDigest,
  computeReadFingerprint,
  computeSha256Digest,
  DOCUMENT_PAGE_PROVENANCE_VERSION,
  DOCUMENT_READ_CONTRACT_VERSION,
  fileSha256MismatchField,
  MAX_DOCUMENT_PAGE_TEXT_BYTES,
  normalizeContentDigest,
  normalizeFileSha256,
  normalizeReaderWireResponse,
  READER_WIRE_CONTRACT_VERSION,
  validateReadDocumentInput,
} from "./document-read-contracts";
import { DOCX_MIME_TYPE } from "./source-document-contracts";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const DOC_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_SHA = "a".repeat(64);
const STORAGE_PATH = `${OWNER_ID}/${HIVE_ID}/${DOC_ID}/original`;

describe("validateReadDocumentInput", () => {
  it("accepts valid PDF, PNG, JPEG, and DOCX inputs with allowed storage path prefix", () => {
    for (const mimeType of [
      "application/pdf",
      "image/png",
      "image/jpeg",
      DOCX_MIME_TYPE,
    ] as const) {
      const res = validateReadDocumentInput({
        hiveId: HIVE_ID,
        ownerUserId: OWNER_ID,
        sourceDocumentId: DOC_ID,
        storageBucket: "hive-source-documents",
        storagePath: STORAGE_PATH,
        fileName: "synthetic.pdf",
        mimeType,
        byteSize: 1024,
        sha256: SOURCE_SHA,
        correlationId: "44444444-4444-4444-8444-444444444444",
      });
      expect(res.ok).toBe(true);
    }
  });

  it("rejects cross-Hive or cross-owner storage paths and path traversal", () => {
    const wrongHivePath = validateReadDocumentInput({
      hiveId: HIVE_ID,
      ownerUserId: OWNER_ID,
      sourceDocumentId: DOC_ID,
      storageBucket: "hive-source-documents",
      storagePath: `${OWNER_ID}/99999999-9999-4999-8999-999999999999/${DOC_ID}/original`,
      fileName: "synthetic.pdf",
      mimeType: "application/pdf",
      byteSize: 1024,
      sha256: SOURCE_SHA,
      correlationId: "44444444-4444-4444-8444-444444444444",
    });
    expect(wrongHivePath).toEqual({
      ok: false,
      message: "You do not have access to this source document.",
      diagnosticReason: "source_path_forbidden",
    });

    const traversal = validateReadDocumentInput({
      hiveId: HIVE_ID,
      ownerUserId: OWNER_ID,
      sourceDocumentId: DOC_ID,
      storageBucket: "hive-source-documents",
      storagePath: `${OWNER_ID}/${HIVE_ID}/${DOC_ID}/../other`,
      fileName: "synthetic.pdf",
      mimeType: "application/pdf",
      byteSize: 1024,
      sha256: SOURCE_SHA,
      correlationId: "44444444-4444-4444-8444-444444444444",
    });
    expect(traversal.ok).toBe(false);
  });
});

describe("computeReadFingerprint and computePageSetDigest", () => {
  it("computes deterministic read_fingerprint and page_set_digest matching V3 vectors", () => {
    const fp1 = computeReadFingerprint({
      sourceSha256: SOURCE_SHA,
      options: { ocr_mode: "selective", max_pages: 500, docx_page_break_strategy: "reproducible_v1" },
    });
    const fp2 = computeReadFingerprint({
      sourceSha256: SOURCE_SHA.toUpperCase(),
      options: { docx_page_break_strategy: "reproducible_v1", max_pages: 500, ocr_mode: "selective" },
    });
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{64}$/);

    const p1Sha = computeSha256Digest("Synthetic page one text with sufficient alphanumeric density.");
    const p2Sha = computeSha256Digest("Synthetic page two text with sufficient alphanumeric density.");
    const digestA = computePageSetDigest({
      sourceSha256: SOURCE_SHA,
      pageCount: 2,
      pages: [
        { pageNumber: 2, textSha256: p2Sha },
        { pageNumber: 1, textSha256: p1Sha },
      ],
    });
    const digestB = computePageSetDigest({
      sourceSha256: SOURCE_SHA,
      pageCount: 2,
      pages: [
        { page_number: 1, page_text_sha256: p1Sha },
        { page_number: 2, page_text_sha256: p2Sha },
      ],
    });
    expect(digestA).toBe(digestB);
    expect(digestA).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      computePageSetDigest({
        sourceSha256: `sha256:${SOURCE_SHA}`,
        pageCount: 2,
        pages: [
          { pageNumber: 1, textSha256: p1Sha },
          { pageNumber: 2, textSha256: p2Sha },
        ],
      }),
    ).toBe(digestA);
  });
});

describe("hash normalizers", () => {
  const fileSha = "c8590f8d3ad9085d04e76ebabd9f2f92b884bdf6869b003bb9f953fa3e23b122";
  const pageSetDigest = "sha256:e3dd8c9afe5c5f3c5683ab60e6f04440b16ce5b6050e5c1aec3daab543162fa0";

  it("keeps a file sha256 as 64 lowercase hex and a page-set digest as sha256: plus 64 hex", () => {
    expect(normalizeFileSha256(fileSha)).toBe(fileSha);
    expect(normalizeFileSha256(`sha256:${fileSha.toUpperCase()}`)).toBe(fileSha);
    expect(normalizeContentDigest(pageSetDigest)).toBe(pageSetDigest);
    expect(normalizeContentDigest(pageSetDigest.slice("sha256:".length))).toBe(pageSetDigest);
    expect(normalizeFileSha256(fileSha)).not.toBe(normalizeFileSha256(pageSetDigest));
    expect(normalizeContentDigest(fileSha)).not.toBe(normalizeContentDigest(pageSetDigest));
  });

  it("describes a prefixed file hash against an unprefixed one without copying either value", () => {
    const field = fileSha256MismatchField(`sha256:${fileSha}`, fileSha);
    expect(field).toBe("expectedPrefix:1.expectedLength:71.actualPrefix:0.actualLength:64");
    expect(field).not.toContain(fileSha.slice(0, 8));
    expect(field).not.toContain(pageSetDigest.slice("sha256:".length, "sha256:".length + 8));
  });
});

describe("normalizeReaderWireResponse", () => {
  const baseExpected = {
    hiveId: HIVE_ID,
    ownerUserId: OWNER_ID,
    sourceDocumentId: DOC_ID,
    mimeType: "application/pdf" as const,
    byteSize: 2048,
    sha256: SOURCE_SHA,
    declaredPageCount: 2,
    maxPages: 500,
    ocrMode: "selective" as const,
    docxPageBreakStrategy: "reproducible_v1" as const,
  };

  const baseWire = {
    contract_version: READER_WIRE_CONTRACT_VERSION,
    status: "SUCCEEDED",
    source: {
      source_document_id: DOC_ID,
      hive_id: HIVE_ID,
      owner_user_id: OWNER_ID,
      storage_bucket: "hive-source-documents",
      storage_path: STORAGE_PATH,
      mime_type: "application/pdf",
      byte_size: 2048,
      sha256: SOURCE_SHA,
      filename: "synthetic-batch.pdf",
    },
    source_hash_verified: true,
    page_count: 2,
    pages: [
      {
        page_number: 1,
        text: "Synthetic PDF page 1 with more than forty alphanumeric characters for quality.",
        extraction_method: "pdf_native",
        quality: {
          character_count: 78,
          identity_text_sufficient: true,
          issues: [],
        },
      },
      {
        page_number: 2,
        text: "Synthetic PDF page 2 rendered via local Tesseract OCR with sufficient text.",
        extraction_method: "image_ocr_local",
        quality: {
          character_count: 75,
          identity_text_sufficient: true,
          issues: ["OCR_LITELLM_NOT_CONFIGURED"],
        },
      },
    ],
    provenance: {
      reader_git_sha: "abc1234",
      reader_version: "0.1.0",
      tools: { hive_reader: "0.1.0", pymupdf: "1.28.2", libreoffice: "7.6.7.2" },
      model_calls: [],
    },
    read_fingerprint: "f".repeat(64),
  };

  it("normalizes a multi-page read with explicit page accounting and strips OCR_LITELLM_NOT_CONFIGURED", () => {
    const normalized = normalizeReaderWireResponse({
      expected: baseExpected,
      wire: baseWire,
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    expect(normalized.value).toMatchObject({
      contractVersion: DOCUMENT_READ_CONTRACT_VERSION,
      sourceDocumentId: DOC_ID,
      hiveId: HIVE_ID,
      readStatus: "SUCCEEDED",
      totalPhysicalPages: 2,
      processedPages: [1, 2],
      unreadablePages: [],
      unprocessedPages: [],
      extractionMethod: "pdf_native",
      extractionMethods: ["pdf_native", "image_ocr_local"],
    });
    expect(normalized.value.pages[1]?.quality.issues).toEqual([]);
    expect(normalized.value.pages[0]?.provenance.contractVersion).toBe(
      DOCUMENT_PAGE_PROVENANCE_VERSION,
    );
  });

  it("tracks unreadablePages and unprocessedPages and derives PARTIAL or UNREADABLE status", () => {
    const partialWire = {
      ...baseWire,
      pages: [
        baseWire.pages[0]!,
        {
          page_number: 2,
          text: "blur",
          extraction_method: "image_ocr_local",
          quality: {
            character_count: 4,
            identity_text_sufficient: false,
            issues: ["LOW_TEXT_DENSITY", "IDENTITY_TEXT_INSUFFICIENT"],
          },
        },
      ],
    };

    const partial = normalizeReaderWireResponse({
      expected: { ...baseExpected, declaredPageCount: 4, maxPages: 2 },
      wire: partialWire,
    });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;

    expect(partial.value.readStatus).toBe("PARTIAL");
    expect(partial.value.totalPhysicalPages).toBe(4);
    expect(partial.value.processedPages).toEqual([1, 2]);
    expect(partial.value.unreadablePages).toEqual([2]);
    expect(partial.value.unprocessedPages).toEqual([3, 4]);

    const unreadableAll = normalizeReaderWireResponse({
      expected: { ...baseExpected, declaredPageCount: 1 },
      wire: {
        ...baseWire,
        page_count: 1,
        pages: [
          {
            page_number: 1,
            text: "",
            extraction_method: "image_ocr_local",
            quality: {
              character_count: 0,
              identity_text_sufficient: false,
              issues: ["LOW_TEXT_DENSITY", "IDENTITY_TEXT_INSUFFICIENT", "OCR_LOCAL_FAILED"],
            },
          },
        ],
      },
    });
    expect(unreadableAll.ok).toBe(true);
    if (!unreadableAll.ok) return;
    expect(unreadableAll.value.readStatus).toBe("UNREADABLE");
    expect(unreadableAll.value.unreadablePages).toEqual([1]);
  });

  it("rejects LiteLLM OCR extraction method or non-empty model_calls", () => {
    const withLitellmMethod = normalizeReaderWireResponse({
      expected: baseExpected,
      wire: {
        ...baseWire,
        pages: [
          {
            ...baseWire.pages[0]!,
            extraction_method: "image_ocr_litellm",
          },
          baseWire.pages[1]!,
        ],
      },
    });
    expect(withLitellmMethod).toEqual({
      ok: false,
      message: "LiteLLM OCR is not enabled for document reading.",
      diagnosticReason: "reader_litellm_ocr_disabled",
    });

    const withModelCalls = normalizeReaderWireResponse({
      expected: baseExpected,
      wire: {
        ...baseWire,
        provenance: {
          ...baseWire.provenance,
          model_calls: [{ litellm_alias: "vision-1", page_numbers: [1] }],
        },
      },
    });
    expect(withModelCalls).toEqual({
      ok: false,
      message: "Model-backed OCR or extraction is not enabled for document reading.",
      diagnosticReason: "reader_litellm_ocr_disabled",
    });
  });

  it("rejects oversized page text (> 64 KiB) without silent truncation", () => {
    const oversized = normalizeReaderWireResponse({
      expected: baseExpected,
      wire: {
        ...baseWire,
        pages: [
          {
            ...baseWire.pages[0]!,
            text: "X".repeat(MAX_DOCUMENT_PAGE_TEXT_BYTES + 1),
          },
          baseWire.pages[1]!,
        ],
      },
    });
    expect(oversized).toEqual({
      ok: false,
      message: "A document page exceeds the maximum supported text size.",
      diagnosticReason: "payload_too_large",
    });
  });
});
