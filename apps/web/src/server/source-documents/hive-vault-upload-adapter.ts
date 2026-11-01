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
  reconcileUploadOperation,
  registerSourceDocument,
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
  type ListSourceDocumentsResponse,
  type SourceDocument,
  type SourceFailureReason,
  type SourceMimeType,
  type UploadQuota,
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
  const trimmedName = input.fileName.trim();
  const resolvedMime =
    (input.mimeType && isSourceMimeType(input.mimeType) ? input.mimeType : null) ??
    sourceMimeTypeForFileName(trimmedName);

  if (!trimmedName || trimmedName.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(trimmedName)) {
    throw createHiveError({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "REGISTER",
      retryable: false,
      safeMessage: "Rename this file and try again.",
      correlationId: input.correlationId,
      diagnosticReason: "invalid_file_name",
    });
  }
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

  // 1. Verify Hive ownership via V4 Hive identity.
  const hive = await deps.loadOwnedHive(input.ownerUserId, safeHiveId, input.correlationId);
  const sourceBucket = deps.sourceBucket ?? DEFAULT_HIVE_SOURCE_BUCKET;

  // 2. Check idempotent replay for (ownerUserId, clientRequestId).
  if (deps.clientRequests) {
    const existingBinding = await deps.clientRequests.get(input.ownerUserId, safeClientRequestId);
    if (existingBinding) {
      if (
        existingBinding.hiveId !== safeHiveId ||
        existingBinding.fileName !== trimmedName ||
        existingBinding.byteSize !== input.bytes.byteLength
      ) {
        throw createHiveError({
          errorCode: "IDEMPOTENCY_CONFLICT",
          category: "PERSISTENCE",
          stage: "SHELL",
          retryable: false,
          safeMessage: "This request ID was already used with different details.",
          correlationId: input.correlationId,
          diagnosticReason: "idempotency_conflict",
        });
      }
      if (existingBinding.status === "REJECTED") {
        return {
          sourceDocument: buildRejectedSourceDocument(existingBinding),
          uploadOperation: null,
          created: false,
        };
      }
      if (existingBinding.uploadOperationId) {
        const reconciled = await reconcileUploadOperation(
          { vault: deps.vault, store: deps.store, sourceBucket },
          existingBinding.uploadOperationId as UploadOperationId,
          {
            userId: input.ownerUserId as UserId,
            actorType: "USER",
            correlationId: input.correlationId as CorrelationId,
          },
        );
        const doc = await deps.vault.sourceDocuments.getById(reconciled.sourceDocumentId);
        if (doc) {
          return {
            sourceDocument: mapV3DocumentToV4SourceDocument(doc, {
              clientRequestId: safeClientRequestId,
              scanStatus: existingBinding.scanStatus,
            }),
            uploadOperation: reconciled,
            created: false,
          };
        }
      }
    }
  }

  // 3. Enforce Free monthly quota (10 registered uploads per UTC month, D-012).
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

  // 4. Run V3's validateUpload pre-check so magic-byte or size errors fail before hash scan.
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
      hiveId: safeHiveId,
      clientRequestId: safeClientRequestId,
      fileName: trimmedName,
      mimeType: resolvedMime,
      byteSize: input.bytes.byteLength,
    });
    if (mapped.rejected) {
      if (deps.clientRequests) {
        await deps.clientRequests.save({
          ownerUserId: input.ownerUserId,
          clientRequestId: safeClientRequestId,
          hiveId: safeHiveId,
          uploadOperationId: null,
          status: "REJECTED",
          failureReason: "TYPE_MISMATCH",
          scanStatus: "UNKNOWN_TO_SCANNER",
          fileName: trimmedName,
          mimeType: resolvedMime,
          byteSize: input.bytes.byteLength,
          createdAt: mapped.rejected.createdAt,
        });
      }
      return { sourceDocument: mapped.rejected, uploadOperation: null, created: true };
    }
    throw mapped.thrown!;
  }

  // 5. Run pre-registration SHA-256 malware hash scan (D-027).
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const scanHash = deps.scanHash ?? defaultHashScanner;
  let verdict: ScanVerdict;
  try {
    verdict = await scanHash(sha256);
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
    const binding: ClientRequestBinding = {
      ownerUserId: input.ownerUserId,
      clientRequestId: safeClientRequestId,
      hiveId: safeHiveId,
      uploadOperationId: null,
      status: "REJECTED",
      failureReason: "MALWARE_DETECTED",
      scanStatus: "MALICIOUS",
      fileName: trimmedName,
      mimeType: resolvedMime,
      byteSize: input.bytes.byteLength,
      createdAt: now,
    };
    if (deps.clientRequests) {
      await deps.clientRequests.save(binding);
    }
    return {
      sourceDocument: buildRejectedSourceDocument(binding),
      uploadOperation: null,
      created: true,
    };
  }

  // 6. Ensure the 1:1 `hive.cases` companion row exists (`caseId === hive.id`).
  const caseId = await ensureCaseForOwnedHive(deps.vault, {
    ownerUserId: input.ownerUserId,
    hive,
    correlationId: input.correlationId,
  });

  // 7. Invoke V3's `registerSourceDocument` unchanged.
  try {
    const registered = await registerSourceDocument(
      { vault: deps.vault, store: deps.store, sourceBucket },
      {
        actorUserId: input.ownerUserId as UserId,
        actorType: "USER",
        caseId,
        originalFilename: trimmedName,
        mimeType: resolvedMime,
        bytes: input.bytes,
        correlationId: input.correlationId as CorrelationId,
      },
    );

    if (deps.clientRequests) {
      await deps.clientRequests.save({
        ownerUserId: input.ownerUserId,
        clientRequestId: safeClientRequestId,
        hiveId: safeHiveId,
        uploadOperationId: registered.uploadOperation.id,
        status: "REGISTERED",
        failureReason: null,
        scanStatus: verdict,
        fileName: trimmedName,
        mimeType: resolvedMime,
        byteSize: input.bytes.byteLength,
        createdAt: registered.document.createdAt,
      });
    }

    return {
      sourceDocument: mapV3DocumentToV4SourceDocument(registered.document, {
        clientRequestId: safeClientRequestId,
        scanStatus: verdict,
      }),
      uploadOperation: registered.uploadOperation,
      created: true,
    };
  } catch (error) {
    const mapped = mapV3UploadError(error, input.correlationId, {
      hiveId: safeHiveId,
      clientRequestId: safeClientRequestId,
      fileName: trimmedName,
      mimeType: resolvedMime,
      byteSize: input.bytes.byteLength,
    });
    if (mapped.rejected) {
      return { sourceDocument: mapped.rejected, uploadOperation: null, created: true };
    }
    throw mapped.thrown!;
  }
}

export async function listHiveSourceDocumentsWithV3Vault(
  deps: Pick<HiveVaultUploadAdapterDeps, "vault" | "loadOwnedHive">,
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
  const records = await deps.vault.sourceDocuments.listByCase(safeHiveId as CaseId);
  const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    sourceDocuments: sorted.map((record) => mapV3DocumentToV4SourceDocument(record)),
  };
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

type RpcCapableClient = EdgeSupabaseClient & {
  rpc?: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
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
  const adminEnv = loadSupabaseAdminEnv({
    ...process.env,
    SUPABASE_URL:
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  });
  const adminClient = createSupabaseAdminClient(adminEnv);
  const cid = correlationId as CorrelationId;
  const vault = new SupabaseVaultRepositories(adminClient, cid);
  const store = new SupabaseEvidenceObjectStore(adminClient, cid);

  return {
    vault,
    store,
    sourceBucket: DEFAULT_HIVE_SOURCE_BUCKET,
    scanHash: defaultHashScanner,
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
      return computeVaultUploadQuota(vault, ownerUserId);
    },
  };
}
