import {
  type AcknowledgeStudyCoverageResponse,
  createHiveError,
  type GetStudyPreparationResponse,
  type HiveError,
  isValidUuid,
  normalizeGetStudyPreparationResponse,
  normalizeProcessingRun,
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

/**
 * Starts (or replays) one Analyze run. `process` is true only for a newly queued run; the caller
 * then runs the workflow server-side. Documents not yet verified are queued for reading by the RPC.
 */
export async function startStudyPreparation(
  userClient: StudyPreparationRpcClient,
  input: { readonly hiveId: string; readonly rawBody: unknown; readonly correlationId: string },
): Promise<{ response: StartStudyPreparationResponse; process: boolean }> {
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
  const processingRun = normalizeProcessingRun(payload?.processingRun);
  if (!processingRun) throw unexpectedShape(correlationId);
  const created = payload?.created === true;
  return {
    response: { processingRun, created },
    process: created && (processingRun.status === "QUEUED" || processingRun.status === "READING_DOCUMENTS"),
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
