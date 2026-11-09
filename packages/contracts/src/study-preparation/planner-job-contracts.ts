import type { PlannerCompletion, PlannerCompletionRequest, PlannerCompletionTask } from "./planner-wire-contracts";
import type { ContractValidation } from "../source-documents/source-document-contracts";
import { normalizePlannerCompletion, PLANNER_CONTRACT_VERSION } from "./planner-wire-contracts";

export const PLANNER_JOB_CONTRACT_VERSION = "planner-job@1";

export const PLANNER_JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type PlannerJobStatus = (typeof PLANNER_JOB_STATUSES)[number];

export type PlannerJobSubmitResponse = {
  contract_version: typeof PLANNER_JOB_CONTRACT_VERSION;
  job_id: string;
};

export type PlannerJobPollResponse = {
  contract_version: typeof PLANNER_JOB_CONTRACT_VERSION;
  job_id: string;
  status: PlannerJobStatus;
  task?: PlannerCompletionTask;
  result?: Record<string, unknown>;
  error?: { error_code: string; retryable: boolean; diagnostic_reason?: string };
  latency_ms?: number;
};

export function normalizePlannerJobSubmit(raw: unknown): ContractValidation<{ jobId: string }> {
  const invalid = (diagnosticReason: string) => ({
    ok: false as const,
    message: "The planning service returned an unexpected response.",
    diagnosticReason,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("planner_job_submit_shape");
  const record = raw as Record<string, unknown>;
  if (record.contract_version !== PLANNER_JOB_CONTRACT_VERSION) return invalid("planner_job_contract_version");
  const jobId = typeof record.job_id === "string" ? record.job_id.trim() : "";
  if (!jobId) return invalid("planner_job_id_missing");
  return { ok: true, value: { jobId } };
}

export function normalizePlannerJobPoll(
  raw: unknown,
  expectedTask: PlannerCompletionTask,
): ContractValidation<{
  jobId: string;
  status: PlannerJobStatus;
  completion: PlannerCompletion | null;
  jobError: { errorCode: string; retryable: boolean; diagnosticReason: string | null } | null;
  latencyMs: number | null;
}> {
  const invalid = (diagnosticReason: string) => ({
    ok: false as const,
    message: "The planning service returned an unexpected response.",
    diagnosticReason,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("planner_job_poll_shape");
  const record = raw as Record<string, unknown>;
  if (record.contract_version !== PLANNER_JOB_CONTRACT_VERSION) return invalid("planner_job_contract_version");
  const jobId = typeof record.job_id === "string" ? record.job_id.trim() : "";
  const status = record.status;
  if (!jobId || typeof status !== "string" || !PLANNER_JOB_STATUSES.includes(status as PlannerJobStatus)) {
    return invalid("planner_job_poll_status");
  }
  const jobStatus = status as PlannerJobStatus;
  const latencyMs =
    typeof record.latency_ms === "number" && Number.isInteger(record.latency_ms) && record.latency_ms >= 0
      ? record.latency_ms
      : null;
  if (status === "succeeded") {
    const result = record.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) return invalid("planner_job_result_shape");
    const wrapped = { contract_version: PLANNER_CONTRACT_VERSION, ...(result as Record<string, unknown>) };
    const normalized = normalizePlannerCompletion(wrapped, expectedTask);
    if (!normalized.ok) return invalid(normalized.diagnosticReason);
    return {
      ok: true,
      value: { jobId, status: jobStatus, completion: normalized.value, jobError: null, latencyMs },
    };
  }
  if (status === "failed") {
    const err = record.error;
    if (!err || typeof err !== "object" || Array.isArray(err)) return invalid("planner_job_error_shape");
    const errorCode = typeof (err as { error_code?: unknown }).error_code === "string" ? (err as { error_code: string }).error_code : "";
    if (!errorCode) return invalid("planner_job_error_code");
    const retryable = (err as { retryable?: unknown }).retryable === true;
    const diagnosticReason =
      typeof (err as { diagnostic_reason?: unknown }).diagnostic_reason === "string"
        ? (err as { diagnostic_reason: string }).diagnostic_reason
        : null;
    return {
      ok: true,
      value: { jobId, status: jobStatus, completion: null, jobError: { errorCode, retryable, diagnosticReason }, latencyMs },
    };
  }
  return { ok: true, value: { jobId, status: jobStatus, completion: null, jobError: null, latencyMs } };
}

export type PlannerJobRequest = PlannerCompletionRequest;
