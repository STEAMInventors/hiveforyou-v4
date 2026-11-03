import {
  buildFailureDiagnostic,
  classifyFailure,
  type AudienceConfiguration,
  audienceRoleLabel,
  buildReport,
  createHiveError,
  type DomainProposal,
  estimateWriterAgentUsd,
  formatWriterAgentBudgetDiagnosticField,
  type HiveError,
  normalizeReportRun,
  type ReportAudience,
  type ReportRun,
  type ReportRunStatus,
  type SourceSnapshot,
  type StageMetric,
  type StudyAgentBudgetDimension,
  type StudyAgentMessage,
  type StudyAgentTurnRequest,
  type StudyClaim,
  studyClaimCatalog,
  type VerifiedStudy,
  WRITER_AGENT_BUDGET,
  WRITER_AGENT_TOOLS,
  WriterAgentLedger,
  type WriterReport,
} from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";
import type { DocumentPageRpcClient } from "@/server/source-documents/document-pages-persistence";
import { callStudyAgentTurn, type PlannerDeps } from "@/server/study-preparation/planner-client";
import { loadPromptCatalog, type PromptCatalog, sha256Digest } from "@/server/study-preparation/prompt-catalog";
import { canonicalJson } from "@/server/study-preparation/study-prompt-builder";

import type { Dispatch } from "./dispatch";

/**
 * One Writer run (D-041, D-045): a bounded native tool-calling loop (`WriterAgentLedger`) for one
 * audience over the accepted Study revision, with immediate block/scenario/A2UI validation, followed
 * by `buildReport()` (authoritative validation, deterministic scenario arithmetic and A2UI binding)
 * before the report is saved. Model/network failures retry this Writer run only (up to 3 attempts);
 * budget exhaustion fails closed without automatic retries; the accepted Study is never touched.
 */

export const REPORT_RETRY_BACKOFF_SECONDS = 30;

const NUDGE_MESSAGE =
  "No tool was called. Continue building the report using set_report_outline, record_section, record_scenario, record_view_component, and finish_report.";

export type ReportGenerationDeps = {
  readonly client: DocumentPageRpcClient;
  readonly planner: PlannerDeps;
  readonly dispatch?: Dispatch;
  readonly loadCatalog?: () => PromptCatalog;
  readonly now?: () => Date;
  readonly clock?: () => number;
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

export type WriterAgentTotals = {
  rounds: number;
  roundsAllowed: number;
  toolCalls: number;
  invalidCalls: number;
  sectionsRecorded: number;
  viewComponentsRecorded: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  roundTripMs: number;
  modelAlias: string | null;
  resolvedModel: string | null;
  finishReason: string | null;
};

export class WriterAgentFailure extends Error {
  constructor(
    readonly hiveError: HiveError,
    readonly totals: WriterAgentTotals,
  ) {
    super(hiveError.diagnosticReason ?? hiveError.errorCode);
  }
}

export type WriterAgentInput = {
  readonly planner: PlannerDeps;
  readonly reportRunId: string;
  readonly correlationId: string;
  readonly audience: ReportAudience;
  readonly prompt: { readonly id: string; readonly digest: string; readonly systemPrompt: string };
  readonly userPayload: Record<string, unknown>;
  readonly claims: readonly StudyClaim[];
  readonly fileNames: ReadonlyMap<string, string>;
  /** Epoch ms by which the last turn must have returned; validation and persistence follow. */
  readonly deadline: number;
  readonly clock?: () => number;
};

const MODEL_OUTPUT_MESSAGE = "The report draft didn't pass our checks. You can generate it again.";
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
    operationId?: string;
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
      ...(claim.criterion ? { criterion: claim.criterion } : {}),
      ...(claim.criterionSource ? { criterionSource: claim.criterionSource } : {}),
    })),
  };
}

/**
 * Bounded native tool-calling Writer loop (D-045). Executes the five Writer tools in the in-memory
 * `WriterAgentLedger` under hard budgets and returns the assembled `hive.writer-report/1` object.
 */
export async function runWriterAgent(
  input: WriterAgentInput,
): Promise<{ report: WriterReport; totals: WriterAgentTotals }> {
  const clock = input.clock ?? Date.now;
  const ledger = new WriterAgentLedger({
    reportRunId: input.reportRunId,
    audience: input.audience,
    claims: input.claims,
    fileNames: input.fileNames,
  });
  const messages: StudyAgentMessage[] = [{ role: "user", content: JSON.stringify(input.userPayload) }];
  const totals: WriterAgentTotals = {
    rounds: 0,
    roundsAllowed: WRITER_AGENT_BUDGET.maxRounds,
    toolCalls: 0,
    invalidCalls: 0,
    sectionsRecorded: 0,
    viewComponentsRecorded: 0,
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: 0,
    roundTripMs: 0,
    modelAlias: null,
    resolvedModel: null,
    finishReason: null,
  };
  const sync = () => {
    totals.toolCalls = ledger.toolCalls;
    totals.invalidCalls = ledger.invalidCalls;
    totals.sectionsRecorded = ledger.completedSectionCount;
    totals.viewComponentsRecorded = ledger.recordedViewComponentCount;
  };
  const exhausted = (limit: StudyAgentBudgetDimension): never => {
    sync();
    throw new WriterAgentFailure(
      reportError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        retryable: false,
        safeMessage: MODEL_OUTPUT_MESSAGE,
        correlationId: input.correlationId,
        operationId: input.reportRunId,
        diagnosticReason: "writer_agent_budget_exhausted",
        diagnosticField: formatWriterAgentBudgetDiagnosticField({
          dimension: limit,
          roundsUsed: totals.rounds,
          roundsAllowed: totals.roundsAllowed,
          toolCalls: totals.toolCalls,
          invalidCalls: totals.invalidCalls,
          sectionsRecorded: totals.sectionsRecorded,
          viewComponentsRecorded: totals.viewComponentsRecorded,
        }),
      }),
      totals,
    );
  };

  while (!ledger.finished) {
    if (totals.rounds >= WRITER_AGENT_BUDGET.maxRounds) exhausted("rounds");
    if (ledger.toolCalls >= WRITER_AGENT_BUDGET.maxToolCalls) exhausted("tool_calls");
    if (ledger.invalidCalls >= WRITER_AGENT_BUDGET.maxInvalidCalls) exhausted("invalid_calls");
    const outputTokens = Math.min(
      WRITER_AGENT_BUDGET.turnOutputTokens,
      WRITER_AGENT_BUDGET.maxOutputTokens - totals.completionTokens,
    );
    if (outputTokens < WRITER_AGENT_BUDGET.minTurnOutputTokens) exhausted("output_tokens");

    const turnMs = Math.min(WRITER_AGENT_BUDGET.maxTurnMs, input.deadline - clock());
    if (turnMs < WRITER_AGENT_BUDGET.minTurnMs) exhausted("wall_clock");
    const request: Omit<StudyAgentTurnRequest, "contract_version"> = {
      task: "writer",
      prompt_id: input.prompt.id,
      prompt_digest: input.prompt.digest,
      system_prompt: input.prompt.systemPrompt,
      messages,
      tools: WRITER_AGENT_TOOLS,
      max_output_tokens: outputTokens,
      timeout_seconds: Math.floor((turnMs - WRITER_AGENT_BUDGET.turnAbortMarginMs) / 1000),
    };
    const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
    if (bytes > WRITER_AGENT_BUDGET.maxRequestBytes) exhausted("request_bytes");
    const estimatedInput = totals.promptTokens + Math.ceil(bytes / 3);
    if (estimatedInput > WRITER_AGENT_BUDGET.maxInputTokens) exhausted("input_tokens");
    if (estimateWriterAgentUsd(estimatedInput, totals.completionTokens + outputTokens) > WRITER_AGENT_BUDGET.maxEstimatedUsd) {
      exhausted("estimated_cost");
    }

    let turn: Awaited<ReturnType<typeof callStudyAgentTurn>>;
    try {
      turn = await callStudyAgentTurn(input.planner, {
        request,
        abortMs: turnMs,
        correlationId: input.correlationId,
        processingRunId: input.reportRunId,
      });
    } catch (error) {
      sync();
      if (isHiveError(error)) throw new WriterAgentFailure(error, totals);
      throw new WriterAgentFailure(
        reportError({
          errorCode: "MODEL_UNAVAILABLE",
          category: "DEPENDENCY",
          retryable: true,
          safeMessage: "The writing service is temporarily unavailable. We'll try again.",
          correlationId: input.correlationId,
          operationId: input.reportRunId,
          diagnosticReason: "planner_unavailable",
        }),
        totals,
      );
    }
    totals.rounds += 1;
    totals.promptTokens += turn.usage.promptTokens ?? Math.ceil(bytes / 3);
    totals.completionTokens += turn.usage.completionTokens ?? outputTokens;
    totals.latencyMs += turn.latencyMs;
    totals.roundTripMs += turn.roundTripMs;
    totals.modelAlias = turn.modelAlias;
    totals.resolvedModel = turn.resolvedModel ?? totals.resolvedModel;
    totals.finishReason = turn.finishReason;
    if (clock() > input.deadline) exhausted("wall_clock");

    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    if (turn.toolCalls.length === 0) {
      ledger.noteInvalidTurn();
      messages.push({ role: "user", content: NUDGE_MESSAGE });
      continue;
    }
    ledger.beginTurn();
    turn.toolCalls.forEach((call, index) => {
      const result =
        index >= WRITER_AGENT_BUDGET.maxCallsPerTurn
          ? ledger.decline(call, "too_many_calls", `At most ${WRITER_AGENT_BUDGET.maxCallsPerTurn} tool calls per turn.`)
          : ledger.finished
            ? ledger.decline(call, "report_finished", "The report is already finished.")
            : ledger.toolCalls >= WRITER_AGENT_BUDGET.maxToolCalls
              ? ledger.decline(call, "too_many_calls", `At most ${WRITER_AGENT_BUDGET.maxToolCalls} accepted tool calls per report.`)
              : ledger.execute(call);
      messages.push({ role: "tool", tool_call_id: result.toolCallId, content: result.content });
    });
  }
  sync();
  return { report: ledger.assemble(), totals };
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

  const clock = deps.clock ?? Date.now;
  const startedAt = clock();
  const now = deps.now ?? (() => new Date());
  const { correlationId } = claimed;
  let current: ReportRunStatus = "WRITING";
  let metric: StageMetric | null = null;
  log(claimed, current, startedAt);

  try {
    const inputs = await loadGenerationInputs(deps.client, reportRunId);
    const audience = claimed.audience;
    const claims = studyClaimCatalog(inputs.verified);
    const fileNames = fileNamesOf(inputs.sourceSnapshot);
    const catalog = (deps.loadCatalog ?? loadPromptCatalog)();
    const baseMetric: StageMetric = {
      stage: "WRITING",
      attempt: claimed.attemptCount,
      promptId: catalog.writer.id,
      promptDigest: catalog.writer.digest,
      modelAliasRequested: null,
      startedAt: now().toISOString(),
    };
    const withTotals = (totals: WriterAgentTotals): StageMetric => ({
      ...baseMetric,
      modelAliasRequested: totals.modelAlias,
      resolvedModel: totals.resolvedModel,
      promptTokens: totals.promptTokens,
      completionTokens: totals.completionTokens,
      totalTokens: totals.promptTokens + totals.completionTokens,
      latencyMs: totals.latencyMs,
      plannerLatencyMs: totals.roundTripMs,
      finishReason: totals.finishReason,
      completedAt: now().toISOString(),
    });

    let agentResult: Awaited<ReturnType<typeof runWriterAgent>>;
    try {
      agentResult = await runWriterAgent({
        planner: deps.planner,
        reportRunId,
        correlationId,
        audience,
        prompt: catalog.writer,
        userPayload: buildWriterPayload(audience, inputs, claims),
        claims,
        fileNames,
        deadline: startedAt + WRITER_AGENT_BUDGET.wallClockMs,
        clock,
      });
    } catch (error) {
      if (error instanceof WriterAgentFailure) {
        const { hiveError } = error;
        metric = {
          ...withTotals(error.totals),
          outcome: "FAILED",
          errorCode: hiveError.errorCode,
          retryable: hiveError.retryable,
        };
        throw hiveError;
      }
      throw error;
    }
    metric = withTotals(agentResult.totals);

    const validating = await transitionReport(deps.client, reportRunId, "WRITING", "VALIDATING");
    if (!validating.applied) return validating.reportRun?.status ?? null;
    current = "VALIDATING";

    const built = buildReport(agentResult.report, { audience, claims, fileNames });
    if (!built.ok) {
      metric = { ...metric, outcome: "FAILED", errorCode: "MODEL_OUTPUT_INVALID", retryable: false };
      throw reportError({
        errorCode: "MODEL_OUTPUT_INVALID",
        retryable: false,
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
        model_alias: agentResult.totals.modelAlias,
        resolved_model: agentResult.totals.resolvedModel,
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
      if (failed.applied && failed.retrying && deps.dispatch) {
        const attempts = failed.reportRun?.attemptCount ?? claimed.attemptCount;
        const delaySeconds = REPORT_RETRY_BACKOFF_SECONDS * Math.max(1, attempts);
        await deps.dispatch({ kind: "report", id: reportRunId }, correlationId, { delaySeconds });
      }
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
