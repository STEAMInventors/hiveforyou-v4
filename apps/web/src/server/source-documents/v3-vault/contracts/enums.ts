export const EVIDENCE_CLASSES = [
  "SOURCE_RECORD",
  "CUSTOMER_INPUT",
  "PROFESSIONAL_ANNOTATION",
  "DOMAIN_CONTEXT",
  "LEGAL_REGULATORY_CONTEXT",
  "LOCAL_JURISDICTION_CONTEXT",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const PIPELINE_STAGES = [
  "INGEST",
  "DISCOVER",
  "COMPLETE",
  "CANONICALIZE",
  "VALIDATE",
  "PROJECT",
  "REVIEW",
  "EXPORT",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "NEEDS_REVIEW",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const INTAKE_RUN_STEP_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "NEEDS_REVIEW",
] as const;
export type IntakeRunStepStatus = (typeof INTAKE_RUN_STEP_STATUSES)[number];

export const ERROR_CATEGORIES = [
  "INPUT_ERROR",
  "VALIDATION_ERROR",
  "AUTHORIZATION_ERROR",
  "POLICY_ERROR",
  "STORAGE_ERROR",
  "MODEL_RUNTIME_ERROR",
  "MODEL_OUTPUT_ERROR",
  "EXTRACTION_ERROR",
  "PACK_VALIDATION_ERROR",
  "PACK_COMPATIBILITY_ERROR",
  "RULE_EXECUTION_ERROR",
  "MEASUREMENT_COMPATIBILITY_ERROR",
  "CANONICALIZATION_ERROR",
  "CONFLICT_ERROR",
  "EXPORT_ERROR",
  "CONCURRENCY_ERROR",
  "DEPENDENCY_ERROR",
  "INTERNAL_ERROR",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const ERROR_SEVERITIES = ["INFO", "WARNING", "ERROR", "FATAL"] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

export const DOMAIN_PACK_AVAILABILITY_STATUSES = [
  "AVAILABLE",
  "NOT_AVAILABLE",
  "NOT_APPLICABLE",
] as const;
export type DomainPackAvailabilityStatus = (typeof DOMAIN_PACK_AVAILABILITY_STATUSES)[number];

export const CASE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const SOURCE_UPLOAD_STATUSES = ["UPLOADED"] as const;
export type SourceUploadStatus = (typeof SOURCE_UPLOAD_STATUSES)[number];

export const SOURCE_LIFECYCLE_STATUSES = [
  "ACTIVE",
  "DELETE_REQUESTED",
  "SOFT_DELETED",
] as const;
export type SourceLifecycleStatus = (typeof SOURCE_LIFECYCLE_STATUSES)[number];

export const UPLOAD_OPERATION_STATUSES = [
  "PENDING",
  "STORED",
  "REGISTERED",
  "FAILED",
] as const;
export type UploadOperationStatus = (typeof UPLOAD_OPERATION_STATUSES)[number];

export const DOMAIN_RESOLUTION_STATUSES = [
  "RESOLVED",
  "AMBIGUOUS",
  "MULTI_DOMAIN",
  "UNKNOWN",
] as const;
export type DomainResolutionStatus = (typeof DOMAIN_RESOLUTION_STATUSES)[number];

export const COMPLETENESS_STATUSES = [
  "PRESENT",
  "MISSING",
  "OPTIONAL",
  "UNRESOLVED",
] as const;
export type CompletenessStatus = (typeof COMPLETENESS_STATUSES)[number];

export const COMPLETENESS_FINDING_TYPES = [
  "EXPECTED_DOCUMENT",
  "HELPFUL_DOCUMENT",
  "MISSING_REQUIRED_DOCUMENT",
  "MISSING_EXPECTED_DOCUMENT",
  "CONDITIONAL_DOCUMENT_MISSING",
  "UNCLASSIFIED_RELEVANT",
] as const;
export type CompletenessFindingType = (typeof COMPLETENESS_FINDING_TYPES)[number];

export const DOCUMENT_REQUEST_DISPOSITIONS = [
  "UPLOAD",
  "I_DONT_HAVE_IT",
  "NOT_APPLICABLE",
] as const;
export type DocumentRequestDisposition = (typeof DOCUMENT_REQUEST_DISPOSITIONS)[number];

export const INTAKE_RELEVANCE_STATUSES = [
  "RELEVANT",
  "IRRELEVANT",
  "UNDETERMINED",
] as const;
export type IntakeRelevanceStatus = (typeof INTAKE_RELEVANCE_STATUSES)[number];

export const INTAKE_VALIDATED_STATUSES = [
  "UNVALIDATED",
  "ACCEPTED",
  "REJECTED",
] as const;
export type IntakeValidatedStatus = (typeof INTAKE_VALIDATED_STATUSES)[number];

export const ACTOR_TYPES = ["USER", "SYSTEM", "SERVICE"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const AUDIT_EVENT_TYPES = [
  "CASE_CREATED",
  "DOCUMENT_UPLOADED",
  "DOCUMENT_DELETE_REQUESTED",
  "INTAKE_STARTED",
  "INTAKE_COMPLETED",
  "INTAKE_FAILED",
  "CANONICAL_STUDY_STARTED",
  "CANONICAL_STUDY_COMPLETED",
  "CANONICAL_STUDY_FAILED",
  "CANONICAL_PUBLISHED",
  "REVIEW_COMPLETED",
  "EXPORT_CREATED",
  "STORAGE_ORPHAN_DETECTED",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
