import type {
  ActorType,
  AuditEventId,
  AuditEventType,
  CaseId,
  CaseStatus,
  CompletenessFindingId,
  CompletenessFindingType,
  CompletenessStatus,
  CorrelationId,
  DocumentRequestDisposition,
  DocumentRequestDispositionId,
  DomainResolutionCandidate,
  DomainResolutionId,
  DomainResolutionStatus,
  HiveDiscoverDomainPack,
  ErrorCategory,
  ErrorSeverity,
  IntakeRelevanceStatus,
  IntakeRunId,
  IntakeRunDocumentId,
  IntakeRunStepId,
  IntakeRunStepStatus,
  IntakeValidatedStatus,
  PipelineStatus,
  SourceDocumentId,
  SourceLifecycleStatus,
  SourceUploadStatus,
  StorageOrphanId,
  TenantId,
  UploadOperationId,
  UploadOperationStatus,
  UserId,
} from "@hives/contracts";

export type SafeMetadata = Readonly<Record<string, string | number | boolean | null>>;

export type CaseRecord = {
  readonly id: CaseId;
  readonly ownerUserId: UserId;
  readonly tenantId: TenantId | null;
  readonly title: string;
  readonly domain: string | null;
  readonly status: CaseStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
};

export type SourceDocumentRecord = {
  readonly id: SourceDocumentId;
  readonly caseId: CaseId;
  readonly ownerUserId: UserId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageBucket: string;
  readonly storagePath: string;
  readonly pageCount: number | null;
  readonly uploadStatus: SourceUploadStatus;
  readonly lifecycleStatus: SourceLifecycleStatus;
  readonly canonicalGapId?: string | null;
  readonly canonicalGapStudyRevisionId?: string | null;
  readonly canonicalGapTitle?: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
};

export type UploadOperationRecord = {
  readonly id: UploadOperationId;
  readonly caseId: CaseId;
  readonly ownerUserId: UserId;
  readonly sourceDocumentId: SourceDocumentId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageBucket: string;
  readonly storagePath: string;
  readonly status: UploadOperationStatus;
  readonly errorCode: string | null;
  readonly errorCategory: ErrorCategory | null;
  readonly clientRequestId?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type IntakeRunRecord = {
  readonly id: IntakeRunId;
  readonly caseId: CaseId;
  readonly status: PipelineStatus;
  readonly engineVersion: string;
  readonly domainIntakeManifestVersion: string;
  readonly domainIntakeManifestChecksum: string;
  readonly modelProvider: string | null;
  readonly modelName: string | null;
  readonly modelVersion: string | null;
  readonly promptVersion: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly errorCategory: ErrorCategory | null;
  readonly createdAt: string;
};

export type IntakeRunStepRecord = {
  readonly id: IntakeRunStepId;
  readonly caseId: CaseId;
  readonly intakeRunId: IntakeRunId;
  readonly stepOrder: number;
  readonly stepType: string;
  readonly status: IntakeRunStepStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly errorCategory: ErrorCategory | null;
  readonly safeMetadata: SafeMetadata;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type IntakeRunDocumentRecord = {
  readonly id: IntakeRunDocumentId;
  readonly intakeRunId: IntakeRunId;
  readonly caseId: CaseId;
  readonly sourceDocumentId: SourceDocumentId;
  readonly inputOrder: number;
  readonly createdAt: string;
};

export type IntakeDocumentResultRecord = {
  readonly id: string;
  readonly caseId: CaseId;
  readonly intakeRunId: IntakeRunId;
  readonly sourceDocumentId: SourceDocumentId;
  readonly logicalDocumentIndex: number;
  readonly proposedDomain: string | null;
  readonly proposedDocumentType: string | null;
  readonly relevanceStatus: IntakeRelevanceStatus;
  readonly relevanceReason: string | null;
  readonly detectedDocumentDate: string | null;
  readonly duplicateOfSourceDocumentId: SourceDocumentId | null;
  readonly versionOfSourceDocumentId: SourceDocumentId | null;
  readonly modelConfidence: number | null;
  readonly validatedStatus: IntakeValidatedStatus;
  readonly startPage: number | null;
  readonly endPage: number | null;
  readonly createdAt: string;
};

export type DomainResolutionRecord = {
  readonly id: DomainResolutionId;
  readonly intakeRunId: IntakeRunId;
  readonly resolutionStatus: DomainResolutionStatus;
  readonly resolvedDomain: string | null;
  readonly candidateDomains: readonly DomainResolutionCandidate[];
  readonly validationStatus: string;
  readonly domainPack: HiveDiscoverDomainPack | null;
  readonly createdAt: string;
};

export type CompletenessFindingRecord = {
  readonly id: CompletenessFindingId;
  readonly intakeRunId: IntakeRunId;
  readonly domain: string;
  readonly documentType: string;
  readonly findingType: CompletenessFindingType;
  readonly completenessStatus: CompletenessStatus;
  readonly severity: ErrorSeverity;
  readonly sourceRuleId: string | null;
  readonly sourcePackId: string | null;
  readonly sourcePackVersion: string | null;
  readonly userMessage: string | null;
  readonly processingAllowed: boolean;
  readonly createdAt: string;
};

export type AuditEventRecord = {
  readonly id: AuditEventId;
  readonly ownerUserId: UserId;
  readonly caseId: CaseId | null;
  readonly sourceDocumentId: SourceDocumentId | null;
  readonly intakeRunId: IntakeRunId | null;
  readonly eventType: AuditEventType;
  readonly actorUserId: UserId | null;
  readonly actorType: ActorType;
  readonly correlationId: CorrelationId | null;
  readonly safeMetadata: SafeMetadata;
  readonly createdAt: string;
};

export type DocumentRequestDispositionRecord = {
  readonly id: DocumentRequestDispositionId;
  readonly caseId: CaseId;
  readonly ownerUserId: UserId;
  readonly domain: string;
  readonly documentType: string;
  readonly disposition: DocumentRequestDisposition;
  readonly actorUserId: UserId | null;
  readonly intakeRunId: IntakeRunId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type StorageOrphanRecord = {
  readonly id: StorageOrphanId;
  readonly ownerUserId: UserId;
  readonly caseId: CaseId;
  readonly sourceDocumentId: SourceDocumentId;
  readonly uploadOperationId: UploadOperationId | null;
  readonly storageBucket: string;
  readonly storagePath: string;
  readonly sha256: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly reconciledAt: string | null;
};
