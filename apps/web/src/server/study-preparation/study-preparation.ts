import {
  type AcknowledgeStudyCoverageResponse,
  createHiveError,
  type GetStudyPreparationResponse,
  type HiveError,
  isValidUuid,
  normalizeGetStudyPreparationResponse,
  normalizeProcessingRun,
  normalizeStartStudyPreparationResponse,
  type StartStudyPreparationResponse,
  validateAcknowledgeStudyCoverageInput,
  validateStartStudyPreparationInput,
} from "@hiveforyou/contracts";

import type { DocumentPageRpcClient } from "@/server/source-documents/document-pages-persistence";

/**
 * Owner operations for Analyze (authenticated client). The stages themselves run server-side in
 * `server/workflow/analysis-workflow.ts`.
 */
export type StudyPreparationRpcClient = DocumentPageRpcClient;

function rpcMessage(error: unknown): string {
  return typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message.toLowerCase()
    : "";
}

function ownerError(
  errorCode: HiveError["errorCode"],
  category: HiveError["category"],
  safeMessage: string,
  diagnosticReason: string,
  correlationId: string,
  retryable = false,
): HiveError {
  return createHiveError({ errorCode, category, stage: "ANALYZE", retryable, safeMessage, correlationId, diagnosticReason });
}

function mapOwnerRpcError(error: unknown, correlationId: string): HiveError {
  const message = rpcMessage(error);
  if (message.includes("hive_not_found")) {
    return ownerError("NOT_FOUND", "SECURITY", "We could not find that Hive.", "not_found", correlationId);
  }
  if (message.includes("auth_required")) {
    return ownerError("UNAUTHENTICATED", "SECURITY", "Sign in to continue.", "no_session", correlationId);
  }
  if (message.includes("no_eligible_documents")) {
    return ownerError(
      "COVERAGE_INCOMPLETE",
      "DOCUMENT",
      "Upload a document before analyzing.",
      "no_eligible_documents",
      correlationId,
    );
  }
  if (message.includes("documents_not_read")) {
    return ownerError(
      "COVERAGE_INCOMPLETE",
      "DOCUMENT",
      "Read the documents with Analyze before rebuilding the study. Rebuild uses the pages already saved.",
      "documents_not_read",
      correlationId,
    );
  }
  if (message.includes("intent_missing")) {
    return ownerError(
      "INVALID_REQUEST",
      "VALIDATION",
      "Tell us what you want to understand from these documents before rebuilding the study.",
      "intent_missing",
      correlationId,
    );
  }
  if (message.includes("study_not_accepted")) {
    return ownerError(
      "INVALID_REQUEST",
      "VALIDATION",
      "Analyze first. Rebuild starts a new revision after a study has been accepted.",
      "study_not_accepted",
      correlationId,
    );
  }
  if (message.includes("analysis_active")) {
    return ownerError(
      "INVALID_REQUEST",
      "VALIDATION",
      "An analysis is already running. Wait for it to finish before rebuilding the study.",
      "analysis_active",
      correlationId,
    );
  }
  if (message.includes("coverage_unacknowledged")) {
    return ownerError(
      "COVERAGE_INCOMPLETE",
      "DOCUMENT",
      "Your document coverage changed. Review what's missing and confirm again.",
      "coverage_unacknowledged",
      correlationId,
    );
  }
  if (message.includes("idempotency_conflict")) {
    return ownerError("IDEMPOTENCY_CONFLICT", "PERSISTENCE", "This request was already used.", "idempotency_conflict", correlationId);
  }
  if (message.includes("processing_run_not_found")) {
    return ownerError("NOT_FOUND", "VALIDATION", "We could not find that analysis.", "processing_run_not_found", correlationId);
  }
  if (message.includes("processing_run_not_awaiting")) {
    return ownerError(
      "INVALID_REQUEST",
      "VALIDATION",
      "This analysis is no longer waiting for your review.",
      "processing_run_not_awaiting",
      correlationId,
    );
  }
  return createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "Could not reach your Hive right now. Please try again.",
    correlationId,
    diagnosticReason: "persistence_failed",
    cause: error,
  });
}

function requireHiveId(hiveId: string, correlationId: string): string {
  const normalized = hiveId.trim().toLowerCase();
  if (!isValidUuid(normalized)) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", "Invalid Hive identifier.", "invalid_hive_id", correlationId);
  }
  return normalized;
}

function parsePayload(data: unknown): Record<string, unknown> | null {
  const payload = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

function unexpectedShape(correlationId: string): HiveError {
  return createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "Could not load analysis progress. Please try again.",
    correlationId,
    diagnosticReason: "unexpected_edge_shape",
  });
}

function uuidElements(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => (typeof id === "string" ? id.trim().toLowerCase() : ""))
    .filter((id) => isValidUuid(id));
}

/**
 * Starts (or replays/resumes) Analyze.
 * - `process` is true only for a newly queued Study processing run.
 * - `queuedReportRunIds` contains any newly queued Writer runs when a compatible Study revision is reused
 *   and one or both audience reports are missing or failed.
 */
export async function startStudyPreparation(
  userClient: StudyPreparationRpcClient,
  input: { readonly hiveId: string; readonly rawBody: unknown; readonly correlationId: string },
): Promise<{ response: StartStudyPreparationResponse; process: boolean; queuedReportRunIds: string[] }> {
  const { correlationId } = input;
  const hiveId = requireHiveId(input.hiveId, correlationId);
  const validated = validateStartStudyPreparationInput(input.rawBody);
  if (!validated.ok) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", validated.message, validated.diagnosticReason, correlationId);
  }
  const { data, error } = await userClient.rpc("start_study_preparation", {
    p_hive_id: hiveId,
    p_request_id: validated.value.clientRequestId,
    p_correlation_id: correlationId,
    p_coverage_acknowledgement_digest: validated.value.coverageAcknowledgementDigest,
  });
  if (error) throw mapOwnerRpcError(error, correlationId);
  const payload = parsePayload(data);
  const response = normalizeStartStudyPreparationResponse(payload);
  if (!response) throw unexpectedShape(correlationId);
  const { processingRun, created } = response;
  const queuedReportRunIds = uuidElements(payload?.queuedReportRunIds);
  return {
    response,
    process: created && (processingRun.status === "QUEUED" || processingRun.status === "READING_DOCUMENTS"),
    queuedReportRunIds,
  };
}

/**
 * Starts an explicit Rebuild Study. A new request freezes the current sources and intent and
 * queues the V5 pipeline (re-extract only documents whose content changed, then re-run
 * CANONICALIZING from cached extractions — the cheap path). The same client request replays that
 * run. An in-flight rebuild is not started twice. This path never queues document reads or Writer runs.
 */
export async function rebuildStudy(
  userClient: StudyPreparationRpcClient,
  input: { readonly hiveId: string; readonly rawBody: unknown; readonly correlationId: string },
): Promise<{ response: StartStudyPreparationResponse; process: boolean }> {
  const { correlationId } = input;
  const hiveId = requireHiveId(input.hiveId, correlationId);
  const validated = validateStartStudyPreparationInput(input.rawBody);
  if (!validated.ok) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", validated.message, validated.diagnosticReason, correlationId);
  }
  const { data, error } = await userClient.rpc("rebuild_study", {
    p_hive_id: hiveId,
    p_request_id: validated.value.clientRequestId,
    p_correlation_id: correlationId,
    p_coverage_acknowledgement_digest: validated.value.coverageAcknowledgementDigest,
  });
  if (error) throw mapOwnerRpcError(error, correlationId);
  const payload = parsePayload(data);
  const response = normalizeStartStudyPreparationResponse(payload);
  if (!response) throw unexpectedShape(correlationId);
  if (response.processingRun.preparationMode !== "REBUILD") {
    throw ownerError(
      "PERSISTENCE_FAILED",
      "PERSISTENCE",
      "Could not rebuild the study. Please try again.",
      "unexpected_edge_shape",
      correlationId,
      true,
    );
  }
  return {
    response: { ...response, reusedStudy: false, reportsReady: false, reportRuns: [] },
    process: response.created && response.processingRun.status === "QUEUED",
  };
}

/**
 * The owner continues a run that paused because reading found material gaps. `process` is true
 * when the run resumed; the caller then continues it server-side from its frozen snapshot.
 */
export async function acknowledgeStudyCoverage(
  userClient: StudyPreparationRpcClient,
  input: { readonly hiveId: string; readonly rawBody: unknown; readonly correlationId: string },
): Promise<{ response: AcknowledgeStudyCoverageResponse; process: boolean }> {
  const { correlationId } = input;
  const hiveId = requireHiveId(input.hiveId, correlationId);
  const validated = validateAcknowledgeStudyCoverageInput(input.rawBody);
  if (!validated.ok) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", validated.message, validated.diagnosticReason, correlationId);
  }
  const { data, error } = await userClient.rpc("acknowledge_study_coverage", {
    p_hive_id: hiveId,
    p_processing_run_id: validated.value.processingRunId,
    p_coverage_digest: validated.value.coverageDigest,
  });
  if (error) throw mapOwnerRpcError(error, correlationId);
  const payload = parsePayload(data);
  const processingRun = normalizeProcessingRun(payload?.processingRun);
  if (!processingRun) throw unexpectedShape(correlationId);
  const resumed = payload?.resumed === true;
  return { response: { processingRun, resumed }, process: resumed };
}

export async function getStudyPreparation(
  userClient: StudyPreparationRpcClient,
  input: { readonly hiveId: string; readonly correlationId: string; readonly includePreview: boolean },
): Promise<GetStudyPreparationResponse> {
  const hiveId = requireHiveId(input.hiveId, input.correlationId);
  const { data, error } = await userClient.rpc("get_study_preparation", {
    p_hive_id: hiveId,
    p_include_preview: input.includePreview,
  });
  if (error) throw mapOwnerRpcError(error, input.correlationId);
  const normalized = normalizeGetStudyPreparationResponse(parsePayload(data));
  if (!normalized) throw unexpectedShape(input.correlationId);
  return normalized;
}
