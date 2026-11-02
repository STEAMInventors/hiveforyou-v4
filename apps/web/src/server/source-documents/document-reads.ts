import {
  buildFailureDiagnostic,
  classifyFailure,
  createHiveError,
  type DocumentRead,
  type DocumentReadStatus,
  type Hive,
  type HiveError,
  isSourceMimeType,
  isValidUuid,
  type ListDocumentReadsResponse,
  normalizeDocumentReadRecord,
  type StartDocumentReadsResponse,
  validateStartDocumentReadsInput,
} from "@hiveforyou/contracts";
import { computePageSetDigest, type ReadDocumentResult } from "@hiveforyou/contracts/document-read";

import { emitStructuredEvent } from "@/server/observability/logger";

import {
  type DocumentPageRpcClient,
  listDocumentPagesForSource,
  putDocumentPagesForSource,
} from "./document-pages-persistence";
import { readDocument, type ReadDocumentDeps, type RegisteredSourceMetadata } from "./read-document";

export const DOCUMENT_READ_CONCURRENCY = 4;

const UNREADABLE_MESSAGE =
  "We couldn't find readable text in this document. Try a clearer scan or the original file.";
const READ_STOPPED_MESSAGE = "We couldn't finish reading this document. You can try again.";
const VERIFY_FAILED_MESSAGE = "The saved pages didn't match what was read. You can try again.";

export type DocumentReadRpcClient = DocumentPageRpcClient;

type ReaderDeps = Pick<ReadDocumentDeps, "getReaderConfig" | "fetchFn">;

export type ProcessDocumentReadsDeps = {
  readonly client: DocumentReadRpcClient;
  readonly reader?: ReaderDeps;
  readonly concurrency?: number;
};

type TransitionDetails = {
  readonly read_fingerprint?: string;
  readonly page_set_digest?: string;
  readonly total_physical_pages?: number;
  readonly saved_page_count?: number;
  readonly verified_page_count?: number;
  readonly unreadable_page_count?: number;
  readonly error_code?: string;
  readonly error_message_safe?: string;
  readonly retryable?: boolean;
  readonly failure_diagnostic?: ReturnType<typeof buildFailureDiagnostic>;
};

type TransitionResult = {
  readonly applied: boolean;
  readonly documentRead: DocumentRead | null;
  readonly source: RegisteredSourceMetadata | null;
};

function rpcMessage(error: unknown): string {
  return typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message.toLowerCase()
    : "";
}

function mapOwnerRpcError(error: unknown, correlationId: string): HiveError {
  const message = rpcMessage(error);
  if (message.includes("hive_not_found")) {
    return createHiveError({
      errorCode: "NOT_FOUND",
      category: "SECURITY",
      stage: "READ",
      retryable: false,
      safeMessage: "We could not find that Hive.",
      correlationId,
      diagnosticReason: "not_found",
    });
  }
  if (message.includes("auth_required")) {
    return createHiveError({
      errorCode: "UNAUTHENTICATED",
      category: "SECURITY",
      stage: "READ",
      retryable: false,
      safeMessage: "Sign in to continue.",
      correlationId,
      diagnosticReason: "no_session",
    });
  }
  return createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "READ",
    retryable: true,
    safeMessage: "Could not reach your documents right now. Please try again.",
    correlationId,
    diagnosticReason: "persistence_failed",
    cause: error,
  });
}

function requireHiveId(hiveId: string, correlationId: string): string {
  const normalized = hiveId.trim().toLowerCase();
  if (!isValidUuid(normalized)) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "READ",
      retryable: false,
      safeMessage: "Invalid Hive identifier.",
      correlationId,
      diagnosticReason: "invalid_hive_id",
    });
  }
  return normalized;
}

function normalizeReadList(raw: unknown, correlationId: string): DocumentRead[] {
  const list = (raw as { documentReads?: unknown } | null)?.documentReads;
  if (!Array.isArray(list)) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "READ",
      retryable: true,
      safeMessage: "Could not load reading progress. Please try again.",
      correlationId,
      diagnosticReason: "unexpected_edge_shape",
    });
  }
  return list
    .map((item) => normalizeDocumentReadRecord(item))
    .filter((item): item is DocumentRead => item !== null);
}

/** Queues reads for the owner's eligible documents; replaying a clientRequestId never queues twice. */
export async function startDocumentReads(
  userClient: DocumentReadRpcClient,
  input: { readonly hiveId: string; readonly rawBody: unknown; readonly correlationId: string },
): Promise<{ response: StartDocumentReadsResponse; queuedReadIds: string[] }> {
  const { correlationId } = input;
  const hiveId = requireHiveId(input.hiveId, correlationId);
  const validated = validateStartDocumentReadsInput(input.rawBody);
  if (!validated.ok) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "READ",
      retryable: false,
      safeMessage: validated.message,
      correlationId,
      diagnosticReason: validated.diagnosticReason,
    });
  }

  const { data, error } = await userClient.rpc("start_document_reads", {
    p_hive_id: hiveId,
    p_request_id: validated.value.clientRequestId,
    p_correlation_id: correlationId,
    p_source_document_ids: validated.value.sourceDocumentIds,
  });
  if (error) {
    throw mapOwnerRpcError(error, correlationId);
  }

  const documentReads = normalizeReadList(data, correlationId);
  const rawQueued = (data as { queuedReadIds?: unknown }).queuedReadIds;
  const queuedReadIds = Array.isArray(rawQueued)
    ? rawQueued.filter((id): id is string => typeof id === "string" && isValidUuid(id))
    : [];
  const created = Number((data as { created?: unknown }).created ?? 0);
  return {
    response: { documentReads, created: Number.isInteger(created) && created > 0 ? created : 0 },
    queuedReadIds,
  };
}

export async function listDocumentReads(
  userClient: DocumentReadRpcClient,
  input: { readonly hiveId: string; readonly correlationId: string },
): Promise<ListDocumentReadsResponse> {
  const hiveId = requireHiveId(input.hiveId, input.correlationId);
  const { data, error } = await userClient.rpc("list_document_reads", { p_hive_id: hiveId });
  if (error) {
    throw mapOwnerRpcError(error, input.correlationId);
  }
  return { documentReads: normalizeReadList(data, input.correlationId) };
}

function parseClaimedSource(raw: unknown): RegisteredSourceMetadata | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.source_document_id !== "string" ||
    typeof record.hive_id !== "string" ||
    typeof record.owner_user_id !== "string" ||
    typeof record.file_name !== "string" ||
    !isSourceMimeType(record.mime_type) ||
    typeof record.byte_size !== "number" ||
    typeof record.sha256 !== "string" ||
    typeof record.storage_bucket !== "string" ||
    typeof record.storage_path !== "string"
  ) {
    return null;
  }
  return {
    id: record.source_document_id.toLowerCase(),
    hiveId: record.hive_id.toLowerCase(),
    ownerUserId: record.owner_user_id.toLowerCase(),
    fileName: record.file_name,
    mimeType: record.mime_type,
    byteSize: record.byte_size,
    sha256: record.sha256.toLowerCase(),
    storageBucket: record.storage_bucket,
    storagePath: record.storage_path,
    pageCount: typeof record.page_count === "number" ? record.page_count : null,
  };
}

async function transition(
  client: DocumentReadRpcClient,
  readId: string,
  from: DocumentReadStatus,
  to: DocumentReadStatus,
  details: TransitionDetails = {},
): Promise<TransitionResult> {
  const { data, error } = await client.rpc("transition_document_read", {
    p_read_id: readId,
    p_from_status: from,
    p_to_status: to,
    p_details: details,
  });
  if (error) {
    throw new Error(error.message ?? "transition_document_read failed");
  }
  const payload = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown> | null;
  return {
    applied: payload?.applied === true,
    documentRead: normalizeDocumentReadRecord(payload?.documentRead),
    source: parseClaimedSource(payload?.source),
  };
}

function isHiveError(value: unknown): value is HiveError {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { errorCode?: unknown }).errorCode === "string" &&
    typeof (value as { safeMessage?: unknown }).safeMessage === "string" &&
    typeof (value as { retryable?: unknown }).retryable === "boolean"
  );
}

/** The Reader rejected the file itself (corrupt, encrypted, no pages): retrying will not help. */
function isUnreadableDocumentError(error: HiveError): boolean {
  return (
    error.category === "DOCUMENT" &&
    !error.retryable &&
    (error.diagnosticReason === "reader_extraction_failed" ||
      error.diagnosticReason === "document_unreadable")
  );
}

function failureDetails(error: unknown, attempt: number): TransitionDetails {
  const hive = isHiveError(error) ? error : null;
  const base = hive
    ? { error_code: hive.errorCode, error_message_safe: hive.safeMessage, retryable: hive.retryable }
    : { error_code: "INTERNAL_ERROR" as const, error_message_safe: READ_STOPPED_MESSAGE, retryable: true };
  const reason = hive?.diagnosticReason ?? "unexpected_exception";
  const classified = classifyFailure({ stage: "READ", diagnosticReason: reason, task: "read" });
  const diagnostic = buildFailureDiagnostic({
    ...classified,
    stage: "READ",
    errorCode: base.error_code,
    diagnosticReason: reason,
    diagnosticField: hive?.diagnosticField ?? null,
    retryable: base.retryable,
    attempt,
  });
  return { ...base, ...(diagnostic ? { failure_diagnostic: diagnostic } : {}) };
}

function logTransition(input: {
  readonly read: Pick<DocumentRead, "id" | "hiveId" | "sourceDocumentId" | "correlationId" | "attemptNumber">;
  readonly status: DocumentReadStatus;
  readonly startedAt: number;
  readonly error?: unknown;
}): void {
  const failed = input.status === "FAILED" || input.status === "UNREADABLE";
  emitStructuredEvent({
    eventName: `documentRead.${input.status.toLowerCase()}`,
    severity: input.status === "FAILED" ? "ERROR" : failed ? "WARN" : "INFO",
    timestamp: new Date().toISOString(),
    component: isHiveError(input.error) ? "reader" : "sourceDocuments",
    operation: isHiveError(input.error) ? "read_document" : "readDocuments",
    stage: "READ",
    correlationId: input.read.correlationId,
    hiveId: input.read.hiveId,
    sourceDocumentId: input.read.sourceDocumentId,
    processingRunId: input.read.id,
    attempt: input.read.attemptNumber,
    task: "read",
    status: input.status,
    durationMs: Date.now() - input.startedAt,
    ...(isHiveError(input.error)
      ? {
          errorCode: input.error.errorCode,
          retryable: input.error.retryable,
          diagnosticReason: input.error.diagnosticReason ?? "unexpected_exception",
          ...(typeof input.error.diagnosticField === "string" ? { diagnosticField: input.error.diagnosticField } : {}),
        }
      : {}),
  });
}

function verifyPersistedGeneration(
  readResult: ReadDocumentResult,
  persisted: Awaited<ReturnType<typeof listDocumentPagesForSource>>,
  pageSetDigest: string,
  correlationId: string,
): number {
  const expected = [...readResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const matches =
    persisted.found &&
    persisted.pages.length === expected.length &&
    persisted.pageSetDigest === pageSetDigest.toLowerCase() &&
    persisted.pages.every(
      (row, index) =>
        row.page_number === index + 1 &&
        row.page_text_sha256.toLowerCase() === expected[index]!.textSha256.toLowerCase(),
    ) &&
    computePageSetDigest({
      sourceSha256: persisted.sourceSha256,
      pageCount: persisted.pages.length,
      pages: persisted.pages,
    }) === pageSetDigest.toLowerCase();
  if (!matches) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "READ",
      retryable: true,
      safeMessage: VERIFY_FAILED_MESSAGE,
      correlationId,
      diagnosticReason: "artifact_hash_mismatch",
    });
  }
  return persisted.pages.length;
}

/**
 * Runs one queued read to a terminal status. Each step is recorded before the next starts, and the
 * document is only marked read after its saved pages are loaded back and match what the Reader returned.
 */
export async function processDocumentRead(
  deps: ProcessDocumentReadsDeps,
  readId: string,
): Promise<DocumentReadStatus | null> {
  const startedAt = Date.now();
  const claim = await transition(deps.client, readId, "QUEUED", "READING");
  if (!claim.applied || !claim.documentRead) {
    return null;
  }
  const read = claim.documentRead;
  const correlationId = read.correlationId;
  let current = "READING" as DocumentReadStatus;
  logTransition({ read, status: current, startedAt });

  const advance = async (to: DocumentReadStatus, details: TransitionDetails = {}, error?: unknown) => {
    const result = await transition(deps.client, readId, current, to, details);
    if (!result.applied) {
      throw createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "INTERNAL",
        stage: "READ",
        retryable: true,
        safeMessage: READ_STOPPED_MESSAGE,
        correlationId,
        diagnosticReason: "unexpected_exception",
      });
    }
    current = to;
    logTransition({ read, status: to, startedAt, error });
  };

  try {
    const source = claim.source;
    if (!source || source.id !== read.sourceDocumentId || source.hiveId !== read.hiveId) {
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

    let readResult: ReadDocumentResult;
    try {
      readResult = await readDocument(
        {
          loadOwnedHive: async () => ({ id: source.hiveId }) as Hive,
          loadRegisteredSource: async () => source,
          ...deps.reader,
        },
        {
          hiveId: source.hiveId,
          ownerUserId: source.ownerUserId,
          sourceDocumentId: source.id,
          storageBucket: source.storageBucket,
          storagePath: source.storagePath,
          fileName: source.fileName,
          mimeType: source.mimeType,
          byteSize: source.byteSize,
          sha256: source.sha256,
          declaredPageCount: source.pageCount,
          correlationId,
          processingRunId: readId,
        },
      );
    } catch (error) {
      if (isHiveError(error) && isUnreadableDocumentError(error)) {
        const details = failureDetails(error, read.attemptNumber);
        await advance(
          "UNREADABLE",
          {
            ...details,
            error_code: "DOCUMENT_UNREADABLE",
            retryable: false,
            failure_diagnostic: details.failure_diagnostic
              ? { ...details.failure_diagnostic, errorCode: "DOCUMENT_UNREADABLE", retryable: false }
              : undefined,
          },
          error,
        );
        return current;
      }
      throw error;
    }

    const { readFingerprint, pageSetDigest } = readResult.sourceFingerprint;
    await advance("SAVING", {
      read_fingerprint: readFingerprint,
      page_set_digest: pageSetDigest,
      total_physical_pages: readResult.totalPhysicalPages,
      unreadable_page_count: readResult.unreadablePages.length,
    });

    const saved = await putDocumentPagesForSource(deps.client, {
      correlationId,
      processingRunId: readId,
      registeredSource: { sourceDocumentId: source.id, hiveId: source.hiveId, sha256: source.sha256 },
      readResult,
    });
    await advance("VERIFYING", { saved_page_count: saved.pageCount });

    const persisted = await listDocumentPagesForSource(deps.client, {
      hiveId: source.hiveId,
      sourceDocumentId: source.id,
      readFingerprint: saved.readFingerprint,
      pageSetDigest: saved.pageSetDigest,
      expectedSourceSha256: source.sha256,
      correlationId,
    });
    const verifiedPageCount = verifyPersistedGeneration(
      readResult,
      persisted,
      saved.pageSetDigest,
      correlationId,
    );

    await advance(readResult.readStatus, {
      page_set_digest: saved.pageSetDigest,
      total_physical_pages: readResult.totalPhysicalPages,
      verified_page_count: verifiedPageCount,
      unreadable_page_count: readResult.unreadablePages.length,
      ...(readResult.readStatus === "UNREADABLE"
        ? { error_code: "DOCUMENT_UNREADABLE", error_message_safe: UNREADABLE_MESSAGE, retryable: false }
        : {}),
    });
    return current;
  } catch (error) {
    try {
      await advance("FAILED", failureDetails(error, read.attemptNumber), error);
    } catch {
      // The attempt's lease expires and list_document_reads marks it FAILED.
    }
    return current === "FAILED" ? current : null;
  }
}

/** Processes reads with bounded concurrency; never throws, so it is safe inside `after()`. */
export async function processDocumentReads(
  deps: ProcessDocumentReadsDeps,
  readIds: readonly string[],
): Promise<void> {
  const queue = [...new Set(readIds)];
  const workers = Array.from(
    { length: Math.min(deps.concurrency ?? DOCUMENT_READ_CONCURRENCY, queue.length) },
    async () => {
      for (let readId = queue.shift(); readId !== undefined; readId = queue.shift()) {
        await processDocumentRead(deps, readId).catch(() => null);
      }
    },
  );
  await Promise.all(workers);
}
