import type {
  ActorType,
  CorrelationId,
  UploadOperationId,
  UserId,
} from "@hives/contracts";
import {
  createAuditEventId,
  createSourceDocumentId,
  createStorageOrphanId,
  createUploadOperationId,
  HiveError,
} from "@hives/core";
import { assertCaseOwner, determineSourcePageCount, validateUpload } from "@hives/security";
import type { EvidenceObjectStore, ObjectRef } from "../storage/port.js";
import { sha256Hex } from "./hash.js";
import { buildSourceObjectPath } from "./path.js";
import type { VaultRepositories } from "./ports.js";
import type { SourceDocumentRecord, UploadOperationRecord } from "./records.js";
import { toSafeAuditMetadata } from "./safe-metadata.js";

export type RegisterSourceDocumentInput = {
  readonly actorUserId: UserId;
  readonly actorType: ActorType;
  readonly caseId: SourceDocumentRecord["caseId"];
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly correlationId: CorrelationId;
};

export type RegisterSourceDocumentResult = {
  readonly document: SourceDocumentRecord;
  readonly uploadOperation: UploadOperationRecord;
  readonly hashMatches: readonly SourceDocumentRecord[];
};

export type RegisterSourceDocumentDeps = {
  readonly vault: VaultRepositories;
  readonly store: EvidenceObjectStore;
  readonly sourceBucket: string;
};

export async function registerSourceDocument(
  deps: RegisterSourceDocumentDeps,
  input: RegisterSourceDocumentInput,
): Promise<RegisterSourceDocumentResult> {
  const { vault, store, sourceBucket } = deps;
  const caseRecord = await vault.cases.getById(input.caseId);
  if (caseRecord === undefined) {
    throw new HiveError({
      code: "CASE_ACCESS_DENIED",
      category: "AUTHORIZATION_ERROR",
      message: "Actor is not authorized for this case.",
      retryable: false,
      severity: "FATAL",
      correlationId: input.correlationId,
    });
  }
  assertCaseOwner(input.actorUserId, caseRecord.ownerUserId, input.correlationId);
  validateUpload({
    originalName: input.originalFilename,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
    correlationId: input.correlationId,
    bytes: input.bytes,
  });
  // Persist page_count before Engine 1; fail closed when structure cannot be counted.
  const pageCount = determineSourcePageCount(input.mimeType, input.bytes, input.correlationId);

  const sourceDocumentId = createSourceDocumentId();
  const uploadOperationId = createUploadOperationId();
  const sha256 = sha256Hex(input.bytes);
  const storagePath = buildSourceObjectPath(
    caseRecord.ownerUserId,
    caseRecord.id,
    sourceDocumentId,
  );
  const now = new Date().toISOString();
  const pending: UploadOperationRecord = {
    id: uploadOperationId,
    caseId: caseRecord.id,
    ownerUserId: caseRecord.ownerUserId,
    sourceDocumentId,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    byteSize: input.bytes.byteLength,
    sha256,
    storageBucket: sourceBucket,
    storagePath,
    status: "PENDING",
    errorCode: null,
    errorCategory: null,
    createdAt: now,
    updatedAt: now,
  };
  await vault.uploadOperations.insertPending(pending);

  const ref: ObjectRef = { bucket: sourceBucket, path: storagePath };
  try {
    await store.putCreateOnly({
      ...ref,
      bytes: input.bytes,
      contentType: input.mimeType,
      correlationId: input.correlationId,
    });
  } catch (error) {
    await bestEffortMarkFailed(vault, uploadOperationId, error, input.correlationId);
    throw error;
  }

  try {
    await vault.uploadOperations.markStored(uploadOperationId, new Date().toISOString());
  } catch (error) {
    throw wrapRegistrationFailure(error, input.correlationId);
  }

  const document: SourceDocumentRecord = {
    id: sourceDocumentId,
    caseId: caseRecord.id,
    ownerUserId: caseRecord.ownerUserId,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    byteSize: input.bytes.byteLength,
    sha256,
    storageBucket: sourceBucket,
    storagePath,
    pageCount,
    uploadStatus: "UPLOADED",
    lifecycleStatus: "ACTIVE",
    createdAt: now,
    deletedAt: null,
  };

  try {
    await publishRegisteredDocument(vault, {
      document,
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      correlationId: input.correlationId,
      uploadOperationId,
    });
  } catch (error) {
    await recoverFailedPublication(deps, {
      ref,
      document,
      uploadOperationId,
      error,
      correlationId: input.correlationId,
    });
    throw wrapRegistrationFailure(error, input.correlationId);
  }

  const hashMatches = (await vault.sourceDocuments.findBySha256(caseRecord.id, sha256)).filter(
    (item) => item.id !== document.id,
  );
  const uploadOperation = await vault.uploadOperations.getById(uploadOperationId);
  if (uploadOperation === undefined) {
    throw wrapRegistrationFailure(new Error("missing upload operation"), input.correlationId);
  }
  return { document, uploadOperation, hashMatches };
}

export async function reconcileUploadOperation(
  deps: RegisterSourceDocumentDeps,
  uploadOperationId: UploadOperationId,
  actor: { readonly userId: UserId; readonly actorType: ActorType; readonly correlationId: CorrelationId },
): Promise<UploadOperationRecord> {
  const operation = await deps.vault.uploadOperations.getById(uploadOperationId);
  if (operation === undefined) {
    throw new HiveError({
      code: "UPLOAD_OPERATION_NOT_FOUND",
      category: "STORAGE_ERROR",
      message: "Upload operation was not found.",
      retryable: false,
      severity: "ERROR",
      correlationId: actor.correlationId,
    });
  }
  if (operation.status === "REGISTERED" || operation.status === "FAILED") {
    return operation;
  }
  const ref: ObjectRef = { bucket: operation.storageBucket, path: operation.storagePath };
  const objectExists = await deps.store.exists(ref);
  if (operation.status === "PENDING") {
    if (!objectExists) {
      await deps.vault.uploadOperations.markFailed(
        operation.id,
        new Date().toISOString(),
        "UPLOAD_STORAGE_FAILED",
        "STORAGE_ERROR",
      );
      const failed = await deps.vault.uploadOperations.getById(operation.id);
      return failed ?? operation;
    }
    await deps.vault.uploadOperations.markStored(operation.id, new Date().toISOString());
  }
  const stored = await deps.vault.uploadOperations.getById(operation.id);
  if (stored === undefined) {
    return operation;
  }
  const storedExists = await deps.store.exists(ref);
  if (stored.status === "STORED") {
    if (!storedExists) {
      await deps.vault.uploadOperations.markFailed(
        stored.id,
        new Date().toISOString(),
        "UPLOAD_OBJECT_MISSING",
        "STORAGE_ERROR",
      );
      const failed = await deps.vault.uploadOperations.getById(stored.id);
      return failed ?? stored;
    }
    const existingDoc = await deps.vault.sourceDocuments.getById(stored.sourceDocumentId);
    if (existingDoc !== undefined) {
      await deps.vault.uploadOperations.markRegistered(stored.id, new Date().toISOString());
    } else {
      const bytes = await deps.store.downloadBytes(ref);
      const pageCount = determineSourcePageCount(stored.mimeType, bytes, actor.correlationId);
      await publishRegisteredDocument(deps.vault, {
        document: documentFromOperation(stored, pageCount),
        actorUserId: actor.userId,
        actorType: actor.actorType,
        correlationId: actor.correlationId,
        uploadOperationId: stored.id,
      });
    }
  }
  const latest = await deps.vault.uploadOperations.getById(operation.id);
  return latest ?? operation;
}

async function publishRegisteredDocument(
  vault: VaultRepositories,
  input: {
    readonly document: SourceDocumentRecord;
    readonly actorUserId: UserId;
    readonly actorType: ActorType;
    readonly correlationId: CorrelationId;
    readonly uploadOperationId: UploadOperationId;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await vault.withTransaction(async (tx) => {
    await tx.sourceDocuments.insert(input.document);
    await tx.auditEvents.append({
      id: createAuditEventId(),
      ownerUserId: input.document.ownerUserId,
      caseId: input.document.caseId,
      sourceDocumentId: input.document.id,
      intakeRunId: null,
      eventType: "DOCUMENT_UPLOADED",
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      correlationId: input.correlationId,
      safeMetadata: toSafeAuditMetadata({
        sha256: input.document.sha256,
        byteSize: input.document.byteSize,
        mimeType: input.document.mimeType,
        storageBucket: input.document.storageBucket,
      }),
      createdAt: now,
    });
    await tx.uploadOperations.markRegistered(input.uploadOperationId, now);
  });
}

async function recoverFailedPublication(
  deps: RegisterSourceDocumentDeps,
  input: {
    readonly ref: ObjectRef;
    readonly document: SourceDocumentRecord;
    readonly uploadOperationId: UploadOperationId;
    readonly error: unknown;
    readonly correlationId: CorrelationId;
  },
): Promise<void> {
  let deleted = false;
  try {
    await deps.store.delete(input.ref);
    deleted = true;
  } catch {
    deleted = false;
  }
  try {
    if (deleted) {
      await deps.vault.uploadOperations.markFailed(
        input.uploadOperationId,
        new Date().toISOString(),
        "UPLOAD_REGISTRATION_FAILED",
        "STORAGE_ERROR",
      );
      return;
    }
    await deps.vault.storageOrphans.insert({
      id: createStorageOrphanId(),
      ownerUserId: input.document.ownerUserId,
      caseId: input.document.caseId,
      sourceDocumentId: input.document.id,
      uploadOperationId: input.uploadOperationId,
      storageBucket: input.document.storageBucket,
      storagePath: input.document.storagePath,
      sha256: input.document.sha256,
      reason: "PUBLICATION_FAILED_OBJECT_RETAINED",
      createdAt: new Date().toISOString(),
      reconciledAt: null,
    });
    await deps.vault.auditEvents.append({
      id: createAuditEventId(),
      ownerUserId: input.document.ownerUserId,
      caseId: input.document.caseId,
      sourceDocumentId: input.document.id,
      intakeRunId: null,
      eventType: "STORAGE_ORPHAN_DETECTED",
      actorUserId: null,
      actorType: "SYSTEM",
      correlationId: input.correlationId,
      safeMetadata: toSafeAuditMetadata({
        sha256: input.document.sha256,
        byteSize: input.document.byteSize,
        uploadOperationId: input.uploadOperationId,
      }),
      createdAt: new Date().toISOString(),
    });
  } catch {
    // upload_operations remains STORED (or PENDING). Recovery is deterministic.
  }
}

async function bestEffortMarkFailed(
  vault: VaultRepositories,
  uploadOperationId: UploadOperationId,
  error: unknown,
  _correlationId: CorrelationId,
): Promise<void> {
  void _correlationId;
  const code = error instanceof HiveError ? error.code : "UPLOAD_STORAGE_FAILED";
  const category = error instanceof HiveError ? error.category : "STORAGE_ERROR";
  try {
    await vault.uploadOperations.markFailed(
      uploadOperationId,
      new Date().toISOString(),
      code,
      category,
    );
  } catch {
    return;
  }
}

function wrapRegistrationFailure(error: unknown, correlationId: CorrelationId): HiveError {
  if (error instanceof HiveError) {
    return error;
  }
  return new HiveError({
    code: "UPLOAD_REGISTRATION_FAILED",
    category: "STORAGE_ERROR",
    message: "Source document registration failed after storage.",
    retryable: true,
    severity: "ERROR",
    correlationId,
    cause: error,
  });
}

function documentFromOperation(
  operation: UploadOperationRecord,
  pageCount: number,
): SourceDocumentRecord {
  return {
    id: operation.sourceDocumentId,
    caseId: operation.caseId,
    ownerUserId: operation.ownerUserId,
    originalFilename: operation.originalFilename,
    mimeType: operation.mimeType,
    byteSize: operation.byteSize,
    sha256: operation.sha256,
    storageBucket: operation.storageBucket,
    storagePath: operation.storagePath,
    pageCount,
    uploadStatus: "UPLOADED",
    lifecycleStatus: "ACTIVE",
    createdAt: operation.createdAt,
    deletedAt: null,
  };
}
