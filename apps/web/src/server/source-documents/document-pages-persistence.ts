import { createHiveError } from "@hiveforyou/contracts";
import {
  computePageSetDigest,
  computeSha256Digest,
  DOCUMENT_PAGE_PROVENANCE_VERSION,
  isPageExtractionMethod,
  isValidPageSetDigest,
  MAX_DOCUMENT_PAGE_PROVENANCE_BYTES,
  MAX_DOCUMENT_PAGE_TEXT_BYTES,
  type CompletedReadStatus,
  type DocumentPageProvenance,
  type PageExtractionMethod,
  type ReadDocumentResult,
} from "@hiveforyou/contracts/document-read";

import { emitStructuredEvent } from "@/server/observability/logger";

export const MAX_INLINE_DB_TRANSIENT_ATTEMPTS = 3;

export type DocumentPageRpcClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export type DocumentPageInsertRow = {
  readonly page_number: number;
  readonly page_text: string;
  readonly page_text_sha256: string;
  readonly page_byte_length: number;
  readonly extraction_method: PageExtractionMethod;
  readonly provenance_json: DocumentPageProvenance;
};

export type PersistedDocumentPageRow = {
  readonly id: string;
  readonly hive_id: string;
  readonly source_document_id: string;
  readonly source_sha256: string;
  readonly read_fingerprint: string;
  readonly page_set_digest: string;
  readonly page_count: number;
  readonly page_number: number;
  readonly page_text: string;
  readonly page_text_sha256: string;
  readonly page_byte_length: number;
  readonly extraction_method: PageExtractionMethod;
  readonly extraction_status: "SUCCEEDED";
  readonly provenance_json: DocumentPageProvenance;
  readonly created_at: string;
};

export type PutDocumentPagesOutcome = {
  readonly sourceDocumentId: string;
  readonly hiveId: string;
  readonly sourceSha256: string;
  readonly readFingerprint: string;
  readonly pageSetDigest: string;
  readonly readStatus: CompletedReadStatus;
  readonly totalPhysicalPages: number;
  readonly pageCount: number;
  readonly insertedCount: number;
  readonly replayedCount: number;
};

export type ListDocumentPagesOutcome = {
  readonly found: boolean;
  readonly sourceDocumentId: string;
  readonly hiveId: string;
  readonly sourceSha256: string;
  readonly readFingerprint: string;
  readonly pageSetDigest: string;
  readonly readStatus: string;
  readonly totalPhysicalPages: number;
  readonly pages: readonly PersistedDocumentPageRow[];
};

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

export function prepareDocumentPagesForInsert(input: {
  readonly registeredSource: {
    readonly sourceDocumentId: string;
    readonly hiveId: string;
    readonly sha256: string;
  };
  readonly readResult: ReadDocumentResult;
  readonly correlationId: string;
}): {
  readonly sourceDocumentId: string;
  readonly hiveId: string;
  readonly sourceSha256: string;
  readonly readFingerprint: string;
  readonly pageSetDigest: string;
  readonly readStatus: CompletedReadStatus;
  readonly totalPhysicalPages: number;
  readonly pageCount: number;
  readonly pages: readonly DocumentPageInsertRow[];
} {
  const { registeredSource, readResult, correlationId } = input;

  if (
    readResult.sourceDocumentId.toLowerCase() !==
      registeredSource.sourceDocumentId.toLowerCase() ||
    readResult.hiveId.toLowerCase() !== registeredSource.hiveId.toLowerCase()
  ) {
    throw createHiveError({
      errorCode: "SOURCE_ACCESS_DENIED",
      category: "SECURITY",
      stage: "READ",
      retryable: false,
      safeMessage: "This document does not belong to the Hive.",
      correlationId,
      diagnosticReason: "page_hive_mismatch",
    });
  }

  const registeredSha = registeredSource.sha256.trim().toLowerCase();
  const readSha = readResult.sourceFingerprint.sourceSha256.trim().toLowerCase();
  if (
    readResult.sourceFingerprint.sourceHashVerified !== true ||
    !SHA256_HEX_RE.test(registeredSha) ||
    !SHA256_HEX_RE.test(readSha) ||
    registeredSha !== readSha
  ) {
    throw createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "The document content hash did not match the registered source.",
      correlationId,
      diagnosticReason: "page_source_sha256_mismatch",
    });
  }

  const readFingerprint = readResult.sourceFingerprint.readFingerprint.trim();
  if (readFingerprint.length === 0 || readFingerprint.length > 128) {
    throw createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "The document read fingerprint is invalid.",
      correlationId,
      diagnosticReason: "page_read_fingerprint_invalid",
    });
  }

  const pageCount = readResult.pages.length;
  if (
    pageCount < 1 ||
    readResult.processedPages.length !== pageCount ||
    readResult.totalPhysicalPages < pageCount
  ) {
    throw createHiveError({
      errorCode: "PAGE_READ_FAILED",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "The document page numbering is invalid.",
      correlationId,
      diagnosticReason: "page_numbering_invalid",
    });
  }

  const sorted = [...readResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const rows: DocumentPageInsertRow[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const page = sorted[i]!;
    const expectedPageNumber = i + 1;
    if (
      !Number.isInteger(page.pageNumber) ||
      page.pageNumber !== expectedPageNumber
    ) {
      throw createHiveError({
        errorCode: "PAGE_READ_FAILED",
        category: "DOCUMENT",
        stage: "READ",
        retryable: false,
        safeMessage: "The document page numbering is invalid.",
        correlationId,
        diagnosticReason: "page_numbering_invalid",
      });
    }
    if (typeof page.text !== "string" || !isPageExtractionMethod(page.extractionMethod)) {
      throw createHiveError({
        errorCode: "PAGE_READ_FAILED",
        category: "DOCUMENT",
        stage: "READ",
        retryable: false,
        safeMessage: "This document page could not be saved.",
        correlationId,
        diagnosticReason: "page_invalid",
      });
    }

    const byteLength = Buffer.byteLength(page.text, "utf8");
    if (byteLength > MAX_DOCUMENT_PAGE_TEXT_BYTES) {
      throw createHiveError({
        errorCode: "PAGE_READ_FAILED",
        category: "DOCUMENT",
        stage: "READ",
        retryable: false,
        safeMessage: "A document page exceeds the maximum supported text size.",
        correlationId,
        diagnosticReason: "payload_too_large",
      });
    }

    const computedSha = computeSha256Digest(page.text);
    if (page.textSha256.toLowerCase() !== computedSha.toLowerCase() || page.byteLength !== byteLength) {
      throw createHiveError({
        errorCode: "PAGE_READ_FAILED",
        category: "DOCUMENT",
        stage: "READ",
        retryable: false,
        safeMessage: "Document page digest did not match page text.",
        correlationId,
        diagnosticReason: "page_invalid",
      });
    }

    const provenanceJson: DocumentPageProvenance = {
      contractVersion: DOCUMENT_PAGE_PROVENANCE_VERSION,
      readerContractVersion: page.provenance.readerContractVersion,
      readerVersion: page.provenance.readerVersion,
      readerGitSha: page.provenance.readerGitSha,
      tools: page.provenance.tools,
      quality: page.quality,
    };

    const provenanceBytes = Buffer.byteLength(JSON.stringify(provenanceJson), "utf8");
    if (provenanceBytes > MAX_DOCUMENT_PAGE_PROVENANCE_BYTES) {
      throw createHiveError({
        errorCode: "PAGE_READ_FAILED",
        category: "DOCUMENT",
        stage: "READ",
        retryable: false,
        safeMessage: "A document page exceeds the maximum supported metadata size.",
        correlationId,
        diagnosticReason: "payload_too_large",
      });
    }

    rows.push({
      page_number: page.pageNumber,
      page_text: page.text,
      page_text_sha256: computedSha,
      page_byte_length: byteLength,
      extraction_method: page.extractionMethod,
      provenance_json: provenanceJson,
    });
  }

  const computedSetDigest = computePageSetDigest({
    sourceSha256: registeredSha,
    pageCount,
    pages: rows,
  });

  if (
    !isValidPageSetDigest(readResult.sourceFingerprint.pageSetDigest) ||
    readResult.sourceFingerprint.pageSetDigest.toLowerCase() !== computedSetDigest.toLowerCase()
  ) {
    throw createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "The document page generation digest is invalid.",
      correlationId,
      diagnosticReason: "page_set_digest_mismatch",
    });
  }

  return {
    sourceDocumentId: registeredSource.sourceDocumentId.toLowerCase(),
    hiveId: registeredSource.hiveId.toLowerCase(),
    sourceSha256: registeredSha,
    readFingerprint,
    pageSetDigest: computedSetDigest,
    readStatus: readResult.readStatus,
    totalPhysicalPages: readResult.totalPhysicalPages,
    pageCount,
    pages: rows,
  };
}

function isTransientRpcFailure(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof (error as { message?: unknown })?.message === "string"
        ? (error as { message: string }).message.toLowerCase()
        : "";
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("deadlock") ||
    message.includes("connection") ||
    message.includes("temporarily unavailable") ||
    message.includes("db_transient")
  );
}

function mapSqlErrorToHiveError(
  error: unknown,
  correlationId: string,
): ReturnType<typeof createHiveError> | null {
  if (
    error &&
    typeof error === "object" &&
    "errorCode" in error &&
    "stage" in error &&
    typeof (error as { errorCode?: unknown }).errorCode === "string"
  ) {
    return error as ReturnType<typeof createHiveError>;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === "string"
        ? (error as { message: string }).message
        : "";

  if (message.includes("page_hive_mismatch") || message.includes("access_denied")) {
    return createHiveError({
      errorCode: "SOURCE_ACCESS_DENIED",
      category: "SECURITY",
      stage: "READ",
      retryable: false,
      safeMessage: "This document does not belong to the Hive.",
      correlationId,
      diagnosticReason: "page_hive_mismatch",
      cause: error,
    });
  }
  if (message.includes("page_source_sha256_mismatch")) {
    return createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "The document content hash did not match the registered source.",
      correlationId,
      diagnosticReason: "page_source_sha256_mismatch",
      cause: error,
    });
  }
  if (message.includes("page_read_fingerprint_invalid")) {
    return createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "The document read fingerprint is invalid.",
      correlationId,
      diagnosticReason: "page_read_fingerprint_invalid",
      cause: error,
    });
  }
  if (message.includes("page_numbering_invalid")) {
    return createHiveError({
      errorCode: "PAGE_READ_FAILED",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "The document page numbering is invalid.",
      correlationId,
      diagnosticReason: "page_numbering_invalid",
      cause: error,
    });
  }
  if (message.includes("page_payload_too_large")) {
    return createHiveError({
      errorCode: "PAGE_READ_FAILED",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "A document page exceeds the maximum supported text size.",
      correlationId,
      diagnosticReason: "payload_too_large",
      cause: error,
    });
  }
  if (message.includes("page_hash_conflict")) {
    return createHiveError({
      errorCode: "IDEMPOTENCY_CONFLICT",
      category: "PERSISTENCE",
      stage: "READ",
      retryable: false,
      safeMessage: "This document page conflicts with one already saved.",
      correlationId,
      diagnosticReason: "page_hash_conflict",
      cause: error,
    });
  }
  if (message.includes("page_set_digest_invalid") || message.includes("page_set_digest_mismatch")) {
    return createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "The document page generation digest is invalid.",
      correlationId,
      diagnosticReason: "page_set_digest_mismatch",
      cause: error,
    });
  }
  if (message.includes("page_generation_incomplete")) {
    return createHiveError({
      errorCode: "COVERAGE_INCOMPLETE",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "Persisted document pages are incomplete for this generation.",
      correlationId,
      diagnosticReason: "page_generation_incomplete",
      cause: error,
    });
  }
  if (message.includes("page_invalid")) {
    return createHiveError({
      errorCode: "PAGE_READ_FAILED",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "This document page could not be saved.",
      correlationId,
      diagnosticReason: "page_invalid",
      cause: error,
    });
  }
  if (message.includes("document_not_found")) {
    return createHiveError({
      errorCode: "NOT_FOUND",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "The source document was not found.",
      correlationId,
      diagnosticReason: "document_not_found",
      cause: error,
    });
  }
  return null;
}

async function invokeRpc(
  client: DocumentPageRpcClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    throw new Error(error.message ?? `${fn} failed`);
  }
  if (data === null || data === undefined) {
    throw new Error(`${fn}: empty RPC response`);
  }
  return typeof data === "string" ? (JSON.parse(data) as unknown) : data;
}

function samePersistedPages(
  existing: ListDocumentPagesOutcome,
  prepared: ReturnType<typeof prepareDocumentPagesForInsert>,
): boolean {
  if (!existing.found || existing.pages.length !== prepared.pageCount) {
    return false;
  }
  if (
    existing.sourceDocumentId.toLowerCase() !== prepared.sourceDocumentId ||
    existing.hiveId.toLowerCase() !== prepared.hiveId ||
    existing.sourceSha256.toLowerCase() !== prepared.sourceSha256 ||
    existing.readFingerprint !== prepared.readFingerprint ||
    existing.pageSetDigest.toLowerCase() !== prepared.pageSetDigest.toLowerCase()
  ) {
    return false;
  }
  for (let i = 0; i < prepared.pages.length; i += 1) {
    const target = prepared.pages[i]!;
    const stored = existing.pages[i];
    if (!stored) {
      return false;
    }
    if (
      stored.page_number !== target.page_number ||
      stored.page_count !== prepared.pageCount ||
      stored.source_sha256.toLowerCase() !== prepared.sourceSha256 ||
      stored.read_fingerprint !== prepared.readFingerprint ||
      stored.page_text_sha256.toLowerCase() !== target.page_text_sha256.toLowerCase() ||
      stored.page_byte_length !== target.page_byte_length ||
      stored.page_text !== target.page_text ||
      stored.extraction_method !== target.extraction_method
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Independently loads persisted `hive.document_pages` rows for a Hive and source document,
 * verifying contiguous page numbering, SHA-256 digests, and byte lengths on readback.
 */
export async function listDocumentPagesForSource(
  client: DocumentPageRpcClient,
  input: {
    readonly hiveId: string;
    readonly sourceDocumentId: string;
    readonly readFingerprint: string;
    readonly pageSetDigest: string;
    readonly expectedSourceSha256?: string;
    readonly correlationId: string;
  },
): Promise<ListDocumentPagesOutcome> {
  const correlationId = input.correlationId;

  for (let attempt = 1; attempt <= MAX_INLINE_DB_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      const raw = (await invokeRpc(client, "list_document_pages", {
        p_hive_id: input.hiveId.trim().toLowerCase(),
        p_source_document_id: input.sourceDocumentId.trim().toLowerCase(),
        p_read_fingerprint: input.readFingerprint.trim(),
        p_page_set_digest: input.pageSetDigest.trim().toLowerCase(),
      })) as Record<string, unknown>;

      const sourceDocumentId =
        typeof raw.source_document_id === "string" ? raw.source_document_id : "";
      const hiveId = typeof raw.hive_id === "string" ? raw.hive_id : "";
      const sourceSha256 = typeof raw.source_sha256 === "string" ? raw.source_sha256 : "";
      const readFingerprint =
        typeof raw.read_fingerprint === "string" ? raw.read_fingerprint : "";
      const pageSetDigest = typeof raw.page_set_digest === "string" ? raw.page_set_digest : "";
      const readStatus = typeof raw.read_status === "string" ? raw.read_status : "PENDING";
      const totalPhysicalPages =
        typeof raw.total_physical_pages === "number" ? raw.total_physical_pages : 0;

      if (
        !sourceDocumentId ||
        !hiveId ||
        !sourceSha256 ||
        !readFingerprint ||
        !pageSetDigest ||
        !Array.isArray(raw.pages)
      ) {
        throw createHiveError({
          errorCode: "PAGE_READ_FAILED",
          category: "PERSISTENCE",
          stage: "READ",
          retryable: false,
          safeMessage: "Persisted document pages could not be read.",
          correlationId,
          diagnosticReason: "persistence_corrupt_jsonb",
        });
      }

      if (hiveId.toLowerCase() !== input.hiveId.trim().toLowerCase()) {
        throw createHiveError({
          errorCode: "SOURCE_ACCESS_DENIED",
          category: "SECURITY",
          stage: "READ",
          retryable: false,
          safeMessage: "This document does not belong to the Hive.",
          correlationId,
          diagnosticReason: "page_hive_mismatch",
        });
      }

      const expectedSha = input.expectedSourceSha256?.trim().toLowerCase();
      if (expectedSha && sourceSha256.trim().toLowerCase() !== expectedSha) {
        throw createHiveError({
          errorCode: "INVALID_DOCUMENT",
          category: "DOCUMENT",
          stage: "READ",
          retryable: false,
          safeMessage: "The document content hash did not match the registered source.",
          correlationId,
          diagnosticReason: "page_source_sha256_mismatch",
        });
      }

      const pages = raw.pages as PersistedDocumentPageRow[];
      if (pages.length > 0) {
        const declaredCount = pages[0]!.page_count;
        if (
          typeof declaredCount !== "number" ||
          !Number.isInteger(declaredCount) ||
          declaredCount < 1 ||
          pages.length !== declaredCount
        ) {
          throw createHiveError({
            errorCode: "COVERAGE_INCOMPLETE",
            category: "DOCUMENT",
            stage: "READ",
            retryable: false,
            safeMessage: "Persisted document page count is incomplete or inconsistent.",
            correlationId,
            diagnosticReason: "persistence_corrupt_jsonb",
          });
        }

        for (let i = 0; i < pages.length; i += 1) {
          const row = pages[i]!;
          const expectedPageNum = i + 1;
          if (
            row.page_number !== expectedPageNum ||
            row.page_count !== declaredCount ||
            row.source_document_id.toLowerCase() !== sourceDocumentId.toLowerCase() ||
            row.hive_id.toLowerCase() !== hiveId.toLowerCase() ||
            row.source_sha256.trim().toLowerCase() !== sourceSha256.trim().toLowerCase() ||
            typeof row.page_text !== "string" ||
            !isValidPageSetDigest(row.page_text_sha256)
          ) {
            throw createHiveError({
              errorCode: "PAGE_READ_FAILED",
              category: "PERSISTENCE",
              stage: "READ",
              retryable: false,
              safeMessage: "Persisted document page metadata is inconsistent.",
              correlationId,
              diagnosticReason: "persistence_corrupt_jsonb",
            });
          }

          const computedByteLen = Buffer.byteLength(row.page_text, "utf8");
          const computedDigest = computeSha256Digest(row.page_text);
          if (
            computedByteLen > MAX_DOCUMENT_PAGE_TEXT_BYTES ||
            row.page_byte_length !== computedByteLen ||
            row.page_text_sha256.toLowerCase() !== computedDigest.toLowerCase()
          ) {
            throw createHiveError({
              errorCode: "PAGE_READ_FAILED",
              category: "PERSISTENCE",
              stage: "READ",
              retryable: false,
              safeMessage: "Persisted document page text failed integrity verification.",
              correlationId,
              diagnosticReason: "artifact_hash_mismatch",
            });
          }
        }
      }

      return {
        found: pages.length > 0,
        sourceDocumentId: sourceDocumentId.toLowerCase(),
        hiveId: hiveId.toLowerCase(),
        sourceSha256: sourceSha256.trim().toLowerCase(),
        readFingerprint: readFingerprint.trim(),
        pageSetDigest: pageSetDigest.trim().toLowerCase(),
        readStatus,
        totalPhysicalPages: totalPhysicalPages || pages.length,
        pages,
      };
    } catch (error) {
      const mapped = mapSqlErrorToHiveError(error, correlationId);
      if (mapped) {
        throw mapped;
      }
      if (!isTransientRpcFailure(error)) {
        throw createHiveError({
          errorCode: "PERSISTENCE_FAILED",
          category: "PERSISTENCE",
          stage: "READ",
          retryable: false,
          safeMessage: "Persisted document pages could not be loaded.",
          correlationId,
          diagnosticReason: "page_persistence_failed",
          cause: error,
        });
      }
    }
  }

  throw createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "READ",
    retryable: true,
    safeMessage: "Loading source pages is temporarily unavailable. Please try again.",
    correlationId,
    diagnosticReason: "db_transient",
  });
}

/**
 * Idempotently persists all Reader-extracted pages and updates `hive.source_documents`
 * (`read_status`, `page_count`). On a transient failure with unknown commit outcome,
 * reads back persisted pages by `(hive_id, source_document_id, read_fingerprint, page_set_digest)`
 * before retrying; identical content succeeds, conflicting content fails closed.
 */
export async function putDocumentPagesForSource(
  client: DocumentPageRpcClient,
  input: {
    readonly correlationId: string;
    readonly processingRunId?: string;
    readonly registeredSource: {
      readonly sourceDocumentId: string;
      readonly hiveId: string;
      readonly sha256: string;
    };
    readonly readResult: ReadDocumentResult;
  },
): Promise<PutDocumentPagesOutcome> {
  const startedAt = Date.now();
  const { correlationId } = input;

  let prepared: ReturnType<typeof prepareDocumentPagesForInsert>;
  try {
    prepared = prepareDocumentPagesForInsert({
      registeredSource: input.registeredSource,
      readResult: input.readResult,
      correlationId,
    });
  } catch (error) {
    const mapped =
      mapSqlErrorToHiveError(error, correlationId) ??
      createHiveError({
        errorCode: "PAGE_READ_FAILED",
        category: "DOCUMENT",
        stage: "READ",
        retryable: false,
        safeMessage: "This document page could not be saved.",
        correlationId,
        diagnosticReason: "page_invalid",
        cause: error,
      });

    emitStructuredEvent({
      eventName: "putDocumentPages.failed",
      severity: "ERROR",
      timestamp: new Date().toISOString(),
      component: "sourceDocuments",
      operation: "putDocumentPages",
      stage: "READ",
      correlationId,
      hiveId: input.registeredSource.hiveId,
      sourceDocumentId: input.registeredSource.sourceDocumentId,
      ...(input.processingRunId ? { processingRunId: input.processingRunId } : {}),
      status: "FAILED",
      errorCode: mapped.errorCode,
      retryable: mapped.retryable,
      durationMs: Date.now() - startedAt,
      diagnosticReason: mapped.diagnosticReason ?? "page_invalid",
    });
    throw mapped;
  }

  for (let attempt = 1; attempt <= MAX_INLINE_DB_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      const data = (await invokeRpc(client, "put_document_pages", {
        p_hive_id: prepared.hiveId,
        p_source_document_id: prepared.sourceDocumentId,
        p_source_sha256: prepared.sourceSha256,
        p_read_fingerprint: prepared.readFingerprint,
        p_page_set_digest: prepared.pageSetDigest,
        p_read_status: prepared.readStatus,
        p_total_physical_pages: prepared.totalPhysicalPages,
        p_page_count: prepared.pageCount,
        p_pages: prepared.pages,
      })) as Record<string, unknown>;

      const insertedCount = Number(data.inserted_count ?? 0);
      const replayedCount = Number(data.replayed_count ?? 0);

      emitStructuredEvent({
        eventName: "putDocumentPages.completed",
        severity: "INFO",
        timestamp: new Date().toISOString(),
        component: "sourceDocuments",
        operation: "putDocumentPages",
        stage: "READ",
        correlationId,
        hiveId: prepared.hiveId,
        sourceDocumentId: prepared.sourceDocumentId,
        ...(input.processingRunId ? { processingRunId: input.processingRunId } : {}),
        status: "SUCCEEDED",
        attempt,
        durationMs: Date.now() - startedAt,
      });

      return {
        sourceDocumentId: prepared.sourceDocumentId,
        hiveId: String(data.hive_id ?? prepared.hiveId).toLowerCase(),
        sourceSha256: prepared.sourceSha256,
        readFingerprint: prepared.readFingerprint,
        pageSetDigest: prepared.pageSetDigest,
        readStatus: prepared.readStatus,
        totalPhysicalPages: prepared.totalPhysicalPages,
        pageCount: prepared.pageCount,
        insertedCount,
        replayedCount,
      };
    } catch (error) {
      const mapped = mapSqlErrorToHiveError(error, correlationId);
      if (mapped) {
        emitStructuredEvent({
          eventName: "putDocumentPages.failed",
          severity: "ERROR",
          timestamp: new Date().toISOString(),
          component: "sourceDocuments",
          operation: "putDocumentPages",
          stage: "READ",
          correlationId,
          hiveId: prepared.hiveId,
          sourceDocumentId: prepared.sourceDocumentId,
          ...(input.processingRunId ? { processingRunId: input.processingRunId } : {}),
          status: "FAILED",
          errorCode: mapped.errorCode,
          retryable: mapped.retryable,
          attempt,
          durationMs: Date.now() - startedAt,
          diagnosticReason: mapped.diagnosticReason ?? "page_persistence_failed",
        });
        throw mapped;
      }

      if (!isTransientRpcFailure(error)) {
        const nonRetryable = createHiveError({
          errorCode: "PERSISTENCE_FAILED",
          category: "PERSISTENCE",
          stage: "READ",
          retryable: false,
          safeMessage: "Could not save document pages.",
          correlationId,
          diagnosticReason: "page_persistence_failed",
          cause: error,
        });
        emitStructuredEvent({
          eventName: "putDocumentPages.failed",
          severity: "ERROR",
          timestamp: new Date().toISOString(),
          component: "sourceDocuments",
          operation: "putDocumentPages",
          stage: "READ",
          correlationId,
          hiveId: prepared.hiveId,
          sourceDocumentId: prepared.sourceDocumentId,
          ...(input.processingRunId ? { processingRunId: input.processingRunId } : {}),
          status: "FAILED",
          errorCode: nonRetryable.errorCode,
          retryable: false,
          attempt,
          durationMs: Date.now() - startedAt,
          diagnosticReason: "page_persistence_failed",
        });
        throw nonRetryable;
      }

      // Transient failure with uncertain commit outcome: read back before retrying.
      let existing: ListDocumentPagesOutcome;
      try {
        existing = await listDocumentPagesForSource(client, {
          hiveId: prepared.hiveId,
          sourceDocumentId: prepared.sourceDocumentId,
          readFingerprint: prepared.readFingerprint,
          pageSetDigest: prepared.pageSetDigest,
          expectedSourceSha256: prepared.sourceSha256,
          correlationId,
        });
      } catch (readError) {
        const mappedReadErr = mapSqlErrorToHiveError(readError, correlationId);
        if (mappedReadErr && mappedReadErr.retryable) {
          continue;
        }
        throw mappedReadErr ?? readError;
      }

      if (existing.found) {
        if (samePersistedPages(existing, prepared)) {
          emitStructuredEvent({
            eventName: "putDocumentPages.completed",
            severity: "INFO",
            timestamp: new Date().toISOString(),
            component: "sourceDocuments",
            operation: "putDocumentPages",
            stage: "READ",
            correlationId,
            hiveId: prepared.hiveId,
            sourceDocumentId: prepared.sourceDocumentId,
            ...(input.processingRunId ? { processingRunId: input.processingRunId } : {}),
            status: "SUCCEEDED",
            attempt,
            durationMs: Date.now() - startedAt,
          });
          return {
            sourceDocumentId: prepared.sourceDocumentId,
            hiveId: existing.hiveId,
            sourceSha256: prepared.sourceSha256,
            readFingerprint: prepared.readFingerprint,
            pageSetDigest: prepared.pageSetDigest,
            readStatus: prepared.readStatus,
            totalPhysicalPages: prepared.totalPhysicalPages,
            pageCount: prepared.pageCount,
            insertedCount: 0,
            replayedCount: prepared.pageCount,
          };
        }
        const conflict = createHiveError({
          errorCode: "IDEMPOTENCY_CONFLICT",
          category: "PERSISTENCE",
          stage: "READ",
          retryable: false,
          safeMessage: "This document page conflicts with one already saved.",
          correlationId,
          diagnosticReason: "page_hash_conflict",
        });
        emitStructuredEvent({
          eventName: "putDocumentPages.failed",
          severity: "ERROR",
          timestamp: new Date().toISOString(),
          component: "sourceDocuments",
          operation: "putDocumentPages",
          stage: "READ",
          correlationId,
          hiveId: prepared.hiveId,
          sourceDocumentId: prepared.sourceDocumentId,
          ...(input.processingRunId ? { processingRunId: input.processingRunId } : {}),
          status: "FAILED",
          errorCode: conflict.errorCode,
          retryable: false,
          attempt,
          durationMs: Date.now() - startedAt,
          diagnosticReason: "page_hash_conflict",
        });
        throw conflict;
      }
    }
  }

  const exhausted = createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "READ",
    retryable: true,
    safeMessage: "Saving source pages is temporarily unavailable. Please try again.",
    correlationId,
    diagnosticReason: "db_transient",
  });
  emitStructuredEvent({
    eventName: "putDocumentPages.failed",
    severity: "ERROR",
    timestamp: new Date().toISOString(),
    component: "sourceDocuments",
    operation: "putDocumentPages",
    stage: "READ",
    correlationId,
    hiveId: prepared.hiveId,
    sourceDocumentId: prepared.sourceDocumentId,
    ...(input.processingRunId ? { processingRunId: input.processingRunId } : {}),
    status: "FAILED",
    errorCode: exhausted.errorCode,
    retryable: true,
    durationMs: Date.now() - startedAt,
    diagnosticReason: "db_transient",
  });
  throw exhausted;
}
