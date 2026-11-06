import {
  createHiveError,
  type GetHiveReportsResponse,
  type HiveError,
  type HiveReport,
  isActiveReportRunStatus,
  isValidUuid,
  normalizeGetHiveReportsResponse,
  normalizeHiveReport,
  normalizeReportRun,
  type ReportRun,
  validateGenerateHiveReportInput,
} from "@hiveforyou/contracts";

import { materializeReportRunProgressEstimate } from "@/server/pipeline/progress-estimate-persistence";
import { loadPipelineThroughput } from "@/server/pipeline/pipeline-throughput";
import type { DocumentPageRpcClient } from "@/server/source-documents/document-pages-persistence";

/** Owner report operations (authenticated client). Both audiences are freely accessible. */
function ownerError(
  errorCode: HiveError["errorCode"],
  category: HiveError["category"],
  safeMessage: string,
  diagnosticReason: string,
  correlationId: string,
): HiveError {
  return createHiveError({ errorCode, category, stage: "ANALYZE", retryable: false, safeMessage, correlationId, diagnosticReason });
}

function mapRpcError(error: unknown, correlationId: string): HiveError {
  const message =
    typeof (error as { message?: unknown })?.message === "string" ? (error as { message: string }).message.toLowerCase() : "";
  if (message.includes("hive_not_found")) {
    return ownerError("NOT_FOUND", "SECURITY", "We could not find that Hive.", "not_found", correlationId);
  }
  if (message.includes("auth_required")) {
    return ownerError("UNAUTHENTICATED", "SECURITY", "Sign in to continue.", "no_session", correlationId);
  }
  if (message.includes("report_not_found")) {
    return ownerError("NOT_FOUND", "VALIDATION", "We could not find that report.", "report_not_found", correlationId);
  }
  if (message.includes("study_revision_not_found")) {
    return ownerError("NOT_FOUND", "VALIDATION", "Analyze your documents first.", "study_revision_not_found", correlationId);
  }
  if (message.includes("idempotency_conflict")) {
    return ownerError("IDEMPOTENCY_CONFLICT", "PERSISTENCE", "This request was already used.", "idempotency_conflict", correlationId);
  }
  return createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "Could not reach your reports right now. Please try again.",
    correlationId,
    diagnosticReason: "persistence_failed",
    cause: error,
  });
}

function requireUuid(value: string, correlationId: string, what: string): string {
  const normalized = value.trim().toLowerCase();
  if (!isValidUuid(normalized)) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", `Invalid ${what} identifier.`, "invalid_payload_shape", correlationId);
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
    safeMessage: "Could not load your reports. Please try again.",
    correlationId,
    diagnosticReason: "unexpected_edge_shape",
  });
}

export async function getHiveReports(
  client: DocumentPageRpcClient,
  input: { readonly hiveId: string; readonly correlationId: string },
): Promise<GetHiveReportsResponse> {
  const hiveId = requireUuid(input.hiveId, input.correlationId, "Hive");
  const { data, error } = await client.rpc("get_hive_reports", { p_hive_id: hiveId });
  if (error) throw mapRpcError(error, input.correlationId);
  const normalized = normalizeGetHiveReportsResponse(parsePayload(data));
  if (!normalized) throw unexpectedShape(input.correlationId);
  const active = normalized.reportRuns.some((run) => isActiveReportRunStatus(run.status));
  if (!active) return normalized;
  const nowMs = Date.now();
  const writeThroughput = await loadPipelineThroughput(client, "write", nowMs);
  const reportRuns = await Promise.all(
    normalized.reportRuns.map(async (run) =>
      isActiveReportRunStatus(run.status)
        ? {
            ...run,
            progressEstimate: await materializeReportRunProgressEstimate(client, {
              reportRun: run,
              nowMs,
              writeThroughput,
            }),
          }
        : run,
    ),
  );
  return { ...normalized, reportRuns };
}

export async function getHiveReport(
  client: DocumentPageRpcClient,
  input: { readonly hiveId: string; readonly reportId: string; readonly correlationId: string },
): Promise<{ report: HiveReport }> {
  const hiveId = requireUuid(input.hiveId, input.correlationId, "Hive");
  const reportId = requireUuid(input.reportId, input.correlationId, "report");
  const { data, error } = await client.rpc("get_hive_report", { p_hive_id: hiveId, p_report_id: reportId });
  if (error) throw mapRpcError(error, input.correlationId);
  const report = normalizeHiveReport(parsePayload(data)?.report);
  if (!report) throw unexpectedShape(input.correlationId);
  return { report };
}

/** "Generate again": a new Writer run over the accepted revision. `process` is true only when newly queued. */
export async function generateHiveReport(
  client: DocumentPageRpcClient,
  input: { readonly hiveId: string; readonly rawBody: unknown; readonly correlationId: string },
): Promise<{ response: { reportRun: ReportRun; created: boolean }; process: boolean }> {
  const { correlationId } = input;
  const hiveId = requireUuid(input.hiveId, correlationId, "Hive");
  const validated = validateGenerateHiveReportInput(input.rawBody);
  if (!validated.ok) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", validated.message, validated.diagnosticReason, correlationId);
  }
  const { data, error } = await client.rpc("generate_hive_report", {
    p_hive_id: hiveId,
    p_study_revision_id: validated.value.studyRevisionId,
    p_audience: validated.value.audience,
    p_request_id: validated.value.clientRequestId,
    p_correlation_id: correlationId,
  });
  if (error) throw mapRpcError(error, correlationId);
  const payload = parsePayload(data);
  const reportRun = normalizeReportRun(payload?.reportRun);
  if (!reportRun) throw unexpectedShape(correlationId);
  const created = payload?.created === true;
  return { response: { reportRun, created }, process: created && reportRun.status === "QUEUED" };
}
