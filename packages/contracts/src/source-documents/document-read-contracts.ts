import { createHash } from "node:crypto";

import { isValidUuid } from "../hives/hive-contracts";
import {
  type ContractValidation,
  isSourceMimeType,
  MAX_SOURCE_DOCUMENT_BYTES,
  type ReadStatus,
  type SourceMimeType,
} from "./source-document-contracts";

export const DOCUMENT_READ_CONTRACT_VERSION = "hive.doc-read/1" as const;
export const READER_WIRE_CONTRACT_VERSION = "reader-document-read@1" as const;
export const DOCUMENT_PAGE_SET_DIGEST_VERSION = "document-page-set@1" as const;
export const DOCUMENT_PAGE_PROVENANCE_VERSION = "document-page-provenance@1" as const;
export const HIVE_SOURCE_DOCUMENTS_BUCKET = "hive-source-documents" as const;

export const MAX_DOCUMENT_PAGE_TEXT_BYTES = 65_536;
export const MAX_DOCUMENT_PAGE_PROVENANCE_BYTES = 65_536;
export const DEFAULT_READER_MAX_PAGES = 500;

export const READER_HTTP_HEADERS = {
  CORRELATION_ID: "x-correlation-id",
  STUDY_RUN_ID: "x-study-run-id",
  EXTRACTION_BATCH_ID: "x-extraction-batch-id",
} as const;

/**
 * Allowed page extraction methods in V4 Step 1.
 * "image_ocr_litellm" is excluded in Step 1; if returned by Reader, V4 fails closed.
 */
export const PAGE_EXTRACTION_METHODS = [
  "pdf_native",
  "image_ocr_local",
  "docx_render_v1",
] as const;
export type PageExtractionMethod = (typeof PAGE_EXTRACTION_METHODS)[number];

export const PAGE_QUALITY_ISSUES = [
  "LOW_TEXT_DENSITY",
  "IDENTITY_TEXT_INSUFFICIENT",
  "OCR_LOCAL_UNAVAILABLE",
  "OCR_LOCAL_FAILED",
] as const;
export type PageQualityIssue = (typeof PAGE_QUALITY_ISSUES)[number];

export const READER_OCR_MODES = ["selective", "never"] as const;
export type ReaderOcrMode = (typeof READER_OCR_MODES)[number];

export const DOCX_PAGE_BREAK_STRATEGIES = ["reproducible_v1"] as const;
export type DocxPageBreakStrategy = (typeof DOCX_PAGE_BREAK_STRATEGIES)[number];

export type DocumentPageQuality = {
  readonly characterCount: number;
  readonly identityTextSufficient: boolean;
  readonly issues: readonly PageQualityIssue[];
};

export type DocumentPageProvenance = {
  readonly contractVersion: typeof DOCUMENT_PAGE_PROVENANCE_VERSION;
  readonly readerContractVersion: typeof READER_WIRE_CONTRACT_VERSION;
  readonly readerVersion: string;
  readonly readerGitSha: string;
  readonly tools: Readonly<Record<string, string>>;
  readonly quality: DocumentPageQuality;
};

export type DocumentPage = {
  readonly pageNumber: number;
  readonly text: string;
  readonly textSha256: string;
  readonly byteLength: number;
  readonly extractionMethod: PageExtractionMethod;
  readonly quality: DocumentPageQuality;
  readonly provenance: DocumentPageProvenance;
};

export type DocumentSourceFingerprint = {
  readonly sourceSha256: string;
  readonly byteSize: number;
  readonly mimeType: SourceMimeType;
  readonly sourceHashVerified: true;
  readonly readFingerprint: string;
  readonly pageSetDigest: string;
};

export type DocumentReadProvenance = {
  readonly contractVersion: typeof DOCUMENT_READ_CONTRACT_VERSION;
  readonly readerContractVersion: typeof READER_WIRE_CONTRACT_VERSION;
  readonly readerVersion: string;
  readonly readerGitSha: string;
  readonly tools: Readonly<Record<string, string>>;
  readonly ocrMode: ReaderOcrMode;
  readonly docxPageBreakStrategy: DocxPageBreakStrategy;
};

export type ReadDocumentOptions = {
  readonly maxPages?: number;
  readonly ocrMode?: ReaderOcrMode;
  readonly docxPageBreakStrategy?: DocxPageBreakStrategy;
};

export type ReadDocumentInput = {
  readonly hiveId: string;
  readonly ownerUserId: string;
  readonly sourceDocumentId: string;
  readonly storageBucket: string;
  readonly storagePath: string;
  readonly fileName: string;
  readonly mimeType: SourceMimeType;
  readonly byteSize: number;
  readonly sha256: string;
  readonly declaredPageCount?: number | null;
  readonly correlationId: string;
  readonly processingRunId?: string;
  readonly options?: ReadDocumentOptions;
};

export type CompletedReadStatus = Extract<
  ReadStatus,
  "SUCCEEDED" | "PARTIAL" | "UNREADABLE"
>;

export type ReadDocumentResult = {
  readonly contractVersion: typeof DOCUMENT_READ_CONTRACT_VERSION;
  readonly sourceDocumentId: string;
  readonly hiveId: string;
  readonly readStatus: CompletedReadStatus;
  readonly totalPhysicalPages: number;
  readonly processedPages: readonly number[];
  readonly unreadablePages: readonly number[];
  readonly unprocessedPages: readonly number[];
  readonly sourceFingerprint: DocumentSourceFingerprint;
  readonly extractionMethod: PageExtractionMethod;
  readonly extractionMethods: readonly PageExtractionMethod[];
  readonly pages: readonly DocumentPage[];
  readonly provenance: DocumentReadProvenance;
};

/** Wire-level types for V3 Python Reader `POST /v1/read-document` (`reader-document-read@1`). */
export type ReaderWireSourceV1 = {
  readonly source_document_id: string;
  readonly hive_id: string;
  readonly owner_user_id: string;
  readonly storage_bucket: typeof HIVE_SOURCE_DOCUMENTS_BUCKET;
  readonly storage_path: string;
  readonly mime_type: string;
  readonly byte_size: number;
  readonly sha256: string;
  readonly filename: string;
};

export type ReaderWireOptionsV1 = {
  readonly max_pages?: number;
  readonly ocr_mode?: "selective" | "never";
  readonly docx_page_break_strategy?: "reproducible_v1";
};

export type ReaderWireRequestV1 = {
  readonly contract_version: typeof READER_WIRE_CONTRACT_VERSION;
  readonly source: ReaderWireSourceV1;
  readonly options?: ReaderWireOptionsV1;
  readonly extraction_schema: null;
};

export type ReaderWirePageQualityV1 = {
  readonly character_count: number;
  readonly identity_text_sufficient: boolean;
  readonly issues: readonly string[];
};

export type ReaderWirePageV1 = {
  readonly page_number: number;
  readonly text: string;
  readonly extraction_method: string;
  readonly quality: ReaderWirePageQualityV1;
};

export type ReaderWireProvenanceV1 = {
  readonly reader_git_sha: string;
  readonly reader_version: string;
  readonly tools: Readonly<Record<string, string>>;
  readonly model_calls: readonly unknown[];
};

export type ReaderWireResponseV1 = {
  readonly contract_version: typeof READER_WIRE_CONTRACT_VERSION;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly source: ReaderWireSourceV1;
  readonly source_hash_verified: boolean;
  readonly page_count: number;
  readonly pages: readonly ReaderWirePageV1[];
  readonly provenance: ReaderWireProvenanceV1;
  readonly read_fingerprint: string;
};

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/i;
const SHA256_PREFIX = "sha256:";

/**
 * File hash (`source_documents.sha256`, `document_pages.source_sha256`): 64 lowercase hex, no prefix.
 * A single leading `sha256:` is stripped so a content-digest spelling of the same file hash still matches.
 */
export function normalizeFileSha256(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  const hex = trimmed.startsWith(SHA256_PREFIX) ? trimmed.slice(SHA256_PREFIX.length) : trimmed;
  return SHA256_HEX_RE.test(hex) ? hex : null;
}

/**
 * Page-set digest, page-text digest, and other content digests: `sha256:` + 64 lowercase hex.
 * Bare 64-hex input receives the prefix. This is not a file hash.
 */
export function normalizeContentDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  const hex = trimmed.startsWith(SHA256_PREFIX) ? trimmed.slice(SHA256_PREFIX.length) : trimmed;
  return SHA256_HEX_RE.test(hex) ? `${SHA256_PREFIX}${hex}` : null;
}

/** Safe log/diagnostic shape for a hash comparison. Never includes the hash itself. */
export function fileSha256MismatchField(expected: unknown, actual: unknown): string {
  const shape = (value: unknown): { prefix: 0 | 1; length: number } => {
    if (typeof value !== "string") return { prefix: 0, length: 0 };
    const trimmed = value.trim();
    return {
      prefix: trimmed.toLowerCase().startsWith(SHA256_PREFIX) ? 1 : 0,
      length: trimmed.length,
    };
  };
  const expectedShape = shape(expected);
  const actualShape = shape(actual);
  return `expectedPrefix:${expectedShape.prefix}.expectedLength:${expectedShape.length}.actualPrefix:${actualShape.prefix}.actualLength:${actualShape.length}`;
}

export function isPageExtractionMethod(value: unknown): value is PageExtractionMethod {
  return (
    typeof value === "string" &&
    (PAGE_EXTRACTION_METHODS as readonly string[]).includes(value)
  );
}

export function isPageQualityIssue(value: unknown): value is PageQualityIssue {
  return (
    typeof value === "string" &&
    (PAGE_QUALITY_ISSUES as readonly string[]).includes(value)
  );
}

export function computeSha256Hex(textOrBytes: string | Uint8Array): string {
  return createHash("sha256").update(textOrBytes).digest("hex");
}

export function computeSha256Digest(textOrBytes: string | Uint8Array): string {
  return `sha256:${computeSha256Hex(textOrBytes)}`;
}

/**
 * Deterministic read fingerprint matching V3 Python `hive_reader.fingerprint.compute_read_fingerprint`.
 */
export function computeReadFingerprint(input: {
  readonly sourceSha256: string;
  readonly options?: Readonly<Record<string, unknown>> | null;
  readonly contractVersion?: string;
}): string {
  const contractVersion = input.contractVersion ?? READER_WIRE_CONTRACT_VERSION;
  const options = input.options ?? {};
  const sortedOptionKeys = Object.keys(options)
    .filter((key) => options[key] !== undefined && options[key] !== null)
    .sort();
  const sortedOptions: Record<string, unknown> = {};
  for (const key of sortedOptionKeys) {
    sortedOptions[key] = options[key];
  }
  const canonical = `{"contract_version":${JSON.stringify(
    contractVersion,
  )},"options":${JSON.stringify(sortedOptions)},"source_sha256":${JSON.stringify(
    input.sourceSha256.trim().toLowerCase(),
  )}}`;
  return computeSha256Hex(canonical);
}

/**
 * Canonical digest over ordered page text hashes — immutable read generation identity
 * matching V3 TypeScript `computePageSetDigest` and PostgreSQL `compute_page_set_digest`.
 */
export function computePageSetDigest(input: {
  readonly sourceSha256: string;
  readonly pageCount: number;
  readonly pages: ReadonlyArray<{
    readonly pageNumber?: number;
    readonly page_number?: number;
    readonly textSha256?: string;
    readonly page_text_sha256?: string;
  }>;
}): string {
  const source = normalizeFileSha256(input.sourceSha256) ?? input.sourceSha256.trim().toLowerCase();
  const hashes = [...input.pages]
    .sort(
      (a, b) =>
        (a.pageNumber ?? a.page_number ?? 0) - (b.pageNumber ?? b.page_number ?? 0),
    )
    .map((page) => {
      const raw = page.textSha256 ?? page.page_text_sha256 ?? "";
      return normalizeContentDigest(raw) ?? raw.trim().toLowerCase();
    })
    .join("\n");
  const material = `${DOCUMENT_PAGE_SET_DIGEST_VERSION}\n${source}\n${input.pageCount}\n${hashes}\n`;
  return computeSha256Digest(material);
}

export function expectedSourceStoragePrefix(ownerUserId: string, hiveId: string): string {
  return `${ownerUserId.trim().toLowerCase()}/${hiveId.trim().toLowerCase()}/`;
}

export function isAllowedSourceStoragePath(
  storagePath: string,
  ownerUserId: string,
  hiveId: string,
  sourceDocumentId?: string,
): boolean {
  const normalized = storagePath.trim().replace(/^\/+/, "").toLowerCase();
  const prefix = expectedSourceStoragePrefix(ownerUserId, hiveId);
  if (!normalized.startsWith(prefix)) {
    return false;
  }
  if (sourceDocumentId) {
    const docPrefix = `${prefix}${sourceDocumentId.trim().toLowerCase()}/`;
    if (!normalized.startsWith(docPrefix)) {
      return false;
    }
  }
  return !normalized.includes("..");
}

export function validateReadDocumentInput(
  input: ReadDocumentInput,
): ContractValidation<
  ReadDocumentInput & {
    readonly hiveId: string;
    readonly ownerUserId: string;
    readonly sourceDocumentId: string;
    readonly sha256: string;
    readonly maxPages: number;
    readonly ocrMode: ReaderOcrMode;
    readonly docxPageBreakStrategy: DocxPageBreakStrategy;
  }
> {
  const hiveId = input.hiveId?.trim().toLowerCase() ?? "";
  const ownerUserId = input.ownerUserId?.trim().toLowerCase() ?? "";
  const sourceDocumentId = input.sourceDocumentId?.trim().toLowerCase() ?? "";

  if (!isValidUuid(hiveId)) {
    return {
      ok: false,
      message: "Invalid Hive identifier.",
      diagnosticReason: "invalid_hive_id",
    };
  }
  if (!isValidUuid(ownerUserId)) {
    return {
      ok: false,
      message: "Invalid owner identifier.",
      diagnosticReason: "access_denied",
    };
  }
  if (!isValidUuid(sourceDocumentId)) {
    return {
      ok: false,
      message: "Invalid source document identifier.",
      diagnosticReason: "invalid_source_document_id",
    };
  }
  if (!isSourceMimeType(input.mimeType)) {
    return {
      ok: false,
      message: "Only PDF, PNG, JPG and DOCX files are supported.",
      diagnosticReason: "invalid_document_type",
    };
  }
  if (
    typeof input.byteSize !== "number" ||
    !Number.isInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > MAX_SOURCE_DOCUMENT_BYTES
  ) {
    return {
      ok: false,
      message: "Invalid source document size.",
      diagnosticReason: "invalid_document_size",
    };
  }
  const sha256 = typeof input.sha256 === "string" ? input.sha256.trim().toLowerCase() : "";
  if (!SHA256_HEX_RE.test(sha256)) {
    return {
      ok: false,
      message: "sha256 must be a 64-character hex digest.",
      diagnosticReason: "invalid_sha256",
    };
  }
  if (typeof input.storageBucket !== "string" || input.storageBucket.trim() !== HIVE_SOURCE_DOCUMENTS_BUCKET) {
    return {
      ok: false,
      message: "Storage bucket must be hive-source-documents.",
      diagnosticReason: "invalid_request",
    };
  }
  if (
    typeof input.storagePath !== "string" ||
    !isAllowedSourceStoragePath(input.storagePath, ownerUserId, hiveId, sourceDocumentId)
  ) {
    return {
      ok: false,
      message: "You do not have access to this source document.",
      diagnosticReason: "source_path_forbidden",
    };
  }

  const maxPages = input.options?.maxPages ?? DEFAULT_READER_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > DEFAULT_READER_MAX_PAGES) {
    return {
      ok: false,
      message: `maxPages must be an integer between 1 and ${DEFAULT_READER_MAX_PAGES}.`,
      diagnosticReason: "invalid_request",
    };
  }
  const ocrMode = input.options?.ocrMode ?? "selective";
  if (ocrMode !== "selective" && ocrMode !== "never") {
    return {
      ok: false,
      message: "ocrMode must be selective or never.",
      diagnosticReason: "invalid_request",
    };
  }
  const docxPageBreakStrategy = input.options?.docxPageBreakStrategy ?? "reproducible_v1";
  if (docxPageBreakStrategy !== "reproducible_v1") {
    return {
      ok: false,
      message: "Unsupported DOCX page break strategy.",
      diagnosticReason: "invalid_request",
    };
  }

  return {
    ok: true,
    value: {
      ...input,
      hiveId,
      ownerUserId,
      sourceDocumentId,
      sha256,
      maxPages,
      ocrMode,
      docxPageBreakStrategy,
    },
  };
}

export function deriveDocumentReadStatus(input: {
  readonly processedPageCount: number;
  readonly unreadablePageCount: number;
  readonly unprocessedPageCount: number;
}): CompletedReadStatus {
  if (input.processedPageCount < 1 || input.unreadablePageCount >= input.processedPageCount) {
    return "UNREADABLE";
  }
  if (input.unreadablePageCount > 0 || input.unprocessedPageCount > 0) {
    return "PARTIAL";
  }
  return "SUCCEEDED";
}

function sanitizeQualityIssues(rawIssues: unknown): {
  readonly issues: readonly PageQualityIssue[];
  readonly hadLitellmRuntimeIssue: boolean;
} {
  if (!Array.isArray(rawIssues)) {
    return { issues: [], hadLitellmRuntimeIssue: false };
  }
  const filtered: PageQualityIssue[] = [];
  let hadLitellmRuntimeIssue = false;

  for (const item of rawIssues) {
    if (typeof item !== "string") {
      continue;
    }
    // V3 Reader appends OCR_LITELLM_NOT_CONFIGURED when LITELLM_* env vars are unset.
    if (item === "OCR_LITELLM_NOT_CONFIGURED") {
      continue;
    }
    if (item.startsWith("OCR_LITELLM_")) {
      hadLitellmRuntimeIssue = true;
      continue;
    }
    if (isPageQualityIssue(item) && !filtered.includes(item)) {
      filtered.push(item);
    }
  }

  return { issues: filtered, hadLitellmRuntimeIssue };
}

function sanitizeToolsMap(rawTools: unknown): Readonly<Record<string, string>> {
  if (!rawTools || typeof rawTools !== "object" || Array.isArray(rawTools)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawTools as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string" && k.length <= 64 && v.length <= 128) {
      out[k] = v;
    }
  }
  return out;
}

export function isValidPageSetDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_DIGEST_RE.test(value.trim());
}

/**
 * Validates and normalizes V3 Python Reader `reader-document-read@1` wire response into
 * V4's `ReadDocumentResult` (`hive.doc-read/1`).
 *
 * Enforces:
 * - source identity & SHA-256 binding
 * - LiteLLM OCR and AI model calls strictly excluded
 * - contiguous 1..N physical page numbering (trimming probe page maxPages + 1 if present)
 * - 64 KiB per-page text and provenance ceilings
 * - explicit totalPhysicalPages, processedPages, unreadablePages, unprocessedPages
 */
export function normalizeReaderWireResponse(input: {
  readonly expected: {
    readonly hiveId: string;
    readonly ownerUserId: string;
    readonly sourceDocumentId: string;
    readonly mimeType: SourceMimeType;
    readonly byteSize: number;
    readonly sha256: string;
    readonly declaredPageCount?: number | null;
    readonly maxPages: number;
    readonly ocrMode: ReaderOcrMode;
    readonly docxPageBreakStrategy: DocxPageBreakStrategy;
  };
  readonly wire: unknown;
}): ContractValidation<ReadDocumentResult> {
  if (!input.wire || typeof input.wire !== "object" || Array.isArray(input.wire)) {
    return {
      ok: false,
      message: "Reader response was not a valid JSON object.",
      diagnosticReason: "reader_invalid_response",
    };
  }
  const raw = input.wire as Partial<ReaderWireResponseV1>;
  if (raw.contract_version !== READER_WIRE_CONTRACT_VERSION || raw.status !== "SUCCEEDED") {
    return {
      ok: false,
      message: "Reader response contract version or status was invalid.",
      diagnosticReason: "reader_invalid_response",
    };
  }

  const rawSource = raw.source;
  if (
    !rawSource ||
    typeof rawSource !== "object" ||
    rawSource.storage_bucket !== HIVE_SOURCE_DOCUMENTS_BUCKET ||
    rawSource.source_document_id?.trim().toLowerCase() !==
      input.expected.sourceDocumentId.toLowerCase() ||
    rawSource.hive_id?.trim().toLowerCase() !== input.expected.hiveId.toLowerCase() ||
    (typeof rawSource.owner_user_id === "string" &&
      rawSource.owner_user_id.trim().toLowerCase() !==
        input.expected.ownerUserId.toLowerCase())
  ) {
    return {
      ok: false,
      message: "This document does not belong to the Hive.",
      diagnosticReason: "page_hive_mismatch",
    };
  }

  const expectedSha = normalizeFileSha256(input.expected.sha256);
  const wireSha = normalizeFileSha256(typeof rawSource.sha256 === "string" ? rawSource.sha256 : "");
  if (raw.source_hash_verified !== true || !expectedSha || !wireSha || wireSha !== expectedSha) {
    return {
      ok: false,
      message: "The document content hash did not match the registered source.",
      diagnosticReason: "page_source_sha256_mismatch",
    };
  }

  const readFingerprint =
    typeof raw.read_fingerprint === "string" ? raw.read_fingerprint.trim() : "";
  if (readFingerprint.length === 0 || readFingerprint.length > 128) {
    return {
      ok: false,
      message: "The document read fingerprint is invalid.",
      diagnosticReason: "page_read_fingerprint_invalid",
    };
  }

  const rawProvenance = raw.provenance;
  if (!rawProvenance || typeof rawProvenance !== "object") {
    return {
      ok: false,
      message: "Reader provenance metadata is missing.",
      diagnosticReason: "reader_invalid_response",
    };
  }
  if (Array.isArray(rawProvenance.model_calls) && rawProvenance.model_calls.length > 0) {
    return {
      ok: false,
      message: "Model-backed OCR or extraction is not enabled for document reading.",
      diagnosticReason: "reader_litellm_ocr_disabled",
    };
  }

  const wirePageCount = raw.page_count;
  if (
    typeof wirePageCount !== "number" ||
    !Number.isInteger(wirePageCount) ||
    wirePageCount < 1 ||
    !Array.isArray(raw.pages) ||
    raw.pages.length !== wirePageCount
  ) {
    return {
      ok: false,
      message: "The document page numbering is invalid.",
      diagnosticReason: "page_numbering_invalid",
    };
  }

  const sortedWirePages = [...raw.pages].sort((a, b) => a.page_number - b.page_number);
  for (let i = 0; i < sortedWirePages.length; i += 1) {
    const page = sortedWirePages[i];
    if (
      !page ||
      typeof page.page_number !== "number" ||
      !Number.isInteger(page.page_number) ||
      page.page_number !== i + 1
    ) {
      return {
        ok: false,
        message: "The document page numbering is invalid.",
        diagnosticReason: "page_numbering_invalid",
      };
    }
  }

  const maxPages = input.expected.maxPages;
  const exceededMaxPagesViaProbe = sortedWirePages.length > maxPages;
  const boundedWirePages = exceededMaxPagesViaProbe
    ? sortedWirePages.slice(0, maxPages)
    : sortedWirePages;

  const readerVersion =
    typeof rawProvenance.reader_version === "string" && rawProvenance.reader_version.trim()
      ? rawProvenance.reader_version.trim()
      : "0.1.0";
  const readerGitSha =
    typeof rawProvenance.reader_git_sha === "string" && rawProvenance.reader_git_sha.trim()
      ? rawProvenance.reader_git_sha.trim()
      : "unknown";
  const tools = sanitizeToolsMap(rawProvenance.tools);

  const normalizedPages: DocumentPage[] = [];
  const processedPages: number[] = [];
  const unreadablePages: number[] = [];
  const distinctMethods: PageExtractionMethod[] = [];

  for (let i = 0; i < boundedWirePages.length; i += 1) {
    const wirePage = boundedWirePages[i]!;
    if (wirePage.extraction_method === "image_ocr_litellm") {
      return {
        ok: false,
        message: "LiteLLM OCR is not enabled for document reading.",
        diagnosticReason: "reader_litellm_ocr_disabled",
      };
    }
    if (!isPageExtractionMethod(wirePage.extraction_method)) {
      return {
        ok: false,
        message: "Unsupported page extraction method.",
        diagnosticReason: "page_invalid",
      };
    }
    if (typeof wirePage.text !== "string") {
      return {
        ok: false,
        message: "This document page could not be read.",
        diagnosticReason: "page_invalid",
      };
    }
    const byteLength = Buffer.byteLength(wirePage.text, "utf8");
    if (byteLength > MAX_DOCUMENT_PAGE_TEXT_BYTES) {
      return {
        ok: false,
        message: "A document page exceeds the maximum supported text size.",
        diagnosticReason: "payload_too_large",
      };
    }

    if (!wirePage.quality || typeof wirePage.quality !== "object") {
      return {
        ok: false,
        message: "Document page quality metadata is invalid.",
        diagnosticReason: "page_invalid",
      };
    }
    const { issues, hadLitellmRuntimeIssue } = sanitizeQualityIssues(wirePage.quality.issues);
    if (hadLitellmRuntimeIssue) {
      return {
        ok: false,
        message: "LiteLLM OCR is not enabled for document reading.",
        diagnosticReason: "reader_litellm_ocr_disabled",
      };
    }

    const identityTextSufficient = wirePage.quality.identity_text_sufficient === true;
    const hasFatalLocalOcrIssue =
      issues.includes("OCR_LOCAL_FAILED") || issues.includes("OCR_LOCAL_UNAVAILABLE");
    const isPageReadable = identityTextSufficient && !hasFatalLocalOcrIssue;

    const quality: DocumentPageQuality = {
      characterCount:
        typeof wirePage.quality.character_count === "number" &&
        Number.isInteger(wirePage.quality.character_count) &&
        wirePage.quality.character_count >= 0
          ? wirePage.quality.character_count
          : wirePage.text.length,
      identityTextSufficient,
      issues,
    };

    const pageProvenance: DocumentPageProvenance = {
      contractVersion: DOCUMENT_PAGE_PROVENANCE_VERSION,
      readerContractVersion: READER_WIRE_CONTRACT_VERSION,
      readerVersion,
      readerGitSha,
      tools,
      quality,
    };

    const provenanceBytes = Buffer.byteLength(JSON.stringify(pageProvenance), "utf8");
    if (provenanceBytes > MAX_DOCUMENT_PAGE_PROVENANCE_BYTES) {
      return {
        ok: false,
        message: "A document page exceeds the maximum supported metadata size.",
        diagnosticReason: "payload_too_large",
      };
    }

    const textSha256 = computeSha256Digest(wirePage.text);
    const pageNumber = wirePage.page_number;

    normalizedPages.push({
      pageNumber,
      text: wirePage.text,
      textSha256,
      byteLength,
      extractionMethod: wirePage.extraction_method,
      quality,
      provenance: pageProvenance,
    });
    processedPages.push(pageNumber);
    if (!isPageReadable) {
      unreadablePages.push(pageNumber);
    }
    if (!distinctMethods.includes(wirePage.extraction_method)) {
      distinctMethods.push(wirePage.extraction_method);
    }
  }

  const declaredCount =
    typeof input.expected.declaredPageCount === "number" &&
    Number.isInteger(input.expected.declaredPageCount) &&
    input.expected.declaredPageCount >= 1
      ? input.expected.declaredPageCount
      : null;

  const totalPhysicalPages = Math.max(
    normalizedPages.length,
    declaredCount ?? 0,
    sortedWirePages.length,
  );

  const unprocessedPages: number[] = [];
  for (let p = normalizedPages.length + 1; p <= totalPhysicalPages; p += 1) {
    unprocessedPages.push(p);
  }

  const canonicalReadFingerprint = exceededMaxPagesViaProbe
    ? computeReadFingerprint({
        sourceSha256: expectedSha,
        options: {
          docx_page_break_strategy: input.expected.docxPageBreakStrategy,
          max_pages: maxPages,
          ocr_mode: input.expected.ocrMode,
        },
      })
    : readFingerprint;

  const pageSetDigest = computePageSetDigest({
    sourceSha256: expectedSha,
    pageCount: normalizedPages.length,
    pages: normalizedPages,
  });

  const readStatus = deriveDocumentReadStatus({
    processedPageCount: normalizedPages.length,
    unreadablePageCount: unreadablePages.length,
    unprocessedPageCount: unprocessedPages.length,
  });

  return {
    ok: true,
    value: {
      contractVersion: DOCUMENT_READ_CONTRACT_VERSION,
      sourceDocumentId: input.expected.sourceDocumentId.toLowerCase(),
      hiveId: input.expected.hiveId.toLowerCase(),
      readStatus,
      totalPhysicalPages,
      processedPages,
      unreadablePages,
      unprocessedPages,
      sourceFingerprint: {
        sourceSha256: expectedSha,
        byteSize: input.expected.byteSize,
        mimeType: input.expected.mimeType,
        sourceHashVerified: true,
        readFingerprint: canonicalReadFingerprint,
        pageSetDigest,
      },
      extractionMethod: distinctMethods[0]!,
      extractionMethods: distinctMethods,
      pages: normalizedPages,
      provenance: {
        contractVersion: DOCUMENT_READ_CONTRACT_VERSION,
        readerContractVersion: READER_WIRE_CONTRACT_VERSION,
        readerVersion,
        readerGitSha,
        tools,
        ocrMode: input.expected.ocrMode,
        docxPageBreakStrategy: input.expected.docxPageBreakStrategy,
      },
    },
  };
}
