import { randomUUID } from "node:crypto";
import type {
  AuditEventId,
  CaseId,
  CompletenessFindingId,
  ConflictId,
  DocumentRequestDispositionId,
  CorrelationId,
  DomainResolutionId,
  EntityId,
  EvidenceId,
  EvidenceSetId,
  EventId,
  ExportId,
  FactId,
  FindingId,
  IntakeRunId,
  IntakeRunDocumentId,
  IntakeRunStepId,
  LogicalDocumentId,
  MeasurementId,
  PackId,
  ProjectionId,
  RelationshipId,
  ReviewId,
  RunId,
  SeriesId,
  SnapshotId,
  SourceDocumentId,
  StageId,
  StorageOrphanId,
  TenantId,
  UnresolvedItemId,
  UploadOperationId,
  UserId,
  CanonicalRecordId,
  CanonicalRecordVersionId,
  CanonicalStudyRunId,
  CanonicalStudyRunStepId,
  CanonicalStudyProposalId,
  EvidenceAnchorId,
  CanonicalEvidenceLinkId,
  CanonicalReferenceId,
  CanonicalTimelineEntryId,
  StudyEvidenceIndexId,
} from "@hives/contracts";

const create = <T extends string>() => randomUUID() as T;

export const createTenantId = (): TenantId => create();
export const createUserId = (): UserId => create();
export const createCaseId = (): CaseId => create();
export const createEntityId = (): EntityId => create();
export const createFactId = (): FactId => create();
export const createEventId = (): EventId => create();
export const createRelationshipId = (): RelationshipId => create();
export const createMeasurementId = (): MeasurementId => create();
export const createEvidenceId = (): EvidenceId => create();
export const createEvidenceSetId = (): EvidenceSetId => create();
export const createSourceDocumentId = (): SourceDocumentId => create();
export const createLogicalDocumentId = (): LogicalDocumentId => create();
export const createRunId = (): RunId => create();
export const createStageId = (): StageId => create();
export const createSnapshotId = (): SnapshotId => create();
export const createPackId = (): PackId => create();
export const createCorrelationId = (): CorrelationId => create();
export const createConflictId = (): ConflictId => create();
export const createFindingId = (): FindingId => create();
export const createUnresolvedItemId = (): UnresolvedItemId => create();
export const createExportId = (): ExportId => create();
export const createProjectionId = (): ProjectionId => create();
export const createReviewId = (): ReviewId => create();
export const createAuditEventId = (): AuditEventId => create();
export const createSeriesId = (): SeriesId => create();
export const createUploadOperationId = (): UploadOperationId => create();
export const createIntakeRunId = (): IntakeRunId => create();
export const createIntakeRunStepId = (): IntakeRunStepId => create();
export const createIntakeRunDocumentId = (): IntakeRunDocumentId => create();
export const createDomainResolutionId = (): DomainResolutionId => create();
export const createCompletenessFindingId = (): CompletenessFindingId => create();
export const createDocumentRequestDispositionId = (): DocumentRequestDispositionId => create();
export const createStorageOrphanId = (): StorageOrphanId => create();
export const createCanonicalRecordId = (): CanonicalRecordId => create();
export const createCanonicalRecordVersionId = (): CanonicalRecordVersionId => create();
export const createCanonicalStudyRunId = (): CanonicalStudyRunId => create();
export const createCanonicalStudyRunStepId = (): CanonicalStudyRunStepId => create();
export const createCanonicalStudyProposalId = (): CanonicalStudyProposalId => create();
export const createEvidenceAnchorId = (): EvidenceAnchorId => create();
export const createCanonicalEvidenceLinkId = (): CanonicalEvidenceLinkId => create();
export const createCanonicalReferenceId = (): CanonicalReferenceId => create();
export const createCanonicalTimelineEntryId = (): CanonicalTimelineEntryId => create();
export const createStudyEvidenceIndexId = (): StudyEvidenceIndexId => create();
