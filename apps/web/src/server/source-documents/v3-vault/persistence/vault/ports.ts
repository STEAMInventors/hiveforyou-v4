import type {
  CaseId,
  CorrelationId,
  ErrorCategory,
  SourceDocumentId,
  UploadOperationId,
  UserId,
} from "@hives/contracts";
import type {
  AuditEventRecord,
  CaseRecord,
  CompletenessFindingRecord,
  DocumentRequestDispositionRecord,
  DomainResolutionRecord,
  IntakeDocumentResultRecord,
  IntakeRunDocumentRecord,
  IntakeRunRecord,
  IntakeRunStepRecord,
  SourceDocumentRecord,
  StorageOrphanRecord,
  UploadOperationRecord,
} from "./records.js";

export type GetCaseOptions = {
  readonly includeDeleted?: boolean | undefined;
};

export type CaseRepository = {
  insert(record: CaseRecord): Promise<void>;
  getById(id: CaseId, options?: GetCaseOptions): Promise<CaseRecord | undefined>;
  listByOwner(ownerUserId: UserId): Promise<readonly CaseRecord[]>;
  softDelete(id: CaseId, deletedAt: string): Promise<void>;
};

export type SourceDocumentRepository = {
  insert(record: SourceDocumentRecord): Promise<void>;
  getById(id: SourceDocumentId): Promise<SourceDocumentRecord | undefined>;
  listByCase(caseId: CaseId): Promise<readonly SourceDocumentRecord[]>;
  findBySha256(caseId: CaseId, sha256: string): Promise<readonly SourceDocumentRecord[]>;
  softDelete(id: SourceDocumentId, deletedAt: string): Promise<void>;
};

export type UploadOperationRepository = {
  insertPending(record: UploadOperationRecord): Promise<void>;
  getByClientRequestId(
    ownerUserId: UserId,
    caseId: CaseId,
    clientRequestId: string,
  ): Promise<UploadOperationRecord | undefined>;
  getById(id: UploadOperationId): Promise<UploadOperationRecord | undefined>;
  getBySourceDocumentId(id: SourceDocumentId): Promise<UploadOperationRecord | undefined>;
  listByCase(caseId: CaseId): Promise<readonly UploadOperationRecord[]>;
  markStored(id: UploadOperationId, updatedAt: string): Promise<void>;
  markRegistered(id: UploadOperationId, updatedAt: string): Promise<void>;
  markFailed(
    id: UploadOperationId,
    updatedAt: string,
    errorCode: string,
    errorCategory: ErrorCategory,
  ): Promise<void>;
};

export type IntakeRunCompletion = {
  readonly status: "SUCCEEDED" | "FAILED" | "NEEDS_REVIEW";
  readonly completedAt: string;
  readonly errorCode: string | null;
  readonly errorCategory: ErrorCategory | null;
  readonly correlationId: CorrelationId;
};

export type IntakeRunRepository = {
  insert(record: IntakeRunRecord): Promise<void>;
  getById(id: IntakeRunRecord["id"]): Promise<IntakeRunRecord | undefined>;
  listByCase(caseId: CaseId): Promise<readonly IntakeRunRecord[]>;
  markCompleted(id: IntakeRunRecord["id"], update: IntakeRunCompletion): Promise<void>;
};

export type IntakeRunStepCompletion = {
  readonly status: IntakeRunStepRecord["status"];
  readonly completedAt: string;
  readonly errorCode: string | null;
  readonly errorCategory: ErrorCategory | null;
  readonly safeMetadata: IntakeRunStepRecord["safeMetadata"];
  readonly correlationId: CorrelationId;
};

export type IntakeRunStepRepository = {
  insert(record: IntakeRunStepRecord): Promise<void>;
  getById(id: IntakeRunStepRecord["id"]): Promise<IntakeRunStepRecord | undefined>;
  listByRun(intakeRunId: IntakeRunRecord["id"]): Promise<readonly IntakeRunStepRecord[]>;
  markCompleted(id: IntakeRunStepRecord["id"], update: IntakeRunStepCompletion): Promise<void>;
};

export type IntakeRunDocumentRepository = {
  insert(record: IntakeRunDocumentRecord): Promise<void>;
  listByRun(intakeRunId: IntakeRunRecord["id"]): Promise<readonly IntakeRunDocumentRecord[]>;
};

export type PersistIntakeResultInput = {
  readonly documentResults: readonly IntakeDocumentResultRecord[];
  readonly domainResolution: DomainResolutionRecord;
  readonly completenessFindings: readonly CompletenessFindingRecord[];
  readonly runCompletion: IntakeRunCompletion & { readonly id: IntakeRunRecord["id"] };
  readonly auditEvent: AuditEventRecord;
};

export type IntakeDocumentResultRepository = {
  insert(record: IntakeDocumentResultRecord): Promise<void>;
  listByRun(intakeRunId: IntakeRunRecord["id"]): Promise<readonly IntakeDocumentResultRecord[]>;
};

export type DomainResolutionRepository = {
  insert(record: DomainResolutionRecord): Promise<void>;
  listByRun(intakeRunId: IntakeRunRecord["id"]): Promise<readonly DomainResolutionRecord[]>;
};

export type CompletenessFindingRepository = {
  insert(record: CompletenessFindingRecord): Promise<void>;
  listByRun(intakeRunId: IntakeRunRecord["id"]): Promise<readonly CompletenessFindingRecord[]>;
};

export type DocumentRequestDispositionRepository = {
  upsert(record: DocumentRequestDispositionRecord): Promise<void>;
  listByCase(caseId: CaseId): Promise<readonly DocumentRequestDispositionRecord[]>;
};

export type AuditEventRepository = {
  append(event: AuditEventRecord): Promise<void>;
  listByCase(caseId: CaseId): Promise<readonly AuditEventRecord[]>;
};

export type StorageOrphanRepository = {
  insert(record: StorageOrphanRecord): Promise<void>;
  listOpen(): Promise<readonly StorageOrphanRecord[]>;
};

export type VaultStores = {
  readonly cases: CaseRepository;
  readonly sourceDocuments: SourceDocumentRepository;
  readonly uploadOperations: UploadOperationRepository;
  readonly intakeRuns: IntakeRunRepository;
  readonly intakeRunSteps: IntakeRunStepRepository;
  readonly intakeRunDocuments: IntakeRunDocumentRepository;
  readonly intakeDocumentResults: IntakeDocumentResultRepository;
  readonly domainResolutions: DomainResolutionRepository;
  readonly completenessFindings: CompletenessFindingRepository;
  readonly documentRequestDispositions: DocumentRequestDispositionRepository;
  readonly auditEvents: AuditEventRepository;
  readonly storageOrphans: StorageOrphanRepository;
};

export type VaultRepositories = VaultStores & {
  withTransaction<T>(fn: (stores: VaultStores) => Promise<T>): Promise<T>;
  persistIntakeResult(input: PersistIntakeResultInput): Promise<void>;
};
