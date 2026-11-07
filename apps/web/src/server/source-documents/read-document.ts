import { createHiveError, type Hive, type SourceMimeType } from "@hiveforyou/contracts";
import {
  computeReadFingerprint,
  DEFAULT_READER_MAX_PAGES,
  fileSha256MismatchField,
  HIVE_SOURCE_DOCUMENTS_BUCKET,
  normalizeFileSha256,
  normalizeReaderWireResponse,
  READER_HTTP_HEADERS,
  READER_WIRE_CONTRACT_VERSION,
  type ReadDocumentInput,
  type ReadDocumentResult,
  type ReaderWireRequestV1,
  validateReadDocumentInput,
} from "@hiveforyou/contracts/document-read";

import { emitStructuredEvent } from "@/server/observability/logger";

export const DEFAULT_READER_HTTP_TIMEOUT_MS = 120_000;

/** Max HTTP wait: 180 s active document-read lease minus 15 s safety margin (D-038). */
export const MAX_READER_HTTP_TIMEOUT_MS = 165_000;

export const READER_CONFIG_DIAGNOSTIC_REASONS = [
  "reader_config_invalid_timeout",
  "reader_config_invalid_base_url",
] as const;

export type ReaderConfigDiagnosticReason = (typeof READER_CONFIG_DIAGNOSTIC_REASONS)[number];

export type ReaderConfigurationError = ReturnType<typeof createHiveError> & {
  readonly diagnosticReason: ReaderConfigDiagnosticReason;
};

function createReaderConfigurationError(
  diagnosticReason: ReaderConfigDiagnosticReason,
  correlationId: string,
): ReaderConfigurationError {
  return createHiveError({
    errorCode: "INTERNAL_ERROR",
    category: "INTERNAL",
    stage: "READ",
    retryable: false,
    safeMessage:
      "Document reader service is not configured correctly. Contact support with your reference.",
    correlationId,
    diagnosticReason,
  }) as ReaderConfigurationError;
}

export function isReaderConfigurationError(error: unknown): error is ReaderConfigurationError {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { diagnosticReason?: unknown };
  return (
    typeof record.diagnosticReason === "string" &&
    (READER_CONFIG_DIAGNOSTIC_REASONS as readonly string[]).includes(record.diagnosticReason)
  );
}

function resolveReaderHttpTimeoutMs(
  rawTimeout: string | undefined,
  correlationId: string,
): number {
  const trimmed = rawTimeout?.trim();
  if (!trimmed) {
    return DEFAULT_READER_HTTP_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw createReaderConfigurationError("reader_config_invalid_timeout", correlationId);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed <= 0 || parsed > MAX_READER_HTTP_TIMEOUT_MS) {
    throw createReaderConfigurationError("reader_config_invalid_timeout", correlationId);
  }
  return parsed;
}

export function assertValidReaderBaseUrl(baseUrl: string, correlationId: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw createReaderConfigurationError("reader_config_invalid_base_url", correlationId);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw createReaderConfigurationError("reader_config_invalid_base_url", correlationId);
  }

  if (parsed.username || parsed.password) {
    throw createReaderConfigurationError("reader_config_invalid_base_url", correlationId);
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    throw createReaderConfigurationError("reader_config_invalid_base_url", correlationId);
  }

  if (!parsed.hostname) {
    throw createReaderConfigurationError("reader_config_invalid_base_url", correlationId);
  }

  return trimmed;
}

function resolveConfiguredReaderTimeoutMs(
  timeoutMs: number | undefined,
  correlationId: string,
): number {
  const resolved = timeoutMs ?? DEFAULT_READER_HTTP_TIMEOUT_MS;
  if (
    !Number.isFinite(resolved) ||
    resolved <= 0 ||
    resolved > MAX_READER_HTTP_TIMEOUT_MS ||
    !Number.isInteger(resolved)
  ) {
    throw createReaderConfigurationError("reader_config_invalid_timeout", correlationId);
  }
  return resolved;
}

export type RegisteredSourceMetadata = {
  readonly id: string;
  readonly hiveId: string;
  readonly ownerUserId: string;
  readonly fileName: string;
  readonly mimeType: SourceMimeType;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageBucket: string;
  readonly storagePath: string;
  readonly pageCount: number | null;
};

export type ReaderServiceConfig = {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly timeoutMs?: number;
};

export type ReadDocumentDeps = {
  readonly loadOwnedHive: (
    userId: string,
    hiveId: string,
    correlationId: string,
  ) => Promise<Hive>;
  readonly loadRegisteredSource?: (input: {
    readonly ownerUserId: string;
    readonly hiveId: string;
    readonly sourceDocumentId: string;
    readonly correlationId: string;
  }) => Promise<RegisteredSourceMetadata | undefined>;
  readonly getReaderConfig?: () => ReaderServiceConfig;
  readonly fetchFn?: typeof fetch;
};

export function loadReaderServiceConfig(
  env: NodeJS.ProcessEnv = process.env,
  correlationId = "00000000-0000-4000-8000-000000000000",
): ReaderServiceConfig {
  const baseUrl = env.READER_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const serviceToken = env.READER_SERVICE_TOKEN?.trim() ?? "";
  if (!baseUrl || !serviceToken) {
    throw createHiveError({
      errorCode: "PAGE_READ_FAILED",
      category: "DEPENDENCY",
      stage: "READ",
      retryable: true,
      safeMessage: "Document reader service is temporarily unavailable. Please try again.",
      correlationId,
      diagnosticReason: "reader_unconfigured",
    });
  }
  const timeoutMs = resolveReaderHttpTimeoutMs(env.WORKER_READER_HTTP_TIMEOUT_MS, correlationId);
  const validatedBaseUrl = assertValidReaderBaseUrl(baseUrl, correlationId);

  return {
    baseUrl: validatedBaseUrl,
    serviceToken,
    timeoutMs,
  };
}

type ReaderErrorEnvelope = {
  readonly contract_version?: unknown;
  readonly error_code?: unknown;
  readonly category?: unknown;
  readonly retryable?: unknown;
  readonly message_safe?: unknown;
};

function mapValidationFailureToHiveError(
  diagnosticReason: string,
  message: string,
  correlationId: string,
) {
  if (diagnosticReason === "access_denied" || diagnosticReason === "source_path_forbidden") {
    return createHiveError({
      errorCode: "SOURCE_ACCESS_DENIED",
      category: "SECURITY",
      stage: "READ",
      retryable: false,
      safeMessage: "You do not have access to this source document.",
      correlationId,
      diagnosticReason,
    });
  }
  if (
    diagnosticReason === "invalid_document_type" ||
    diagnosticReason === "invalid_document_size" ||
    diagnosticReason === "invalid_sha256"
  ) {
    return createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: message,
      correlationId,
      diagnosticReason,
    });
  }
  return createHiveError({
    errorCode: "INVALID_REQUEST",
    category: "VALIDATION",
    stage: "READ",
    retryable: false,
    safeMessage: message,
    correlationId,
    diagnosticReason,
  });
}

function mapReaderHttpErrorToHiveError(input: {
  readonly status: number;
  readonly envelope: ReaderErrorEnvelope | null;
  readonly correlationId: string;
}) {
  const code =
    typeof input.envelope?.error_code === "string"
      ? input.envelope.error_code.trim().toUpperCase()
      : "";
  const retryableFromEnvelope =
    typeof input.envelope?.retryable === "boolean" ? input.envelope.retryable : undefined;

  if (input.status === 401 || code === "AUTH_FAILED") {
    return createHiveError({
      errorCode: "PAGE_READ_FAILED",
      category: "DEPENDENCY",
      stage: "READ",
      retryable: false,
      safeMessage: "Document reader authentication failed. Contact support with your reference.",
      correlationId: input.correlationId,
      diagnosticReason: "reader_auth_failed",
    });
  }

  if (input.status === 403 || code === "ACCESS_DENIED") {
    return createHiveError({
      errorCode: "SOURCE_ACCESS_DENIED",
      category: "SECURITY",
      stage: "READ",
      retryable: false,
      safeMessage: "You do not have access to this source document.",
      correlationId: input.correlationId,
      diagnosticReason: "source_path_forbidden",
    });
  }

  if (input.status === 404 || code === "STORAGE_NOT_FOUND") {
    return createHiveError({
      errorCode: "NOT_FOUND",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: "We could not find that document in storage.",
      correlationId: input.correlationId,
      diagnosticReason: "source_object_missing",
    });
  }

  if (code === "STORAGE_UNAVAILABLE") {
    return createHiveError({
      errorCode: "STORAGE_UNAVAILABLE",
      category: "DEPENDENCY",
      stage: "READ",
      retryable: retryableFromEnvelope ?? true,
      safeMessage: "Document storage is temporarily unavailable. Please try again.",
      correlationId: input.correlationId,
      diagnosticReason: "storage_failed",
    });
  }

  if (input.status === 400 || code === "INVALID_REQUEST") {
    const safeMsg =
      typeof input.envelope?.message_safe === "string"
        ? input.envelope.message_safe.toLowerCase()
        : "";
    const isHashOrSizeMismatch =
      safeMsg.includes("hash") || safeMsg.includes("size");
    return createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: isHashOrSizeMismatch
        ? "The document content hash did not match the registered source."
        : "This document could not be read due to an invalid format or request.",
      correlationId: input.correlationId,
      diagnosticReason: isHashOrSizeMismatch
        ? "page_source_sha256_mismatch"
        : "invalid_request",
    });
  }

  if (input.status === 504 || code === "MODEL_TIMEOUT") {
    return createHiveError({
      errorCode: "PAGE_READ_FAILED",
      category: "DEPENDENCY",
      stage: "READ",
      retryable: true,
      safeMessage: "Reading this document timed out. You can try again.",
      correlationId: input.correlationId,
      diagnosticReason: "reader_timeout",
    });
  }

  if (input.status >= 500 || code === "DEPENDENCY_UNAVAILABLE") {
    return createHiveError({
      errorCode: "PAGE_READ_FAILED",
      category: "DEPENDENCY",
      stage: "READ",
      retryable: retryableFromEnvelope ?? true,
      safeMessage: "Document reader service is temporarily unavailable. Please try again.",
      correlationId: input.correlationId,
      diagnosticReason: "reader_unavailable",
    });
  }

  return createHiveError({
    errorCode: "PAGE_READ_FAILED",
    category: "DOCUMENT",
    stage: "READ",
    retryable: false,
    safeMessage: "We could not read this document. Verify the file is not corrupted or password-protected.",
    correlationId: input.correlationId,
    diagnosticReason: "reader_extraction_failed",
  });
}

function mapNormalizationFailureToHiveError(
  diagnosticReason: string,
  message: string,
  correlationId: string,
) {
  if (diagnosticReason === "page_hive_mismatch") {
    return createHiveError({
      errorCode: "SOURCE_ACCESS_DENIED",
      category: "SECURITY",
      stage: "READ",
      retryable: false,
      safeMessage: message,
      correlationId,
      diagnosticReason,
    });
  }
  if (diagnosticReason === "page_source_sha256_mismatch") {
    return createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      safeMessage: message,
      correlationId,
      diagnosticReason,
    });
  }
  return createHiveError({
    errorCode: "PAGE_READ_FAILED",
    category: "DOCUMENT",
    stage: "READ",
    retryable: false,
    safeMessage: message,
    correlationId,
    diagnosticReason,
  });
}

/**
 * Thin V4 boundary over the V3 Python Reader (`POST /v1/read-document`).
 *
 * - Enforces V4 Hive & source document ownership before any Reader call
 * - Supports PDF, PNG, JPEG, and DOCX (`reproducible_v1`) with local Tesseract OCR
 * - Strictly excludes LiteLLM OCR and AI fact extraction
 * - Returns explicit totalPhysicalPages, processedPages, unreadablePages, unprocessedPages,
 *   sourceFingerprint, extractionMethod, and provenance
 */
export async function readDocument(
  deps: ReadDocumentDeps,
  input: ReadDocumentInput,
): Promise<ReadDocumentResult> {
  const startedAt = Date.now();
  const correlationId = input.correlationId;

  const validated = validateReadDocumentInput(input);
  if (!validated.ok) {
    const err = mapValidationFailureToHiveError(
      validated.diagnosticReason,
      validated.message,
      correlationId,
    );
    emitStructuredEvent({
      eventName: "readDocument.failed",
      severity: "ERROR",
      timestamp: new Date().toISOString(),
      component: "sourceDocuments",
      operation: "readDocument",
      stage: "READ",
      correlationId,
      hiveId: input.hiveId,
      sourceDocumentId: input.sourceDocumentId,
      ...(input.processingRunId ? { processingRunId: input.processingRunId } : {}),
      status: "FAILED",
      errorCode: err.errorCode,
      retryable: err.retryable,
      durationMs: Date.now() - startedAt,
      diagnosticReason: validated.diagnosticReason,
    });
    throw err;
  }

  const normalizedInput = validated.value;

  emitStructuredEvent({
    eventName: "readDocument.started",
    severity: "INFO",
    timestamp: new Date().toISOString(),
    component: "sourceDocuments",
    operation: "readDocument",
    stage: "READ",
    correlationId,
    hiveId: normalizedInput.hiveId,
    sourceDocumentId: normalizedInput.sourceDocumentId,
    ...(normalizedInput.processingRunId
      ? { processingRunId: normalizedInput.processingRunId }
      : {}),
    status: "RUNNING",
  });

  try {
    const ownedHive = await deps.loadOwnedHive(
      normalizedInput.ownerUserId,
      normalizedInput.hiveId,
      correlationId,
    );
    if (ownedHive.id.toLowerCase() !== normalizedInput.hiveId) {
      throw createHiveError({
        errorCode: "SOURCE_ACCESS_DENIED",
        category: "SECURITY",
        stage: "READ",
        retryable: false,
        safeMessage: "You do not have access to this Hive.",
        correlationId,
        diagnosticReason: "access_denied",
      });
    }

    let declaredPageCount = normalizedInput.declaredPageCount ?? null;

    if (deps.loadRegisteredSource) {
      const registered = await deps.loadRegisteredSource({
        ownerUserId: normalizedInput.ownerUserId,
        hiveId: normalizedInput.hiveId,
        sourceDocumentId: normalizedInput.sourceDocumentId,
        correlationId,
      });
      if (!registered) {
        throw createHiveError({
          errorCode: "NOT_FOUND",
          category: "DOCUMENT",
          stage: "READ",
          retryable: false,
          safeMessage: "We could not find that source document.",
          correlationId,
          diagnosticReason: "document_not_found",
        });
      }
      if (
        registered.hiveId.toLowerCase() !== normalizedInput.hiveId ||
        registered.ownerUserId.toLowerCase() !== normalizedInput.ownerUserId
      ) {
        throw createHiveError({
          errorCode: "SOURCE_ACCESS_DENIED",
          category: "SECURITY",
          stage: "READ",
          retryable: false,
          safeMessage: "You do not have access to this source document.",
          correlationId,
          diagnosticReason: "page_hive_mismatch",
        });
      }
      const registeredSha = normalizeFileSha256(registered.sha256);
      const requestedSha = normalizeFileSha256(normalizedInput.sha256);
      if (!registeredSha || !requestedSha || registeredSha !== requestedSha) {
        const diagnosticField = fileSha256MismatchField(normalizedInput.sha256, registered.sha256);
        emitStructuredEvent({
          eventName: "readDocument.source_sha256_mismatch",
          severity: "ERROR",
          timestamp: new Date().toISOString(),
          component: "sourceDocuments",
          operation: "readDocument",
          stage: "READ",
          correlationId,
          hiveId: normalizedInput.hiveId,
          sourceDocumentId: normalizedInput.sourceDocumentId,
          ...(normalizedInput.processingRunId
            ? { processingRunId: normalizedInput.processingRunId }
            : {}),
          status: "FAILED",
          errorCode: "INVALID_DOCUMENT",
          retryable: false,
          diagnosticReason: "page_source_sha256_mismatch",
          diagnosticField,
        });
        throw createHiveError({
          errorCode: "INVALID_DOCUMENT",
          category: "DOCUMENT",
          stage: "READ",
          retryable: false,
          safeMessage: "The document content hash did not match the registered source.",
          correlationId,
          diagnosticReason: "page_source_sha256_mismatch",
          diagnosticField,
        });
      }
      if (registered.byteSize !== normalizedInput.byteSize) {
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
      if (declaredPageCount === null && registered.pageCount !== null) {
        declaredPageCount = registered.pageCount;
      }
    }

    const config = deps.getReaderConfig
      ? deps.getReaderConfig()
      : loadReaderServiceConfig(process.env, correlationId);
    const validatedBaseUrl = assertValidReaderBaseUrl(config.baseUrl, correlationId);
    const fetchFn = deps.fetchFn ?? fetch;
    const timeoutMs = resolveConfiguredReaderTimeoutMs(config.timeoutMs, correlationId);

    // Request maxPages + 1 when maxPages < DEFAULT_READER_MAX_PAGES or for DOCX so V4 can detect
    // whether physical pages exist beyond maxPages without modifying V3 Python Reader.
    const wireMaxPages =
      declaredPageCount !== null && normalizedInput.mimeType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ? normalizedInput.maxPages
        : normalizedInput.maxPages < DEFAULT_READER_MAX_PAGES
          ? normalizedInput.maxPages + 1
          : normalizedInput.maxPages;

    const wireRequest: ReaderWireRequestV1 = {
      contract_version: READER_WIRE_CONTRACT_VERSION,
      source: {
        source_document_id: normalizedInput.sourceDocumentId,
        hive_id: normalizedInput.hiveId,
        owner_user_id: normalizedInput.ownerUserId,
        storage_bucket: HIVE_SOURCE_DOCUMENTS_BUCKET,
        storage_path: normalizedInput.storagePath,
        mime_type: normalizedInput.mimeType,
        byte_size: normalizedInput.byteSize,
        sha256: normalizedInput.sha256,
        filename: normalizedInput.fileName,
      },
      options: {
        max_pages: wireMaxPages,
        ocr_mode: normalizedInput.ocrMode,
        docx_page_break_strategy: normalizedInput.docxPageBreakStrategy,
      },
      extraction_schema: null,
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.serviceToken}`,
      "Content-Type": "application/json",
      [READER_HTTP_HEADERS.CORRELATION_ID]: correlationId,
    };
    if (normalizedInput.processingRunId) {
      headers[READER_HTTP_HEADERS.STUDY_RUN_ID] = normalizedInput.processingRunId;
    }

    let response: Response;
    try {
      response = await fetchFn(`${validatedBaseUrl}/v1/read-document`, {
        method: "POST",
        headers,
        body: JSON.stringify(wireRequest),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw createHiveError({
        errorCode: "PAGE_READ_FAILED",
        category: "DEPENDENCY",
        stage: "READ",
        retryable: true,
        safeMessage: isTimeout
          ? "Reading this document timed out. You can try again."
          : "Document reader service is temporarily unavailable. Please try again.",
        correlationId,
        diagnosticReason: isTimeout ? "reader_timeout" : "reader_unavailable",
        cause: error,
      });
    }

    const rawBody = await response.json().catch(() => null);
    if (!response.ok) {
      throw mapReaderHttpErrorToHiveError({
        status: response.status,
        envelope:
          rawBody && typeof rawBody === "object" ? (rawBody as ReaderErrorEnvelope) : null,
        correlationId,
      });
    }

    const normalized = normalizeReaderWireResponse({
      expected: {
        hiveId: normalizedInput.hiveId,
        ownerUserId: normalizedInput.ownerUserId,
        sourceDocumentId: normalizedInput.sourceDocumentId,
        mimeType: normalizedInput.mimeType,
        byteSize: normalizedInput.byteSize,
        sha256: normalizedInput.sha256,
        declaredPageCount,
        maxPages: normalizedInput.maxPages,
        ocrMode: normalizedInput.ocrMode,
        docxPageBreakStrategy: normalizedInput.docxPageBreakStrategy,
      },
      wire: rawBody,
    });

    if (!normalized.ok) {
      throw mapNormalizationFailureToHiveError(
        normalized.diagnosticReason,
        normalized.message,
        correlationId,
      );
    }

    // Recompute canonical readFingerprint over the caller's requested options when wireMaxPages probed +1
    const result: ReadDocumentResult =
      wireMaxPages !== normalizedInput.maxPages
        ? {
            ...normalized.value,
            sourceFingerprint: {
              ...normalized.value.sourceFingerprint,
              readFingerprint: computeReadFingerprint({
                sourceSha256: normalizedInput.sha256,
                options: {
                  docx_page_break_strategy: normalizedInput.docxPageBreakStrategy,
                  max_pages: normalizedInput.maxPages,
                  ocr_mode: normalizedInput.ocrMode,
                },
              }),
            },
          }
        : normalized.value;

    emitStructuredEvent({
      eventName: "readDocument.completed",
      severity: "INFO",
      timestamp: new Date().toISOString(),
      component: "sourceDocuments",
      operation: "readDocument",
      stage: "READ",
      correlationId,
      hiveId: result.hiveId,
      sourceDocumentId: result.sourceDocumentId,
      ...(normalizedInput.processingRunId
        ? { processingRunId: normalizedInput.processingRunId }
        : {}),
      status: "SUCCEEDED",
      durationMs: Date.now() - startedAt,
    });

    return result;
  } catch (error) {
    const hiveError =
      error &&
      typeof error === "object" &&
      "errorCode" in error &&
      "stage" in error &&
      typeof (error as { errorCode?: unknown }).errorCode === "string"
        ? (error as ReturnType<typeof createHiveError>)
        : createHiveError({
            errorCode: "PAGE_READ_FAILED",
            category: "DOCUMENT",
            stage: "READ",
            retryable: false,
            safeMessage: "We could not read this document.",
            correlationId,
            diagnosticReason: "reader_extraction_failed",
            cause: error,
          });

    emitStructuredEvent({
      eventName: "readDocument.failed",
      severity: "ERROR",
      timestamp: new Date().toISOString(),
      component: "sourceDocuments",
      operation: "readDocument",
      stage: "READ",
      correlationId,
      hiveId: normalizedInput.hiveId,
      sourceDocumentId: normalizedInput.sourceDocumentId,
      ...(normalizedInput.processingRunId
        ? { processingRunId: normalizedInput.processingRunId }
        : {}),
      status: "FAILED",
      errorCode: hiveError.errorCode,
      retryable: hiveError.retryable,
      durationMs: Date.now() - startedAt,
      diagnosticReason: hiveError.diagnosticReason ?? "reader_extraction_failed",
    });

    throw hiveError;
  }
}
