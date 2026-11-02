import {
  buildFailureDiagnostic,
  classifyFailure,
  type AudienceConfiguration,
  audienceRoleLabel,
  buildReport,
  createHiveError,
  type DomainProposal,
  type HiveError,
  normalizeReportRun,
  type ReportAudience,
  type ReportRun,
  type ReportRunStatus,
  type SourceSnapshot,
  type StageMetric,
  type StudyClaim,
  studyClaimCatalog,
  type VerifiedStudy,
} from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";
import type { DocumentPageRpcClient } from "@/server/source-documents/document-pages-persistence";
import { callPlanner, type PlannerCallResult, type PlannerDeps } from "@/server/study-preparation/planner-client";
import { loadPromptCatalog, type PromptCatalog, sha256Digest } from "@/server/study-preparation/prompt-catalog";
import { canonicalJson } from "@/server/study-preparation/study-prompt-builder";

/**
 * One Writer run (D-041): one model call for one audience over the accepted Study revision, then
 * trusted validation, deterministic scenario arithmetic and A2UI binding before the report is saved.
 * Failures retry this Writer run only (three attempts); the accepted Study is never touched.
 */

export type ReportGenerationDeps = {
  readonly client: DocumentPageRpcClient;
  readonly planner: PlannerDeps;
  readonly loadCatalog?: () => PromptCatalog;
  readonly now?: () => Date;
};

type GenerationInputs = {
  reportRun: ReportRun;
  verified: VerifiedStudy;
  audienceConfiguration: AudienceConfiguration;
  coverageComplete: boolean;
  domainProposal: DomainProposal | null;
  sourceSnapshot: SourceSnapshot | null;
  intents: { id: string; intentText: string }[];
};

const MODEL_OUTPUT_MESSAGE = "The report draft didn't pass our checks. We'll try again.";
const STOPPED_MESSAGE = "The report stopped before it finished. You can generate it again.";

function parsePayload(data: unknown): Record<string, unknown> | null {
  const payload = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

async function rpc(client: DocumentPageRpcClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message ?? `${fn} failed`);
  return parsePayload(data);
}

function isHiveError(value: unknown): value is HiveError {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { errorCode?: unknown }).errorCode === "string" &&
    typeof (value as { retryable?: unknown }).retryable === "boolean"
  );
}

function reportError(
  input: Pick<HiveError, "errorCode" | "retryable" | "safeMessage" | "correlationId" | "diagnosticReason" | "diagnosticField"> & {
    category?: HiveError["category"];
  },
): HiveError {
  return createHiveError({ category: "MODEL", stage: "ANALYZE", ...input });
}

function log(run: ReportRun, status: ReportRunStatus, startedAt: number, error?: HiveError, failureStage = "WRITING"): void {
  const reason = error?.diagnosticReason ?? (error ? "unexpected_exception" : undefined);
  const classified = error && reason ? classifyFailure({ stage: failureStage, diagnosticReason: reason, task: "writer" }) : null;
  emitStructuredEvent({
    eventName: `report.${status.toLowerCase()}`,
    severity: status === "FAILED" ? "ERROR" : "INFO",
    timestamp: new Date().toISOString(),
    component: classified?.component ?? "reports",
    operation: classified?.operation ?? `write_${run.audience.toLowerCase()}`,
    stage: "ANALYZE",
    correlationId: run.correlationId,
    hiveId: run.hiveId,
    processingRunId: run.id,
    attempt: run.attemptCount,
    status,
    durationMs: Date.now() - startedAt,
    task: "writer",
    ...(error
      ? {
          errorCode: error.errorCode,
          retryable: error.retryable,
          diagnosticReason: reason,
          ...(typeof error.diagnosticField === "string" ? { diagnosticField: error.diagnosticField } : {}),
        }
      : {}),
  });
}

function reportDiagnostic(error: HiveError, attempt: number, stage = "WRITING") {
  const reason = error.diagnosticReason ?? "unexpected_exception";
  const classified = classifyFailure({ stage, diagnosticReason: reason, task: "writer" });
  return buildFailureDiagnostic({
    ...classified,
    stage,
    errorCode: error.errorCode,
    diagnosticReason: reason,
    diagnosticField: error.diagnosticField ?? null,
    retryable: error.retryable,
    attempt,
  });
}

async function loadGenerationInputs(client: DocumentPageRpcClient, reportRunId: string): Promise<GenerationInputs> {
  const payload = await rpc(client, "get_report_generation_inputs", { p_report_run_id: reportRunId });
  const reportRun = normalizeReportRun(payload?.reportRun);
  const revision = payload?.studyRevision as Record<string, unknown> | undefined;
  if (!reportRun || !revision || !revision.investigation || !revision.verification || !revision.audienceConfiguration) {
    throw new Error("unexpected_inputs_shape");
  }
  return {
    reportRun,
    verified: { investigation: revision.investigation, verification: revision.verification } as VerifiedStudy,
    audienceConfiguration: revision.audienceConfiguration as AudienceConfiguration,
    coverageComplete: revision.coverageComplete === true,
    domainProposal: (payload?.domainProposal ?? null) as DomainProposal | null,
    sourceSnapshot: (payload?.sourceSnapshot ?? null) as SourceSnapshot | null,
    intents: Array.isArray(payload?.intents) ? (payload.intents as { id: string; intentText: string }[]) : [],
  };
}

function fileNamesOf(snapshot: SourceSnapshot | null): Map<string, string> {
  return new Map((snapshot?.documents ?? []).map((document) => [document.sourceDocumentId.toLowerCase(), document.fileName]));
}

/** The Writer's user message (prompt `## User message shape`): validated claims only, no page text. */
export function buildWriterPayload(
  audience: ReportAudience,
  inputs: Omit<GenerationInputs, "reportRun">,
  claims: readonly StudyClaim[],
): Record<string, unknown> {
  const config = inputs.audienceConfiguration;
  const profile = audience === "CUSTOMER" ? config.customer : config.pro;
  const fileNames = fileNamesOf(inputs.sourceSnapshot);
  const page = (ref: { sourceDocumentId: string; pageNumber: number }) =>
    `${fileNames.get(ref.sourceDocumentId.toLowerCase()) ?? "Document"} p.${ref.pageNumber}`;
  return {
    task: "writer",
    audience,
    audienceProfile: {
      role: audienceRoleLabel(audience, config),
      status: profile.status,
      tone: profile.tone,
      detailLevel: profile.detailLevel,
      guidance: audience === "CUSTOMER" ? config.writerGuidance.customer : config.writerGuidance.pro,
    },
    requests: inputs.intents.map((intent) => ({ intentRequestId: intent.id, text: intent.intentText })),
    domain: {
      label: inputs.domainProposal?.primary?.label ?? "Unknown",
      uncertain: inputs.domainProposal ? inputs.domainProposal.ambiguous || inputs.domainProposal.unknownDomain : true,
    },
    coverage: {
      complete: inputs.coverageComplete,
      notes: (inputs.sourceSnapshot?.excluded ?? []).map((document) => `${document.fileName} was not read (${document.reason}).`),
    },
    claims: claims.map((claim) => ({
      id: claim.id,
      kind: claim.kind,
      text: claim.text,
      ...(claim.quotes.length > 0 ? { quotes: claim.quotes } : {}),
      ...(claim.refs.length > 0 ? { pages: claim.refs.map(page) } : {}),
      ...(claim.answerStatus ? { answerStatus: claim.answerStatus } : {}),
      ...(claim.numericStatus ? { numericStatus: claim.numericStatus, computedValue: claim.computedValue ?? null } : {}),
    })),
  };
}

async function transitionReport(
  client: DocumentPageRpcClient,
  reportRunId: string,
  from: ReportRunStatus,
  to: "VALIDATING" | "SAVING" | "FAILED",
  details: Record<string, unknown> = {},
) {
  const payload = await rpc(client, "transition_report_run", {
    p_report_run_id: reportRunId,
    p_from_status: from,
    p_to_status: to,
    p_details: details,
  });
  return { applied: payload?.applied === true, retrying: payload?.retrying === true, reportRun: normalizeReportRun(payload?.reportRun) };
}

/** Runs one claimed Writer attempt. Returns the run's status afterwards, or null if not claimed. */
export async function processReportRun(deps: ReportGenerationDeps, reportRunId: string): Promise<ReportRunStatus | null> {
  const claim = await rpc(deps.client, "claim_report_run", { p_report_run_id: reportRunId });
  const claimed = normalizeReportRun(claim?.reportRun);
  if (claim?.claimed !== true || !claimed) return claimed?.status ?? null;

  const startedAt = Date.now();
  const now = deps.now ?? (() => new Date());
  const { correlationId } = claimed;
  let current: ReportRunStatus = "WRITING";
  let metric: StageMetric | null = null;
  log(claimed, current, startedAt);

  try {
    const inputs = await loadGenerationInputs(deps.client, reportRunId);
    const audience = claimed.audience;
    const claims = studyClaimCatalog(inputs.verified);
    const catalog = (deps.loadCatalog ?? loadPromptCatalog)();
    const baseMetric: StageMetric = {
      stage: "WRITING",
      attempt: claimed.attemptCount,
      promptId: catalog.writer.id,
      promptDigest: catalog.writer.digest,
      modelAliasRequested: null,
      startedAt: now().toISOString(),
    };
    let completion: PlannerCallResult;
    try {
      completion = await callPlanner(deps.planner, {
        prompt: catalog.writer,
        userPayload: buildWriterPayload(audience, inputs, claims),
        correlationId,
        processingRunId: reportRunId,
      });
    } catch (error) {
      const hiveError = isHiveError(error)
        ? error
        : reportError({
            errorCode: "MODEL_UNAVAILABLE",
            category: "DEPENDENCY",
            retryable: true,
            safeMessage: "The writing service is temporarily unavailable. We'll try again.",
            correlationId,
            diagnosticReason: "planner_unavailable",
          });
      metric = { ...baseMetric, outcome: "FAILED", completedAt: now().toISOString(), errorCode: hiveError.errorCode, retryable: hiveError.retryable };
      throw hiveError;
    }
    metric = {
      ...baseMetric,
      modelAliasRequested: completion.modelAlias,
      resolvedModel: completion.resolvedModel,
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
      totalTokens: completion.usage.totalTokens,
      latencyMs: completion.latencyMs,
      plannerLatencyMs: completion.roundTripMs,
      finishReason: completion.finishReason,
      completedAt: now().toISOString(),
    };

    const validating = await transitionReport(deps.client, reportRunId, "WRITING", "VALIDATING");
    if (!validating.applied) return validating.reportRun?.status ?? null;
    current = "VALIDATING";

    const built = buildReport(completion.contentJson, { audience, claims, fileNames: fileNamesOf(inputs.sourceSnapshot) });
    if (!built.ok) {
      metric = { ...metric, outcome: "FAILED", errorCode: "MODEL_OUTPUT_INVALID", retryable: true };
      throw reportError({
        errorCode: "MODEL_OUTPUT_INVALID",
        retryable: true,
        safeMessage: MODEL_OUTPUT_MESSAGE,
        correlationId,
        diagnosticReason: built.diagnosticReason,
        ...(built.diagnosticField ? { diagnosticField: built.diagnosticField } : {}),
      });
    }
    metric = { ...metric, outcome: "SUCCEEDED" };

    const saving = await transitionReport(deps.client, reportRunId, "VALIDATING", "SAVING", { stage_metric: metric });
    if (!saving.applied) return saving.reportRun?.status ?? null;
    current = "SAVING";

    const saved = await rpc(deps.client, "save_report", {
      p_report_run_id: reportRunId,
      p_report: {
        writer_output: built.value.writerOutput,
        scenario_analysis: built.value.scenarioAnalysis,
        view: built.value.view,
        writer_prompt_digest: sha256Digest(canonicalJson({ prompt: catalog.writer.digest, schema: catalog.writer.schemaDigest })),
        model_alias: completion.modelAlias,
        resolved_model: completion.resolvedModel,
      },
    });
    const done = normalizeReportRun(saved?.reportRun);
    if (done) log(done, done.status, startedAt);
    return done?.status ?? "SUCCEEDED";
  } catch (error) {
    const hiveError = isHiveError(error)
      ? error
      : reportError({
          errorCode: "INTERNAL_ERROR",
          category: "INTERNAL",
          retryable: true,
          safeMessage: STOPPED_MESSAGE,
          correlationId,
          diagnosticReason: "unexpected_exception",
        });
    try {
      const diagnostic = reportDiagnostic(hiveError, claimed.attemptCount, metric?.stage ?? "WRITING");
      const failed = await transitionReport(deps.client, reportRunId, current, "FAILED", {
        error_code: hiveError.errorCode,
        error_message_safe: hiveError.safeMessage,
        retryable: hiveError.retryable,
        ...(metric && metric.outcome === "FAILED" ? { stage_metric: metric } : {}),
        ...(diagnostic ? { failure_diagnostic: diagnostic } : {}),
      });
      if (failed.reportRun) log(failed.reportRun, failed.reportRun.status, startedAt, hiveError);
      return failed.reportRun?.status ?? null;
    } catch {
      // The lease lapses until it expires or another invocation claims the run.
      return null;
    }
  }
}

/** Never throws, so it is safe inside `after()`. */
export async function processReportRunSafely(deps: ReportGenerationDeps, reportRunId: string): Promise<void> {
  await processReportRun(deps, reportRunId).catch(() => null);
}
