export const ALLOWLISTED_LOG_FIELDS = [
  "eventName",
  "severity",
  "timestamp",
  "component",
  "operation",
  "stage",
  "correlationId",
  "status",
  "errorCode",
  "retryable",
  "durationMs",
  "diagnosticReason",
  "diagnosticField",
  "exceptionType",
  "attempt",
  "hiveId",
  "processingRunId",
  "sourceDocumentId",
  "task",
  "audience",
  "inputCount",
  "outputCount",
  "totalCount",
  "componentCount",
  "sectionCount",
  "scenarioCount",
  "rejectedUnits",
  "rejectionSummary",
  "rounds",
  "errorDetail",
  "pageRange",
  "httpStatus",
  "callStartedAt",
  "abortedByOurDeadline",
  "rangeAttempt",
] as const;

export type AllowlistedLogField = (typeof ALLOWLISTED_LOG_FIELDS)[number];

export type StructuredLogRecord = Partial<
  Record<AllowlistedLogField, string | number | boolean>
> & {
  eventName: string;
  severity: "DEBUG" | "INFO" | "WARN" | "ERROR";
  timestamp: string;
  component: string;
  operation: string;
  correlationId: string;
};

const ALLOWED_DIAGNOSTIC_REASONS = new Set([
  "correlation_regenerated",
  "unexpected_exception",
  "no_session",
  "session_mismatch",
  "session_expired",
  "invalid_json",
  "invalid_payload_shape",
  "unexpected_field",
  "invalid_client_request_id",
  "invalid_name",
  "invalid_description",
  "invalid_hive_id",
  "invalid_request",
  "idempotency_conflict",
  "unique_violation",
  "not_found",
  "access_denied",
  "timeout",
  "edge_invoke_error",
  "empty_edge_payload",
  "unexpected_edge_shape",
  "persistence_failed",
  "unsupported_operation",
  "sign_in_accepted",
  "sign_up_accepted",
  "sign_up_check_email",
  "sign_out_accepted",
  "session_exchanged",
  "recovery_session",
  "otp_verified",
  "reset_email_accepted",
  "confirmation_resend_accepted",
  "password_updated",
  "recovery_exit_accepted",
  "invalid_credentials",
  "email_not_confirmed",
  "weak_password",
  "same_password",
  "rate_limited",
  "fetch_failed",
  "link_expired",
  "link_reused",
  "link_invalid",
  "missing_code",
  "email_invalid",
  "email_or_password_missing",
  "password_policy",
  "password_mismatch",
  "password_missing",
  "recovery_cookie_missing",
  "session_missing",
  "unclassified",
  "invalid_document_type",
  "invalid_document_size",
  "invalid_file_name",
  "invalid_intent",
  "invalid_source_document_id",
  "quota_exceeded",
  "source_type_mismatch",
  "source_size_mismatch",
  "source_object_missing",
  "malware_detected",
  "scan_unavailable",
  "scan_rate_limited",
  "storage_failed",
  "upload_failed",
  "vault_admin_url_missing",
  "vault_admin_secret_missing",
  "invalid_sha256",
  "source_path_forbidden",
  "reader_unconfigured",
  "reader_unavailable",
  "reader_timeout",
  "reader_auth_failed",
  "reader_invalid_response",
  "reader_litellm_ocr_disabled",
  "reader_extraction_failed",
  "document_unreadable",
  "coverage_incomplete",
  "page_hive_mismatch",
  "page_source_sha256_mismatch",
  "page_read_fingerprint_invalid",
  "page_numbering_invalid",
  "payload_too_large",
  "page_hash_conflict",
  "page_set_digest_mismatch",
  "page_generation_incomplete",
  "page_invalid",
  "document_not_found",
  "page_persistence_failed",
  "persistence_corrupt_jsonb",
  "artifact_hash_mismatch",
  "db_transient",
  "planner_unconfigured",
  "planner_unavailable",
  "planner_timeout",
  "planner_gateway_timeout",
  "invocation_deadline_abort",
  "client_deadline",
  "planner_auth_failed",
  "planner_invalid_response",
  "planner_invalid_request",
  "planner_network_error",
  "planner_response_unreadable",
  "planner_error_body_unparsed",
  "planner_response_shape",
  "planner_contract_version",
  "planner_task_mismatch",
  "planner_model_alias",
  "planner_usage",
  "planner_metadata",
  "planner_content_missing",
  "litellm_http_error",
  "litellm_network_error",
  "litellm_timeout",
  "model_content_missing",
  "model_output_truncated",
  "model_output_not_json",
  "model_response_contract",
  "model_alias_unconfigured",
  "model_output_invalid",
  "model_context_exceeded",
  "source_changed",
  "intent_missing",
  "document_read_active",
  "no_eligible_documents",
  "coverage_unacknowledged",
  "invalid_coverage_digest",
  "stage_transition_rejected",
  "preview_readback_mismatch",
  "invalid_shape",
  "invalid_text",
  "invalid_enum",
  "invalid_id",
  "missing_items",
  "duplicate_id",
  "dependency_cycle",
  "dependency_unknown",
  "evidence_ref_invalid",
  "evidence_ref_missing",
  "intent_ref_invalid",
  "intent_not_covered",
  "domain_mismatch",
  "domain_uncertainty_dropped",
  "objective_unknown",
  "question_unknown",
  "question_not_covered",
  "question_restates_intent",
  "answer_logic_missing",
  "quotation_mismatch",
  "audience_basis_invalid",
  "audience_role_invalid",
  "audience_unsupported",
  "audience_confidence_invalid",
  "study_output_shape",
  "study_output_schema",
  "study_run_mismatch",
  "study_question_unknown",
  "study_question_duplicate",
  "study_question_missing",
  "study_fact_index_invalid",
  "study_evidence_invalid",
  "study_evidence_unauthorized",
  "study_criterion_unsupported",
  "study_manifest_mismatch",
  "study_preview_outdated",
  "study_agent_budget_exhausted",
  "study_document_duplicate",
  "study_finding_cross_document_evidence",
  "study_page_not_read",
  "study_coverage_claim_misleading",
  "study_primary_document_unread_pages",
  "study_primary_document_findings_missing",
  "study_finding_duplicate_id",
  "study_finding_number_ungrounded",
  "study_finding_ref_invalid",
  "study_documents_missing",
  "study_findings_missing",
  "study_finding_unusable",
  "study_documents_incomplete",
  "documents_not_read",
  "analysis_active",
  "study_not_accepted",
  "intent_missing",
  "unknown_tool",
  "invalid_arguments",
  "page_not_authorized",
  "page_not_read",
  "quote_not_on_page",
  "coverage_claim_misleading",
  "primary_document_unread_pages",
  "primary_document_findings_missing",
  "finding_cross_document_evidence",
  "finding_number_ungrounded",
  "unknown_question",
  "question_closed",
  "unknown_evidence",
  "unknown_finding",
  "unknown_fact",
  "fact_other_question",
  "input_not_numeric",
  "input_not_quoted",
  "formula_invalid",
  "formula_not_calculable",
  "criterion_evidence_missing",
  "conflict_evidence_insufficient",
  "status_inconsistent",
  "questions_unfinished",
  "study_finished",
  "result_too_large",
  "tool_call_conflict",
  "too_many_calls",
  "no_tool_call",
  "writer_agent_budget_exhausted",
  "writer_output_shape",
  "writer_output_schema",
  "writer_audience_mismatch",
  "writer_binding_invalid",
  "writer_claim_unknown",
  "writer_claim_missing",
  "writer_claim_kind",
  "writer_number_ungrounded",
  "writer_unverified_number",
  "writer_uncertainty_hidden",
  "writer_scenario_invalid",
  "writer_scenario_unsupported",
  "writer_formula_invalid",
  "view_component_unknown",
  "view_props_invalid",
  "study_revision_not_found",
  "report_not_found",
  "dispatch_unconfigured",
  "dispatch_failed",
  "worker_unauthorized",
  "reads_pending",
  "extract_adaptive_concurrency",
  "extract_attempt_record_failed",
  "extract_attempt_outcome_record_failed",
  "extract_stale_in_flight_repair_failed",
  "extract_pages_missing",
  "extract_range_empty_input",
]);

const ALLOWED_EXCEPTION_TYPES = new Set([
  "Error",
  "HiveError",
  "TypeError",
  "RangeError",
  "VaultAdminConfigError",
  "Unknown",
]);

const SENSITIVE_KEY_PATTERN =
  /password|token|quote|documenttext|prompt|authorization|secret|credential|ssn|phi|pii/i;

function sanitizeValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") {
    if (value.length > 500) {
      return "[redacted:long-string]";
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

export function buildStructuredLogRecord(
  input: Record<string, unknown>,
): StructuredLogRecord {
  const output: Record<string, string | number | boolean> = {};

  for (const key of ALLOWLISTED_LOG_FIELDS) {
    if (!(key in input)) {
      continue;
    }
    const raw = input[key];
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    if (key === "diagnosticReason" && typeof raw === "string") {
      if (!ALLOWED_DIAGNOSTIC_REASONS.has(raw)) {
        output[key] = "unexpected_exception";
      } else {
        output[key] = raw;
      }
      continue;
    }
    if (key === "exceptionType" && typeof raw === "string") {
      if (!ALLOWED_EXCEPTION_TYPES.has(raw)) {
        output[key] = "Error";
      } else {
        output[key] = raw;
      }
      continue;
    }
    if (key === "rejectionSummary" && typeof raw === "string") {
      if (/^[a-z][a-z0-9_]{0,63}:[0-9]{1,4}(?:,[a-z][a-z0-9_]{0,63}:[0-9]{1,4})*$/.test(raw) && raw.length <= 200) {
        output[key] = raw;
      }
      continue;
    }
    if (key === "errorDetail" && typeof raw === "string") {
      if (raw.length > 0 && raw.length <= 480 && !SENSITIVE_KEY_PATTERN.test(raw)) {
        output[key] = raw;
      }
      continue;
    }
    const sanitized = sanitizeValue(raw);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }

  if (
    typeof output.eventName !== "string" ||
    typeof output.severity !== "string" ||
    typeof output.timestamp !== "string" ||
    typeof output.component !== "string" ||
    typeof output.operation !== "string" ||
    typeof output.correlationId !== "string"
  ) {
    throw new Error("Structured log record missing required fields");
  }

  return output as StructuredLogRecord;
}

export function emitStructuredEvent(input: Record<string, unknown>): void {
  const record = buildStructuredLogRecord(input);
  const line = JSON.stringify(record);
  const lowered = line.toLowerCase();

  for (const forbidden of ["documenttext", "exactquote", "password", "token"]) {
    if (lowered.includes(forbidden)) {
      throw new Error("Refusing to emit log line containing sensitive marker");
    }
  }

  console.log(line);
}
