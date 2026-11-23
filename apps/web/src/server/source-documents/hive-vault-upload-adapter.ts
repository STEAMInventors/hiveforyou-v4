import { createHash } from "node:crypto";

import type { CaseId, CorrelationId, UploadOperationId, UserId } from "@hives/contracts";
import { HiveError } from "@hives/core";
import { loadSupabaseAdminEnv } from "@hives/persistence/env";
import { DEFAULT_HIVE_SOURCE_BUCKET } from "@hives/persistence/storage/buckets";
import type { EvidenceObjectStore } from "@hives/persistence/storage/port";
import { SupabaseEvidenceObjectStore } from "@hives/persistence/storage/supabase";
import { createSupabaseAdminClient } from "@hives/persistence/storage/supabase-client";
import { createCase } from "@hives/persistence/vault/create-case";
import type { VaultRepositories } from "@hives/persistence/vault/ports";
import type { SourceDocumentRecord, UploadOperationRecord } from "@hives/persistence/vault/records";
import {
  completePreparedSourceDocumentUpload,
  prepareSourceDocumentUpload,
} from "@hives/persistence/vault/register";
import { SupabaseVaultRepositories } from "@hives/persistence/vault/supabase";
import { validateUpload } from "@hives/security";
import {
  createHiveError,
  FREE_UPLOADS_PER_UTC_MONTH,
  isSourceMimeType,
  isValidUuid,
  normalizeIntentRequestRecord,
  normalizeUploadQuota,
  sourceMimeTypeForFileName,
  validateCreateIntentRequestInput,
  type CreateIntentRequestResponse,
  type GetUploadQuotaResponse,
  type Hive,
  normalizeSourceDocumentRecord,
  type CompleteSourceDocumentResponse,
  type ListSourceDocumentsResponse,
  type PrepareSourceDocumentResponse,
  type SourceDocument,
  type SourceFailureReason,
  type SourceMimeType,
  type UploadQuota,
  validateCompleteSourceDocumentInput,
  validatePrepareSourceDocumentInput,
} from "@hiveforyou/contracts";

import { getHiveViaEdge, type EdgeSupabaseClient } from "@/server/hives/hive-edge-gateway";

export type ScanVerdict = "NO_DETECTIONS" | "UNKNOWN_TO_SCANNER" | "MALICIOUS";

export class ScanError extends Error {
  constructor(readonly reason: "scan_unavailable" | "scan_rate_limited") {
    super(reason);
  }
}

export type HashScanner = (sha256: string) => Promise<ScanVerdict>;

const VIRUSTOTAL_TIMEOUT_MS = 8000;

/**
 * Hash-only lookup: file contents never leave the server.
 * When VIRUSTOTAL_API_KEY is not configured in local dev, returns UNKNOWN_TO_SCANNER.
 */
export const defaultHashScanner: HashScanner = async (sha256) => {
  const apiKey = process.env.VIRUSTOTAL_API_KEY?.trim();
  if (!apiKey) {
    return "UNKNOWN_TO_SCANNER";
  }
  let response: Response;
  try {
    response = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, {
      headers: { "x-apikey": apiKey },
      signal: AbortSignal.timeout(VIRUSTOTAL_TIMEOUT_MS),
    });
  } catch {
    throw new ScanError("scan_unavailable");
  }
  if (response.status === 404) {
    return "UNKNOWN_TO_SCANNER";
  }
  if (response.status === 429) {
    throw new ScanError("scan_rate_limited");
  }
  if (!response.ok) {
    throw new ScanError("scan_unavailable");
  }
  const body = (await response.json().catch(() => null)) as {
    data?: { attributes?: { last_analysis_stats?: { malicious?: unknown } } };
  } | null;
  const stats = body?.data?.attributes?.last_analysis_stats;
  if (!stats || typeof stats.malicious !== "number") {
    throw new ScanError("scan_unavailable");
  }
  return stats.malicious > 0 ? "MALICIOUS" : "NO_DETECTIONS";
};

export type ClientRequestBinding = {
  readonly ownerUserId: string;
  readonly clientRequestId: string;
  readonly hiveId: string;
  readonly uploadOperationId: string | null;
  readonly status: "REGISTERED" | "REJECTED";
  readonly failureReason: SourceFailureReason | null;
  readonly scanStatus: "NO_DETECTIONS" | "UNKNOWN_TO_SCANNER" | "MALICIOUS";
  readonly fileName: string;
  readonly mimeType: SourceMimeType;
  readonly byteSize: number;
  readonly createdAt: string;
};

export type ClientRequestRegistry = {
  get(ownerUserId: string, clientRequestId: string): Promise<ClientRequestBinding | undefined>;
  save(binding: ClientRequestBinding): Promise<void>;
};

export class InMemoryClientRequestRegistry implements ClientRequestRegistry {
  private readonly store = new Map<string, ClientRequestBinding>();

  private key(ownerUserId: string, clientRequestId: string): string {
    return `${ownerUserId}:${clientRequestId}`;
  }

  async get(ownerUserId: string, clientRequestId: string): Promise<ClientRequestBinding | undefined> {
    return this.store.get(this.key(ownerUserId, clientRequestId));
  }

  async save(binding: ClientRequestBinding): Promise<void> {
    this.store.set(this.key(binding.ownerUserId, binding.clientRequestId), binding);
  }
}

export type HiveVaultUploadAdapterDeps = {
  readonly vault: VaultRepositories;
  readonly store: EvidenceObjectStore;
  readonly sourceBucket?: string;
  readonly scanHash?: HashScanner;
  readonly clientRequests?: ClientRequestRegistry;
  readonly userClient?: RpcCapableClient;
  readonly loadOwnedHive: (
    userId: string,
    hiveId: string,
    correlationId: string,
  ) => Promise<Hive>;
  readonly getQuota?: (ownerUserId: string, correlationId: string) => Promise<UploadQuota>;
};

function requireUuid(
  value: string,
  correlationId: string,
  safeMessage: string,
  diagnosticReason: string,
): string {
  const trimmed = value.trim().toLowerCase();
  if (!isValidUuid(trimmed)) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage,
      correlationId,
      diagnosticReason,
    });
  }
  return trimmed;
}

function mapPendingUploadToSourceDocument(
  operation: UploadOperationRecord,
  scanStatus: SourceDocument["scanStatus"],
): SourceDocument {
  const mimeType: SourceMimeType = isSourceMimeType(operation.mimeType)
    ? operation.mimeType
    : "application/pdf";
  return {
    id: operation.sourceDocumentId,
    sourceDocumentId: operation.sourceDocumentId,
    hiveId: operation.caseId,
    clientRequestId: operation.clientRequestId ?? operation.id,
    fileName: operation.originalFilename,
    mimeType,
    byteSize: operation.byteSize,
    status: operation.status === "FAILED" ? "REJECTED" : "PENDING",
    failureReason: operation.status === "FAILED" ? "TYPE_MISMATCH" : null,
    scanStatus,
    readStatus: "PENDING",
    registeredAt: null,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

export function mapV3DocumentToV4SourceDocument(
  record: SourceDocumentRecord,
  options?: {
    clientRequestId?: string;
    scanStatus?: SourceDocument["scanStatus"];
  },
): SourceDocument {
  const mimeType: SourceMimeType = isSourceMimeType(record.mimeType)
    ? record.mimeType
    : "application/pdf";
  return {
    id: record.id,
    sourceDocumentId: record.id,
    hiveId: record.caseId,
    clientRequestId: options?.clientRequestId ?? record.id,
    fileName: record.originalFilename,
    mimeType,
    byteSize: record.byteSize,
    status: "REGISTERED",
    failureReason: null,
    scanStatus: options?.scanStatus ?? "UNKNOWN_TO_SCANNER",
    readStatus: "PENDING",
    registeredAt: record.createdAt,
    createdAt: record.createdAt,
    updatedAt: record.createdAt,
    ...(record.canonicalGapId ? { canonicalGapId: record.canonicalGapId } : {}),
    ...(record.canonicalGapStudyRevisionId ? { canonicalGapStudyRevisionId: record.canonicalGapStudyRevisionId } : {}),
    ...(record.canonicalGapTitle ? { canonicalGapTitle: record.canonicalGapTitle } : {}),
  };
}

function buildRejectedSourceDocument(binding: ClientRequestBinding): SourceDocument {
  return {
    id: binding.clientRequestId,
    sourceDocumentId: binding.clientRequestId,
    hiveId: binding.hiveId,
    clientRequestId: binding.clientRequestId,
    fileName: binding.fileName,
    mimeType: binding.mimeType,
    byteSize: binding.byteSize,
    status: "REJECTED",
    failureReason: binding.failureReason,
    scanStatus: binding.scanStatus,
    readStatus: "PENDING",
    registeredAt: null,
    createdAt: binding.createdAt,
    updatedAt: binding.createdAt,
  };
}

/**
 * Ensures the 1:1 companion row in `hive.cases` (`caseId === hive.id`) exists for an owned V4 Hive,
 * delegating creation to V3's `createCase` unchanged.
 */
export async function ensureCaseForOwnedHive(
  vault: VaultRepositories,
  input: {
    readonly ownerUserId: string;
    readonly hive: Hive;
    readonly correlationId: string;
  },
): Promise<CaseId> {
  const caseId = input.hive.id as CaseId;
  const actorUserId = input.ownerUserId as UserId;
  const correlationId = input.correlationId as CorrelationId;
  const existing = await vault.cases.getById(caseId);
  if (existing !== undefined) {
    if (existing.ownerUserId !== actorUserId) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "You do not have access to this Hive.",
        correlationId: input.correlationId,
        diagnosticReason: "access_denied",
      });
    }
    return caseId;
  }
  await createCase(vault, {
    caseId,
    actorUserId,
    actorType: "USER",
    title: input.hive.name,
    correlationId,
  });
  return caseId;
}

export async function computeVaultUploadQuota(
  vault: VaultRepositories,
  ownerUserId: string,
  now = new Date(),
): Promise<UploadQuota> {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const cases = await vault.cases.listByOwner(ownerUserId as UserId);
  let used = 0;
  for (const c of cases) {
    const docs = await vault.sourceDocuments.listByCase(c.id);
    for (const doc of docs) {
      const created = new Date(doc.createdAt).getTime();
      if (
        doc.uploadStatus === "UPLOADED" &&
        doc.lifecycleStatus === "ACTIVE" &&
        doc.deletedAt === null &&
        created >= periodStart.getTime() &&
        created < periodEnd.getTime()
      ) {
        used += 1;
      }
    }
  }
  return {
    limit: FREE_UPLOADS_PER_UTC_MONTH,
    used,
    remaining: Math.max(FREE_UPLOADS_PER_UTC_MONTH - used, 0),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

function mapV3UploadError(
  error: unknown,
  correlationId: string,
  context: {
    hiveId: string;
    clientRequestId: string;
    fileName: string;
    mimeType: SourceMimeType;
    byteSize: number;
  },
): { rejected?: SourceDocument; thrown?: ReturnType<typeof createHiveError> } {
  if (error instanceof HiveError) {
    if (error.code === "FILE_CONTENT_MISMATCH" || error.code === "PAGE_COUNT_UNAVAILABLE") {
      const now = new Date().toISOString();
      return {
        rejected: buildRejectedSourceDocument({
          ownerUserId: "",
          clientRequestId: context.clientRequestId,
          hiveId: context.hiveId,
          uploadOperationId: null,
          status: "REJECTED",
          failureReason: "TYPE_MISMATCH",
          scanStatus: "UNKNOWN_TO_SCANNER",
          fileName: context.fileName,
          mimeType: context.mimeType,
          byteSize: context.byteSize,
          createdAt: now,
        }),
      };
    }
    if (
      error.code === "EXECUTABLE_UPLOAD_BLOCKED" ||
      error.code === "EXTENSION_NOT_ALLOWED" ||
      error.code === "MIME_NOT_ALLOWED" ||
      error.code === "PAGE_COUNT_UNSUPPORTED_TYPE"
    ) {
      return {
        thrown: createHiveError({
          errorCode: "INVALID_DOCUMENT",
          category: "DOCUMENT",
          stage: "REGISTER",
          retryable: false,
          safeMessage: "Only PDF, PNG, JPG and DOCX files up to 25 MB are supported.",
          correlationId,
          diagnosticReason: "invalid_document_type",
          cause: error,
        }),
      };
    }
    if (error.code === "FILE_SIZE_INVALID") {
      return {
        thrown: createHiveError({
          errorCode: "INVALID_DOCUMENT",
          category: "DOCUMENT",
          stage: "REGISTER",
          retryable: false,
          safeMessage: "Files must be 25 MB or smaller.",
          correlationId,
          diagnosticReason: "invalid_document_size",
          cause: error,
        }),
      };
    }
    if (error.code === "CASE_ACCESS_DENIED" || error.category === "AUTHORIZATION_ERROR") {
      return {
        thrown: createHiveError({
          errorCode: "NOT_FOUND",
          category: "SECURITY",
          stage: "SHELL",
          retryable: false,
          safeMessage: "We could not find that Hive.",
          correlationId,
          diagnosticReason: "not_found",
          cause: error,
        }),
      };
    }
  }
  return {
    thrown: createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "REGISTER",
      retryable: true,
      safeMessage: "Something went wrong with your documents. Please try again.",
      correlationId,
      diagnosticReason: "persistence_failed",
      cause: error,
    }),
  };
}

export async function prepareHiveSourceDocumentUpload(
  deps: HiveVaultUploadAdapterDeps,
  input: {
    readonly ownerUserId: string;
    readonly hiveId: string;
    readonly clientRequestId: string;
    readonly fileName: string;
    readonly mimeType: SourceMimeType;
    readonly byteSize: number;
    readonly sha256: string;
    readonly correlationId: string;
    readonly canonicalGapId?: string | null;
    readonly canonicalGapStudyRevisionId?: string | null;
    readonly canonicalGapTitle?: string | null;
  },
): Promise<PrepareSourceDocumentResponse> {
  const prepared = await prepareHiveSourceDocumentUploadInternal(deps, input);
  const upload =
    prepared.signedUpload.token.length > 0
      ? { path: prepared.signedUpload.path, token: prepared.signedUpload.token }
      : null;
  return {
    sourceDocument: prepared.sourceDocument,
    upload,
    created: prepared.created,
  };
}

export async function completeHiveSourceDocumentUpload(
  deps: HiveVaultUploadAdapterDeps,
  input: {
    readonly ownerUserId: string;
    readonly hiveId: string;
    readonly clientRequestId: string;
    readonly correlationId: string;
  },
): Promise<CompleteSourceDocumentResponse & { created: boolean }> {
  const safeHiveId = requireUuid(
    input.hiveId,
    input.correlationId,
    "Invalid Hive identifier.",
    "invalid_hive_id",
  );
  const safeClientRequestId = requireUuid(
    input.clientRequestId,
    input.correlationId,
    "clientRequestId must be a valid UUID.",
    "invalid_client_request_id",
  );
  await deps.loadOwnedHive(input.ownerUserId, safeHiveId, input.correlationId);
  const sourceBucket = deps.sourceBucket ?? DEFAULT_HIVE_SOURCE_BUCKET;
  const operation = await deps.vault.uploadOperations.getByClientRequestId(
    input.ownerUserId as UserId,
    safeHiveId as CaseId,
    safeClientRequestId,
  );
  if (operation === undefined) {
    throw createHiveError({
      errorCode: "NOT_FOUND",
      category: "DOCUMENT",
      stage: "REGISTER",
      retryable: false,
      safeMessage: "We could not find that upload. Try preparing it again.",
      correlationId: input.correlationId,
      diagnosticReason: "upload_not_found",
    });
  }
  if (operation.status === "REGISTERED") {
    const doc = await deps.vault.sourceDocuments.getById(operation.sourceDocumentId);
    if (!doc) {
      throw createHiveError({
        errorCode: "PERSISTENCE_FAILED",
        category: "PERSISTENCE",
        stage: "REGISTER",
        retryable: true,
        safeMessage: "Something went wrong with your documents. Please try again.",
        correlationId: input.correlationId,
        diagnosticReason: "persistence_failed",
      });
    }
    return {
      sourceDocument: withPendingGapFill(
        mapV3DocumentToV4SourceDocument(doc, {
          clientRequestId: safeClientRequestId,
        }),
        safeClientRequestId,
      ),
      created: false,
    };
  }
  const pendingGap = pendingGapFillByClientRequest.get(safeClientRequestId) ?? null;
  try {
    const registered = await completePreparedSourceDocumentUpload(
      { vault: deps.vault, store: deps.store, sourceBucket },
      {
        uploadOperationId: operation.id as UploadOperationId,
        actorUserId: input.ownerUserId as UserId,
        actorType: "USER",
        correlationId: input.correlationId as CorrelationId,
        canonicalGapId: pendingGap?.canonicalGapId ?? null,
        canonicalGapStudyRevisionId: pendingGap?.canonicalGapStudyRevisionId ?? null,
        canonicalGapTitle: pendingGap?.canonicalGapTitle ?? null,
      },
    );
    if (pendingGap) {
      pendingGapFillByClientRequest.delete(safeClientRequestId);
    }
    return {
      sourceDocument: withPendingGapFill(
        mapV3DocumentToV4SourceDocument(registered.document, {
          clientRequestId: safeClientRequestId,
        }),
        safeClientRequestId,
      ),
      created: true,
    };
  } catch (error) {
    const mapped = mapV3UploadError(error, input.correlationId, {
      hiveId: safeHiveId,
      clientRequestId: safeClientRequestId,
      fileName: operation.originalFilename,
      mimeType: isSourceMimeType(operation.mimeType) ? operation.mimeType : "application/pdf",
      byteSize: operation.byteSize,
    });
    if (mapped.rejected) {
      return { sourceDocument: mapped.rejected, created: true };
    }
    throw mapped.thrown!;
  }
}

type PendingGapFillLink = {
  readonly canonicalGapId: string;
  readonly canonicalGapStudyRevisionId: string;
  readonly canonicalGapTitle: string;
};

const pendingGapFillByClientRequest = new Map<string, PendingGapFillLink>();

function withPendingGapFill(document: SourceDocument, clientRequestId: string): SourceDocument {
  const link = pendingGapFillByClientRequest.get(clientRequestId);
  return link ? { ...document, ...link } : document;
}

async function prepareHiveSourceDocumentUploadInternal(
  deps: HiveVaultUploadAdapterDeps,
  input: {
    readonly ownerUserId: string;
    readonly hiveId: string;
    readonly clientRequestId: string;
    readonly fileName: string;
    readonly mimeType: SourceMimeType;
    readonly byteSize: number;
    readonly sha256: string;
    readonly correlationId: string;
    readonly canonicalGapId?: string | null;
    readonly canonicalGapStudyRevisionId?: string | null;
    readonly canonicalGapTitle?: string | null;
  },
): Promise<{
  sourceDocument: SourceDocument;
  signedUpload: { path: string; token: string };
  created: boolean;
}> {
  const safeHiveId = requireUuid(
    input.hiveId,
    input.correlationId,
    "Invalid Hive identifier.",
    "invalid_hive_id",
  );
  const safeClientRequestId = requireUuid(
    input.clientRequestId,
    input.correlationId,
    "clientRequestId must be a valid UUID.",
    "invalid_client_request_id",
  );
  if (input.canonicalGapId) {
    const gapId = input.canonicalGapId.trim();
    const revisionId = input.canonicalGapStudyRevisionId?.trim().toLowerCase() ?? "";
    const gapTitle = input.canonicalGapTitle?.trim() ?? "";
    if (!/^X\d+$/.test(gapId)) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "REGISTER",
        retryable: false,
        safeMessage: "canonicalGapId must match a study gap id such as X1.",
        correlationId: input.correlationId,
        diagnosticReason: "invalid_canonical_gap_id",
      });
    }
    if (!revisionId || gapTitle === "") {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "REGISTER",
        retryable: false,
        safeMessage: "Slot uploads require the study revision and gap title.",
        correlationId: input.correlationId,
        diagnosticReason: "invalid_canonical_gap_link",
      });
    }
    pendingGapFillByClientRequest.set(safeClientRequestId, {
      canonicalGapId: gapId,
      canonicalGapStudyRevisionId: revisionId,
      canonicalGapTitle: gapTitle,
    });
  }
  const trimmedName = input.fileName.trim();
  const hive = await deps.loadOwnedHive(input.ownerUserId, safeHiveId, input.correlationId);
  const sourceBucket = deps.sourceBucket ?? DEFAULT_HIVE_SOURCE_BUCKET;

  const quota = deps.getQuota
    ? await deps.getQuota(input.ownerUserId, input.correlationId)
    : await computeVaultUploadQuota(deps.vault, input.ownerUserId);
  if (quota.remaining <= 0) {
    throw createHiveError({
      errorCode: "QUOTA_EXCEEDED",
      category: "VALIDATION",
      stage: "REGISTER",
      retryable: false,
      safeMessage: "You've used this month's free uploads. Your allowance resets on the 1st (UTC).",
      correlationId: input.correlationId,
      diagnosticReason: "quota_exceeded",
    });
  }

  const scanHash = deps.scanHash ?? defaultHashScanner;
  let verdict: ScanVerdict;
  try {
    verdict = await scanHash(input.sha256);
  } catch (error) {
    const reason = error instanceof ScanError ? error.reason : "scan_unavailable";
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "DEPENDENCY",
      stage: "REGISTER",
      retryable: true,
      safeMessage:
        reason === "scan_rate_limited"
          ? "Our security check is busy. Try again in a minute."
          : "We could not run the security check on this file. Please try again.",
      correlationId: input.correlationId,
      diagnosticReason: reason,
    });
  }
  if (verdict === "MALICIOUS") {
    const now = new Date().toISOString();
    return {
      sourceDocument: buildRejectedSourceDocument({
        ownerUserId: input.ownerUserId,
        clientRequestId: safeClientRequestId,
        hiveId: safeHiveId,
        uploadOperationId: null,
        status: "REJECTED",
        failureReason: "MALWARE_DETECTED",
        scanStatus: "MALICIOUS",
        fileName: trimmedName,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        createdAt: now,
      }),
      signedUpload: { path: "", token: "" },
      created: true,
    };
  }

  const caseId = await ensureCaseForOwnedHive(deps.vault, {
    ownerUserId: input.ownerUserId,
    hive,
    correlationId: input.correlationId,
  });

  const existingBefore = await deps.vault.uploadOperations.getByClientRequestId(
    input.ownerUserId as UserId,
    caseId,
    safeClientRequestId,
  );
  const prepared = await prepareSourceDocumentUpload(
    { vault: deps.vault, store: deps.store, sourceBucket },
    {
      actorUserId: input.ownerUserId as UserId,
      actorType: "USER",
      caseId,
      clientRequestId: safeClientRequestId,
      originalFilename: trimmedName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      correlationId: input.correlationId as CorrelationId,
    },
  );
  const created = existingBefore === undefined;
  const scanStatus: SourceDocument["scanStatus"] =
    verdict === "NO_DETECTIONS" ? "NO_DETECTIONS" : "UNKNOWN_TO_SCANNER";
  if (prepared.uploadOperation.status === "REGISTERED") {
    const doc = await deps.vault.sourceDocuments.getById(prepared.uploadOperation.sourceDocumentId);
    if (doc) {
      return {
        sourceDocument: withPendingGapFill(
          mapV3DocumentToV4SourceDocument(doc, {
            clientRequestId: safeClientRequestId,
            scanStatus,
          }),
          safeClientRequestId,
        ),
        signedUpload: prepared.signedUpload,
        created: false,
      };
    }
  }
  return {
    sourceDocument: withPendingGapFill(
      mapPendingUploadToSourceDocument(prepared.uploadOperation, scanStatus),
      safeClientRequestId,
    ),
    signedUpload: prepared.signedUpload,
    created,
  };
}

/** Test/local helper: prepare, store bytes once, then complete (no second Storage write). */
export async function uploadHiveSourceDocumentWithV3Vault(
  deps: HiveVaultUploadAdapterDeps,
  input: {
    readonly ownerUserId: string;
    readonly hiveId: string;
    readonly clientRequestId: string;
    readonly fileName: string;
    readonly mimeType?: string;
    readonly bytes: Uint8Array;
    readonly correlationId: string;
  },
): Promise<{ sourceDocument: SourceDocument; uploadOperation: UploadOperationRecord | null; created: boolean }> {
  const trimmedName = input.fileName.trim();
  const resolvedMime =
    (input.mimeType && isSourceMimeType(input.mimeType) ? input.mimeType : null) ??
    sourceMimeTypeForFileName(trimmedName);
  if (!resolvedMime) {
    throw createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "REGISTER",
      retryable: false,
      safeMessage: "Only PDF, PNG, JPG and DOCX files up to 25 MB are supported.",
      correlationId: input.correlationId,
      diagnosticReason: "invalid_document_type",
    });
  }
  try {
    validateUpload({
      originalName: trimmedName,
      mimeType: resolvedMime,
      sizeBytes: input.bytes.byteLength,
      correlationId: input.correlationId as CorrelationId,
      bytes: input.bytes,
    });
  } catch (error) {
    const mapped = mapV3UploadError(error, input.correlationId, {
      hiveId: input.hiveId,
      clientRequestId: input.clientRequestId,
      fileName: trimmedName,
      mimeType: resolvedMime,
      byteSize: input.bytes.byteLength,
    });
    if (mapped.rejected) {
      return { sourceDocument: mapped.rejected, uploadOperation: null, created: true };
    }
    throw mapped.thrown!;
  }
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const prepared = await prepareHiveSourceDocumentUploadInternal(deps, {
    ownerUserId: input.ownerUserId,
    hiveId: input.hiveId,
    clientRequestId: input.clientRequestId,
    fileName: trimmedName,
    mimeType: resolvedMime,
    byteSize: input.bytes.byteLength,
    sha256,
    correlationId: input.correlationId,
  });
  if (prepared.sourceDocument.status === "REJECTED") {
    return { sourceDocument: prepared.sourceDocument, uploadOperation: null, created: prepared.created };
  }
  const sourceBucket = deps.sourceBucket ?? DEFAULT_HIVE_SOURCE_BUCKET;
  const operation = await deps.vault.uploadOperations.getByClientRequestId(
    input.ownerUserId as UserId,
    input.hiveId as CaseId,
    input.clientRequestId.trim().toLowerCase(),
  );
  if (operation && operation.status !== "REGISTERED") {
    await deps.store.putCreateOnly({
      bucket: sourceBucket,
      path: operation.storagePath,
      bytes: input.bytes,
      contentType: resolvedMime,
      correlationId: input.correlationId as CorrelationId,
    });
  }
  const completed = await completeHiveSourceDocumentUpload(deps, {
    ownerUserId: input.ownerUserId,
    hiveId: input.hiveId,
    clientRequestId: input.clientRequestId,
    correlationId: input.correlationId,
  });
  const uploadOperation =
    operation === undefined
      ? null
      : ((await deps.vault.uploadOperations.getById(operation.id)) ?? null);
  return {
    sourceDocument: completed.sourceDocument,
    uploadOperation,
    created: completed.created,
  };
}

export async function prepareHiveSourceDocumentFromApiBody(
  deps: HiveVaultUploadAdapterDeps,
  hiveId: string,
  ownerUserId: string,
  rawBody: unknown,
  correlationId: string,
): Promise<PrepareSourceDocumentResponse> {
  const validated = validatePrepareSourceDocumentInput(rawBody);
  if (!validated.ok) {
    throw createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "REGISTER",
      retryable: false,
      safeMessage: validated.message,
      correlationId,
      diagnosticReason: validated.diagnosticReason,
    });
  }
  return prepareHiveSourceDocumentUpload(deps, {
    ownerUserId,
    hiveId,
    clientRequestId: validated.value.clientRequestId,
    fileName: validated.value.fileName,
    mimeType: validated.value.mimeType,
    byteSize: validated.value.byteSize,
    sha256: validated.value.sha256,
    correlationId,
    canonicalGapId: validated.value.canonicalGapId ?? null,
    canonicalGapStudyRevisionId: validated.value.canonicalGapStudyRevisionId ?? null,
    canonicalGapTitle: validated.value.canonicalGapTitle ?? null,
  });
}

export async function completeHiveSourceDocumentFromApiBody(
  deps: HiveVaultUploadAdapterDeps,
  hiveId: string,
  ownerUserId: string,
  rawBody: unknown,
  correlationId: string,
): Promise<CompleteSourceDocumentResponse & { created: boolean }> {
  const validated = validateCompleteSourceDocumentInput(rawBody);
  if (!validated.ok) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "REGISTER",
      retryable: false,
      safeMessage: validated.message,
      correlationId,
      diagnosticReason: validated.diagnosticReason,
    });
  }
  return completeHiveSourceDocumentUpload(deps, {
    ownerUserId,
    hiveId,
    clientRequestId: validated.value.clientRequestId,
    correlationId,
  });
}

export async function listHiveSourceDocumentsWithV3Vault(
  deps: Pick<HiveVaultUploadAdapterDeps, "vault" | "loadOwnedHive"> & {
    readonly userClient?: RpcCapableClient;
  },
  input: {
    readonly ownerUserId: string;
    readonly hiveId: string;
    readonly correlationId: string;
  },
): Promise<ListSourceDocumentsResponse> {
  const safeHiveId = requireUuid(
    input.hiveId,
    input.correlationId,
    "Invalid Hive identifier.",
    "invalid_hive_id",
  );
  await deps.loadOwnedHive(input.ownerUserId, safeHiveId, input.correlationId);
  if (deps.userClient && typeof deps.userClient.rpc === "function") {
    const { data, error } = await deps.userClient.rpc("list_hive_source_documents", {
      p_hive_id: safeHiveId,
    });
    if (!error && data && typeof data === "object") {
      const rawList = (data as { sourceDocuments?: unknown }).sourceDocuments;
      if (Array.isArray(rawList)) {
        const sourceDocuments = rawList
          .map((item) => normalizeSourceDocumentRecord(item))
          .filter((item): item is SourceDocument => item !== null);
        return { sourceDocuments };
      }
    }
  }
  const records = await deps.vault.sourceDocuments.listByCase(safeHiveId as CaseId);
  const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    sourceDocuments: sorted.map((record) => mapV3DocumentToV4SourceDocument(record)),
  };
}

/** Signed links to an original file live for one minute; the chip asks again on every click. */
export const SOURCE_PAGE_LINK_SECONDS = 60;

/**
 * Short-lived signed URL of an owned, registered source file, opened at a physical page (D-011).
 * Ownership is checked through the owner's session; the file is signed server-side only.
 */
export type OpenSourceDocumentPageResult = {
  readonly signedUrl: string;
  readonly mimeType: string;
};

type AuthorizedSourceDocumentMeta = {
  readonly id: string;
  readonly caseId: string;
  readonly ownerUserId: string;
  readonly mimeType: string;
  readonly storageBucket: string;
  readonly storagePath: string;
  readonly uploadStatus: string;
  readonly lifecycleStatus: string;
  readonly deletedAt: string | null;
};

function isStorageNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { statusCode?: unknown; status?: unknown; error?: unknown; message?: unknown };
  if (rec.statusCode === 404 || rec.statusCode === "404" || rec.status === 404 || rec.status === "404") {
    return true;
  }
  const text = `${typeof rec.error === "string" ? rec.error : ""} ${typeof rec.message === "string" ? rec.message : ""}`.toLowerCase();
  return text.includes("object not found") || text.includes("not_found");
}

function isStoragePermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as {
    statusCode?: unknown;
    status?: unknown;
    code?: unknown;
    error?: unknown;
    message?: unknown;
  };
  if (
    rec.statusCode === 401 ||
    rec.statusCode === "401" ||
    rec.statusCode === 403 ||
    rec.statusCode === "403" ||
    rec.status === 401 ||
    rec.status === "401" ||
    rec.status === 403 ||
    rec.status === "403" ||
    rec.code === "42501"
  ) {
    return true;
  }
  const text = `${typeof rec.error === "string" ? rec.error : ""} ${typeof rec.message === "string" ? rec.message : ""}`.toLowerCase();
  return (
    text.includes("row-level security") ||
    text.includes("permission denied") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("not authorized") ||
    text.includes("access denied")
  );
}

function isAuthorizedSourceStoragePath(
  storagePath: string,
  ownerUserId: string,
  hiveId: string,
  sourceDocumentId: string,
): boolean {
  if (!storagePath || storagePath.startsWith("/") || storagePath.endsWith("/")) {
    return false;
  }
  if (
    storagePath.includes("\\") ||
    storagePath.includes("?") ||
    storagePath.includes("#") ||
    /[\x00-\x1f\x7f]/.test(storagePath) ||
    /%2e|%2f|%5c/i.test(storagePath)
  ) {
    return false;
  }
  const segments = storagePath.split("/");
  if (segments.length < 4) {
    return false;
  }
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return false;
    }
  }
  return (
    segments[0]!.toLowerCase() === ownerUserId &&
    segments[1]!.toLowerCase() === hiveId &&
    segments[2]!.toLowerCase() === sourceDocumentId
  );
}

function normalizeUserSourceDocumentRow(raw: unknown): AuthorizedSourceDocumentMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.case_id !== "string" ||
    typeof row.owner_user_id !== "string" ||
    typeof row.mime_type !== "string" ||
    typeof row.storage_bucket !== "string" ||
    typeof row.storage_path !== "string" ||
    typeof row.upload_status !== "string" ||
    typeof row.lifecycle_status !== "string"
  ) {
    return null;
  }
  return {
    id: row.id.trim().toLowerCase(),
    caseId: row.case_id.trim().toLowerCase(),
    ownerUserId: row.owner_user_id.trim().toLowerCase(),
    mimeType: row.mime_type.trim(),
    storageBucket: row.storage_bucket.trim(),
    storagePath: row.storage_path.trim(),
    uploadStatus: row.upload_status.trim(),
    lifecycleStatus: row.lifecycle_status.trim(),
    deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
  };
}

async function loadAuthorizedSourceDocumentForViewer(
  deps: Pick<HiveVaultUploadAdapterDeps, "vault" | "userClient">,
  hiveId: string,
  sourceDocumentId: string,
  correlationId: string,
): Promise<AuthorizedSourceDocumentMeta | null> {
  if (deps.userClient !== undefined) {
    const hiveSchema =
      typeof deps.userClient.schema === "function"
        ? (deps.userClient.schema("hive") as {
            from?: (table: "source_documents") => AuthorizedSourceDocumentQuery;
          } | null)
        : null;
    if (!hiveSchema || typeof hiveSchema.from !== "function") {
      throw createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "PERSISTENCE",
        stage: "READ",
        retryable: true,
        safeMessage: "We could not verify access to this document right now. Try again in a moment.",
        correlationId,
        diagnosticReason: "persistence_failed",
      });
    }
    const { data, error } = await hiveSchema
      .from("source_documents")
      .select(
        "id, case_id, owner_user_id, mime_type, storage_bucket, storage_path, upload_status, lifecycle_status, deleted_at",
      )
      .eq("id", sourceDocumentId)
      .eq("case_id", hiveId)
      .maybeSingle();
    if (error) {
      if (isStoragePermissionError(error)) {
        throw createHiveError({
          errorCode: "SOURCE_ACCESS_DENIED",
          category: "SECURITY",
          stage: "READ",
          retryable: false,
          safeMessage: "You do not have permission to open this document.",
          correlationId,
          diagnosticReason: "access_denied",
        });
      }
      throw createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "PERSISTENCE",
        stage: "READ",
        retryable: true,
        safeMessage: "We could not verify access to this document right now. Try again in a moment.",
        correlationId,
        diagnosticReason: "persistence_failed",
      });
    }
    if (!data) {
      return null;
    }
    return normalizeUserSourceDocumentRow(data);
  }

  let document: SourceDocumentRecord | undefined;
  try {
    document = await deps.vault.sourceDocuments.getById(sourceDocumentId as SourceDocumentRecord["id"]);
  } catch (error) {
    if (error instanceof HiveError) {
      throw createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "PERSISTENCE",
        stage: "READ",
        retryable: error.retryable,
        safeMessage: "We could not verify access to this document right now. Try again in a moment.",
        correlationId,
        diagnosticReason: "persistence_failed",
      });
    }
    throw error;
  }
  if (!document) return null;
  return {
    id: document.id.trim().toLowerCase(),
    caseId: document.caseId.trim().toLowerCase(),
    ownerUserId: document.ownerUserId.trim().toLowerCase(),
    mimeType: document.mimeType.trim(),
    storageBucket: document.storageBucket.trim(),
    storagePath: document.storagePath.trim(),
    uploadStatus: document.uploadStatus,
    lifecycleStatus: document.lifecycleStatus,
    deletedAt: document.deletedAt,
  };
}

async function signAuthorizedSourceDocumentUrl(
  deps: Pick<HiveVaultUploadAdapterDeps, "store" | "userClient">,
  document: Pick<AuthorizedSourceDocumentMeta, "storageBucket" | "storagePath">,
  correlationId: string,
): Promise<string> {
  // Always prefer authenticated user-scoped storage signing under Storage RLS and fail closed.
  // Never fall back to administrator/service-role signing when an authenticated user client is present.
  if (deps.userClient !== undefined) {
    const bucketClient =
      deps.userClient.storage && typeof deps.userClient.storage.from === "function"
        ? (deps.userClient.storage.from(document.storageBucket) as Partial<AuthorizedStorageBucket> | null)
        : null;
    if (!bucketClient || typeof bucketClient.createSignedUrl !== "function") {
      throw createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "PERSISTENCE",
        stage: "READ",
        retryable: true,
        safeMessage: "We could not prepare this document right now. Try again in a moment.",
        correlationId,
        diagnosticReason: "storage_failed",
      });
    }
    let signedResult: { data: { signedUrl: string } | null; error: unknown };
    try {
      signedResult = await bucketClient.createSignedUrl(
        document.storagePath,
        SOURCE_PAGE_LINK_SECONDS,
      );
    } catch (thrownError) {
      if (isStorageNotFoundError(thrownError)) {
        throw createHiveError({
          errorCode: "NOT_FOUND",
          category: "PERSISTENCE",
          stage: "READ",
          retryable: false,
          safeMessage: "The original file for this document is not available in storage.",
          correlationId,
          diagnosticReason: "source_object_missing",
        });
      }
      if (isStoragePermissionError(thrownError)) {
        throw createHiveError({
          errorCode: "SOURCE_ACCESS_DENIED",
          category: "SECURITY",
          stage: "READ",
          retryable: false,
          safeMessage: "You do not have permission to open this document.",
          correlationId,
          diagnosticReason: "access_denied",
        });
      }
      throw createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "PERSISTENCE",
        stage: "READ",
        retryable: true,
        safeMessage: "We could not prepare this document right now. Try again in a moment.",
        correlationId,
        diagnosticReason: "storage_failed",
      });
    }
    const { data, error } = signedResult;
    if (!error && typeof data?.signedUrl === "string" && data.signedUrl.trim() !== "") {
      return data.signedUrl.trim();
    }
    const userStorageError = error ?? new Error("empty_signed_url");
    if (isStorageNotFoundError(userStorageError)) {
      throw createHiveError({
        errorCode: "NOT_FOUND",
        category: "PERSISTENCE",
        stage: "READ",
        retryable: false,
        safeMessage: "The original file for this document is not available in storage.",
        correlationId,
        diagnosticReason: "source_object_missing",
      });
    }
    if (isStoragePermissionError(userStorageError)) {
      throw createHiveError({
        errorCode: "SOURCE_ACCESS_DENIED",
        category: "SECURITY",
        stage: "READ",
        retryable: false,
        safeMessage: "You do not have permission to open this document.",
        correlationId,
        diagnosticReason: "access_denied",
      });
    }
    throw createHiveError({
      errorCode: "INTERNAL_ERROR",
      category: "PERSISTENCE",
      stage: "READ",
      retryable: true,
      safeMessage: "We could not prepare this document right now. Try again in a moment.",
      correlationId,
      diagnosticReason: "storage_failed",
    });
  }

  // In-memory / non-userClient test harness path only.
  try {
    const url = await deps.store.createSignedReadUrl(
      { bucket: document.storageBucket, path: document.storagePath },
      SOURCE_PAGE_LINK_SECONDS,
    );
    if (typeof url !== "string" || url.trim() === "") {
      throw createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "PERSISTENCE",
        stage: "READ",
        retryable: true,
        safeMessage: "We received an invalid link for this document. Try again in a moment.",
        correlationId,
        diagnosticReason: "storage_failed",
      });
    }
    return url.trim();
  } catch (error) {
    if (error instanceof HiveError) {
      throw createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "PERSISTENCE",
        stage: "READ",
        retryable: error.retryable,
        safeMessage: "We could not prepare this document right now. Try again in a moment.",
        correlationId,
        diagnosticReason: "storage_failed",
      });
    }
    throw error;
  }
}

export async function openSourceDocumentPageWithV3Vault(
  deps: Pick<HiveVaultUploadAdapterDeps, "vault" | "store" | "loadOwnedHive" | "userClient" | "sourceBucket">,
  input: {
    readonly ownerUserId: string;
    readonly hiveId: string;
    readonly sourceDocumentId: string;
    readonly pageNumber: string;
    readonly correlationId: string;
  },
): Promise<OpenSourceDocumentPageResult> {
  const hiveId = requireUuid(input.hiveId, input.correlationId, "Invalid Hive identifier.", "invalid_hive_id");
  const sourceDocumentId = requireUuid(
    input.sourceDocumentId,
    input.correlationId,
    "Invalid document identifier.",
    "invalid_source_document_id",
  );
  const pageNumber = /^[1-9][0-9]{0,4}$/.test(input.pageNumber.trim()) ? Number(input.pageNumber.trim()) : null;
  if (pageNumber === null) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Invalid page number.",
      correlationId: input.correlationId,
      diagnosticReason: "invalid_page_number",
    });
  }
  const normalizedCallerUserId = input.ownerUserId.trim().toLowerCase();
  const hive = await deps.loadOwnedHive(input.ownerUserId, hiveId, input.correlationId);
  const document = await loadAuthorizedSourceDocumentForViewer(deps, hiveId, sourceDocumentId, input.correlationId);
  const callerMustMatchDocumentOwner = hive.isOwner === true || deps.userClient === undefined;
  if (
    !document ||
    document.id !== sourceDocumentId ||
    document.caseId !== hiveId ||
    !isValidUuid(document.ownerUserId) ||
    (callerMustMatchDocumentOwner && document.ownerUserId !== normalizedCallerUserId) ||
    document.deletedAt !== null ||
    document.lifecycleStatus !== "ACTIVE" ||
    document.uploadStatus !== "UPLOADED"
  ) {
    throw createHiveError({
      errorCode: "NOT_FOUND",
      category: "SECURITY",
      stage: "SHELL",
      retryable: false,
      safeMessage: "We could not find that document.",
      correlationId: input.correlationId,
      diagnosticReason: "not_found",
    });
  }
  if (!document.storageBucket || !document.storagePath) {
    throw createHiveError({
      errorCode: "INTERNAL_ERROR",
      category: "PERSISTENCE",
      stage: "READ",
      retryable: false,
      safeMessage: "The original file location for this document is unavailable.",
      correlationId: input.correlationId,
      diagnosticReason: "source_object_missing",
    });
  }
  const approvedBucket = (deps.sourceBucket ?? DEFAULT_HIVE_SOURCE_BUCKET).trim();
  if (
    approvedBucket !== DEFAULT_HIVE_SOURCE_BUCKET ||
    document.storageBucket !== DEFAULT_HIVE_SOURCE_BUCKET ||
    !isAuthorizedSourceStoragePath(document.storagePath, document.ownerUserId, hiveId, sourceDocumentId)
  ) {
    throw createHiveError({
      errorCode: "SOURCE_ACCESS_DENIED",
      category: "SECURITY",
      stage: "READ",
      retryable: false,
      safeMessage: "This document cannot be opened from its stored location.",
      correlationId: input.correlationId,
      diagnosticReason: "source_path_forbidden",
    });
  }
  const url = await signAuthorizedSourceDocumentUrl(deps, document, input.correlationId);
  return { signedUrl: `${url}#page=${pageNumber}`, mimeType: document.mimeType || "application/pdf" };
}

export async function getUploadQuotaWithV3Vault(
  deps: Pick<HiveVaultUploadAdapterDeps, "vault" | "getQuota">,
  ownerUserId: string,
  correlationId: string,
): Promise<GetUploadQuotaResponse> {
  const quota = deps.getQuota
    ? await deps.getQuota(ownerUserId, correlationId)
    : await computeVaultUploadQuota(deps.vault, ownerUserId);
  return { quota };
}

type AuthorizedSourceDocumentQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

type AuthorizedStorageBucket = {
  createSignedUrl: (
    path: string,
    expiresIn: number,
  ) => Promise<{
    data: { signedUrl: string } | null;
    error: unknown;
  }>;
};

type RpcCapableClient = EdgeSupabaseClient & {
  rpc?: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  schema?: (schema: "hive") => unknown;
  storage?: {
    from: (bucket: string) => unknown;
  };
};

export async function createIntentRequestForOwnedHive(
  client: RpcCapableClient,
  hiveId: string,
  rawBody: unknown,
  correlationId: string,
): Promise<CreateIntentRequestResponse> {
  const safeHiveId = requireUuid(
    hiveId,
    correlationId,
    "Invalid Hive identifier.",
    "invalid_hive_id",
  );
  const validated = validateCreateIntentRequestInput(rawBody);
  if (!validated.ok) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: validated.message,
      correlationId,
      diagnosticReason: validated.diagnosticReason,
    });
  }

  if (typeof client.rpc !== "function") {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: "Could not save what you need. Please try again.",
      correlationId,
      diagnosticReason: "persistence_failed",
    });
  }

  const { data, error } = await client.rpc("create_intent_request", {
    p_hive_id: safeHiveId,
    p_intent_text: validated.value.intentText,
    p_client_request_id: validated.value.clientRequestId,
    ...(validated.value.audience ? { p_audience: validated.value.audience } : {}),
  });

  if (error) {
    const message =
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message.toLowerCase()
        : "";
    if (message.includes("hive_not_found")) {
      throw createHiveError({
        errorCode: "NOT_FOUND",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "We could not find that Hive.",
        correlationId,
        diagnosticReason: "not_found",
      });
    }
    if (message.includes("idempotency_conflict")) {
      throw createHiveError({
        errorCode: "IDEMPOTENCY_CONFLICT",
        category: "PERSISTENCE",
        stage: "SHELL",
        retryable: false,
        safeMessage: "This request ID was already used with different details.",
        correlationId,
        diagnosticReason: "idempotency_conflict",
      });
    }
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: "Could not save what you need. Please try again.",
      correlationId,
      diagnosticReason: "persistence_failed",
    });
  }

  const payload =
    data && typeof data === "object"
      ? (data as { intentRequest?: unknown; created?: unknown })
      : {};
  const intentRequest = normalizeIntentRequestRecord(payload.intentRequest);
  if (!intentRequest) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: "Could not save what you need. Please try again.",
      correlationId,
      diagnosticReason: "unexpected_edge_shape",
    });
  }
  return { intentRequest, created: payload.created !== false };
}

export function createLiveHiveVaultUploadAdapterDeps(
  userClient: RpcCapableClient,
  correlationId: string,
): HiveVaultUploadAdapterDeps {
  const cid = correlationId as CorrelationId;
  let adminClient: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let vaultRepo: SupabaseVaultRepositories | null = null;
  let storeRepo: SupabaseEvidenceObjectStore | null = null;

  const requireAdminClient = () => {
    adminClient ??= createSupabaseAdminClient(loadSupabaseAdminEnv(process.env));
    return adminClient;
  };

  const deps: HiveVaultUploadAdapterDeps = {
    get vault() {
      vaultRepo ??= new SupabaseVaultRepositories(requireAdminClient(), cid);
      return vaultRepo;
    },
    get store() {
      storeRepo ??= new SupabaseEvidenceObjectStore(requireAdminClient(), cid);
      return storeRepo;
    },
    sourceBucket: DEFAULT_HIVE_SOURCE_BUCKET,
    scanHash: defaultHashScanner,
    userClient,
    loadOwnedHive: async (_userId, hiveId, corrId) => {
      const { hive } = await getHiveViaEdge(userClient, hiveId, corrId);
      return hive;
    },
    getQuota: async (ownerUserId) => {
      if (typeof userClient.rpc === "function") {
        const { data, error } = await userClient.rpc("get_upload_quota");
        if (!error) {
          const normalized = normalizeUploadQuota(data);
          if (normalized) {
            return normalized;
          }
        }
      }
      return computeVaultUploadQuota(deps.vault, ownerUserId);
    },
  };

  return deps;
}
