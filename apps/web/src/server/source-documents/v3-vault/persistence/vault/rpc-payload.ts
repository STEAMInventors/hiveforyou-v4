import type { PersistIntakeResultInput } from "./ports.js";
import type {
  AuditEventRecord,
  CaseRecord,
  CompletenessFindingRecord,
  DomainResolutionRecord,
  IntakeDocumentResultRecord,
  IntakeRunDocumentRecord,
  IntakeRunRecord,
  IntakeRunStepRecord,
  SourceDocumentRecord,
} from "./records.js";

export type VaultTransactionOp =
  | { readonly op: "insert_case"; readonly row: Record<string, unknown> }
  | { readonly op: "insert_source_document"; readonly row: Record<string, unknown> }
  | { readonly op: "insert_intake_run"; readonly row: Record<string, unknown> }
  | { readonly op: "insert_intake_run_document"; readonly row: Record<string, unknown> }
  | { readonly op: "insert_intake_run_step"; readonly row: Record<string, unknown> }
  | { readonly op: "update_intake_run_step"; readonly row: Record<string, unknown> }
  | { readonly op: "update_intake_run"; readonly row: Record<string, unknown> }
  | { readonly op: "append_audit"; readonly row: Record<string, unknown> }
  | { readonly op: "mark_upload_registered"; readonly row: Record<string, unknown> };

export function caseRow(record: CaseRecord): Record<string, unknown> {
  return {
    id: record.id,
    owner_user_id: record.ownerUserId,
    tenant_id: record.tenantId,
    title: record.title,
    domain: record.domain,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt,
  };
}

export function sourceDocumentRow(record: SourceDocumentRecord): Record<string, unknown> {
  return {
    id: record.id,
    case_id: record.caseId,
    owner_user_id: record.ownerUserId,
    original_filename: record.originalFilename,
    mime_type: record.mimeType,
    byte_size: record.byteSize,
    sha256: record.sha256,
    storage_bucket: record.storageBucket,
    storage_path: record.storagePath,
    page_count: record.pageCount,
    upload_status: record.uploadStatus,
    lifecycle_status: record.lifecycleStatus,
    created_at: record.createdAt,
    deleted_at: record.deletedAt,
  };
}

export function intakeRunRow(record: IntakeRunRecord): Record<string, unknown> {
  return {
    id: record.id,
    case_id: record.caseId,
    status: record.status,
    engine_version: record.engineVersion,
    domain_intake_manifest_version: record.domainIntakeManifestVersion,
    domain_intake_manifest_checksum: record.domainIntakeManifestChecksum,
    model_provider: record.modelProvider,
    model_name: record.modelName,
    model_version: record.modelVersion,
    prompt_version: record.promptVersion,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    error_code: record.errorCode,
    error_category: record.errorCategory,
    created_at: record.createdAt,
  };
}

export function intakeRunDocumentRow(record: IntakeRunDocumentRecord): Record<string, unknown> {
  return {
    id: record.id,
    intake_run_id: record.intakeRunId,
    case_id: record.caseId,
    source_document_id: record.sourceDocumentId,
    input_order: record.inputOrder,
    created_at: record.createdAt,
  };
}

export function intakeRunStepRow(record: IntakeRunStepRecord): Record<string, unknown> {
  return {
    id: record.id,
    case_id: record.caseId,
    intake_run_id: record.intakeRunId,
    step_order: record.stepOrder,
    step_type: record.stepType,
    status: record.status,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    error_code: record.errorCode,
    error_category: record.errorCategory,
    safe_metadata: record.safeMetadata,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function intakeDocumentResultRow(record: IntakeDocumentResultRecord): Record<string, unknown> {
  return {
    id: record.id,
    case_id: record.caseId,
    intake_run_id: record.intakeRunId,
    source_document_id: record.sourceDocumentId,
    logical_document_index: record.logicalDocumentIndex,
    proposed_domain: record.proposedDomain,
    proposed_document_type: record.proposedDocumentType,
    relevance_status: record.relevanceStatus,
    relevance_reason: record.relevanceReason,
    detected_document_date: record.detectedDocumentDate,
    duplicate_of_source_document_id: record.duplicateOfSourceDocumentId,
    version_of_source_document_id: record.versionOfSourceDocumentId,
    model_confidence: record.modelConfidence,
    validated_status: record.validatedStatus,
    start_page: record.startPage,
    end_page: record.endPage,
    created_at: record.createdAt,
  };
}

export function domainResolutionRow(record: DomainResolutionRecord): Record<string, unknown> {
  return {
    id: record.id,
    intake_run_id: record.intakeRunId,
    resolution_status: record.resolutionStatus,
    resolved_domain: record.resolvedDomain,
    candidate_domains: record.candidateDomains,
    validation_status: record.validationStatus,
    domain_pack: record.domainPack,
    created_at: record.createdAt,
  };
}

export function completenessFindingRow(record: CompletenessFindingRecord): Record<string, unknown> {
  return {
    id: record.id,
    intake_run_id: record.intakeRunId,
    domain: record.domain,
    document_type: record.documentType,
    finding_type: record.findingType,
    completeness_status: record.completenessStatus,
    severity: record.severity,
    source_rule_id: record.sourceRuleId,
    source_pack_id: record.sourcePackId,
    source_pack_version: record.sourcePackVersion,
    user_message: record.userMessage,
    processing_allowed: record.processingAllowed,
    created_at: record.createdAt,
  };
}

export function auditEventRow(record: AuditEventRecord): Record<string, unknown> {
  return {
    id: record.id,
    owner_user_id: record.ownerUserId,
    case_id: record.caseId,
    source_document_id: record.sourceDocumentId,
    intake_run_id: record.intakeRunId,
    event_type: record.eventType,
    actor_user_id: record.actorUserId,
    actor_type: record.actorType,
    correlation_id: record.correlationId,
    safe_metadata: record.safeMetadata,
    created_at: record.createdAt,
  };
}

export function persistIntakeResultPayload(input: PersistIntakeResultInput): Record<string, unknown> {
  return {
    document_results: input.documentResults.map(intakeDocumentResultRow),
    domain_resolution: domainResolutionRow(input.domainResolution),
    completeness_findings: input.completenessFindings.map(completenessFindingRow),
    run_completion: {
      id: input.runCompletion.id,
      status: input.runCompletion.status,
      completed_at: input.runCompletion.completedAt,
      error_code: input.runCompletion.errorCode,
      error_category: input.runCompletion.errorCategory,
    },
    audit_event: auditEventRow(input.auditEvent),
  };
}

export function vaultTransactionPayload(operations: readonly VaultTransactionOp[]): Record<string, unknown> {
  return { operations };
}
