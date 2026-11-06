import {
  buildFailureDiagnostic,
  buildUnexpectedExceptionDiagnostics,
  classifyFailure,
  createHiveError,
  type DomainProposal,
  type ExecutionManifest,
  type HiveError,
  type IntentAnalysis,
  type IntentIntelligence,
  type InvestigationPlan,
  type ModelStageStatus,
  normalizeProcessingRun,
  pageKey,
  type ProcessingRun,
  type ProcessingRunStatus,
  assessDocumentCenteredStudy,
  resolveAudienceConfiguration,
  type SampleCoverage,
  SOURCE_PAGE_INDEX_FORMAT,
  SOURCE_PAGES_PLACEHOLDER,
  type SourceSnapshot,
  STUDY_AGENT_BUDGET,
  type StageMetric,
  type StoredIntent,
  validateDomainProposal,
  validateExecutionManifest,
  validateIntentAnalysis,
  validateIntentIntelligence,
  buildDeterministicInvestigationPlan,
  type CanonicalStudy,
  type VerifiedStudy,
  verifyStudyInvestigation,
} from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";
import {
  type DocumentReadRpcClient,
  processDocumentReads,
  type ProcessDocumentReadsDeps,
} from "@/server/source-documents/document-reads";
import { loadFrozenSampleDocuments, selectDomainSamples } from "@/server/study-preparation/page-sampling";
import { callPlanner, type PlannerCallResult, type PlannerDeps } from "@/server/study-preparation/planner-client";
import { loadPromptCatalog, type PlannerPrompt, type PromptCatalog, sha256Digest } from "@/server/study-preparation/prompt-catalog";
import {
  applyProvisionalDomainToIntentSystemPrompt,
  type ProvisionalDomainContext,
  parseProvisionalDomainContextFromInputs,
} from "@/server/study-preparation/provisional-domain-context";
import { buildStudyPrompt, canonicalJson } from "@/server/study-preparation/study-prompt-builder";

import type { Dispatch } from "./dispatch";
import { renderSourcePageIndex, runStudyInvestigation, StudyAgentFailure, type StudyAgentTotals } from "./study-investigation";
import {
  buildV5AcceptRevision,
  ExtractStageFailure,
  extractedDocumentIds,
  documentsNeedingExtraction,
  isV5CanonicalStudy,
  loadVerifiedExtractions,
  runCanonicalizeForRun,
  runExtractingWorkerPool,
  tryAdvanceExtractingToCanonicalizing,
} from "./v5-pipeline-stages";

/**
 * The Analyze workflow (D-041): one durable run from reading documents to an accepted Canonical
 * Study. Each invocation claims the run's current stage, runs at most one model call (the Study
 * investigation runs one bounded tool-calling loop instead, D-042). EXTRACTING runs up to four
 * parallel extract calls per invocation (D-052). Other stages persist one validated output and hand
 * the next stage to a fresh invocation. Deterministic steps continue
 * inline. Timeouts and unavailable models retry the same stage (three attempts); invalid output
 * fails the run. Accepting an Analyze Study queues both Writer runs, which are dispatched here.
 * An explicit Rebuild Study (`preparationMode = REBUILD`) accepts a new revision only and does not
 * dispatch Writer.
 */

export type AnalysisWorkflowDeps = {
  readonly client: DocumentReadRpcClient;
  readonly planner: PlannerDeps;
  readonly reader?: ProcessDocumentReadsDeps["reader"];
  readonly dispatch: Dispatch;
  readonly loadCatalog?: () => PromptCatalog;
  readonly now?: () => Date;
  readonly clock?: () => number;
  /** `Date.now()` when the route invocation started. Report writes abort 30s before `maxDuration`. */
  readonly invocationStartedAt?: number;
};

type StageOutputs = {
  intentDecomposition?: IntentAnalysis;
  domainProposal?: DomainProposal;
  sampleCoverage?: SampleCoverage;
  intentIntelligence?: IntentIntelligence;
  investigationPlan?: InvestigationPlan;
  studyInvestigation?: unknown;
  canonicalStudy?: CanonicalStudy;
};

type TransitionDetails = {
  readonly stage_outputs?: StageOutputs;
  readonly stage_metric?: StageMetric;
  readonly prompt_digest?: string;
  readonly error_code?: string;
  readonly error_message_safe?: string;
  readonly retryable?: boolean;
  readonly failure_diagnostic?: ReturnType<typeof buildFailureDiagnostic>;
};

type TransitionResult = {
  applied: boolean;
  sourceChanged: boolean;
  waiting: boolean;
  /** Reading found material gaps not acknowledged before; the run waits for the owner. */
  awaitingAcknowledgement: boolean;
  run: ProcessingRun | null;
};

type RunInputs = {
  run: ProcessingRun;
  sourceSnapshot: SourceSnapshot;
  sourceSnapshotDigest: string;
  intentSnapshotDigest: string;
  coverageDigest: string;
  stageOutputs: StageOutputs;
  intents: StoredIntent[];
  provisionalDomain: ProvisionalDomainContext;
};

/** What the invocation does after a stage: keep going, hand off to a new invocation, or stop. */
type StepResult =
  | { readonly next: "continue"; readonly run: ProcessingRun }
  | { readonly next: "handoff"; readonly status: ProcessingRunStatus; readonly delaySeconds: number }
  | { readonly next: "stop"; readonly status: ProcessingRunStatus | null };

const STOPPED_MESSAGE = "Analysis stopped before it finished. You can try again.";
const MODEL_OUTPUT_MESSAGE = "The analysis model returned an answer we couldn't use. You can try again.";
const SAVE_FAILED_MESSAGE = "We couldn't save your study prompt. You can try again.";
const SOURCE_CHANGED_MESSAGE =
  "Your documents or request changed while analyzing. Analyze again to use the latest versions.";
const PREVIEW_OUTDATED_MESSAGE = "This analysis was prepared with an earlier version of Hive. Analyze again.";
const READ_WAIT_SECONDS = 15;
const MAX_STEPS_PER_INVOCATION = 12;
/** Transient planner/network failures only; never auto-retry confirmed malformed model JSON. */
const RETRYABLE_MODEL_ERRORS = new Set(["MODEL_TIMEOUT", "MODEL_UNAVAILABLE"]);

function stageFailureRetryable(hiveError: HiveError): boolean {
  if (hiveError.errorCode === "MODEL_OUTPUT_INVALID") return false;
  return hiveError.retryable && RETRYABLE_MODEL_ERRORS.has(hiveError.errorCode);
}

class StageFailure extends Error {
  constructor(
    readonly hiveError: HiveError,
    readonly metric: StageMetric | null,
  ) {
    super(hiveError.errorCode);
  }
}

class SourceChanged extends Error {
  constructor(readonly alreadyFailed: boolean) {
    super("source_changed");
  }
}

function parsePayload(data: unknown): Record<string, unknown> | null {
  const payload = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

function isHiveError(value: unknown): value is HiveError {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { errorCode?: unknown }).errorCode === "string" &&
    typeof (value as { safeMessage?: unknown }).safeMessage === "string" &&
    typeof (value as { retryable?: unknown }).retryable === "boolean"
  );
}

function analysisError(
  input: Pick<
    HiveError,
    "errorCode" | "retryable" | "safeMessage" | "correlationId" | "diagnosticReason" | "diagnosticField"
  > & {
    category?: HiveError["category"];
    cause?: unknown;
  },
): HiveError {
  return createHiveError({ category: "INTERNAL", stage: "ANALYZE", ...input });
}

function unexpectedAnalysisFailure(correlationId: string, cause: unknown): HiveError {
  const { diagnosticField } = buildUnexpectedExceptionDiagnostics(cause);
  return analysisError({
    errorCode: "INTERNAL_ERROR",
    retryable: true,
    safeMessage: STOPPED_MESSAGE,
    correlationId,
    diagnosticReason: "unexpected_exception",
    ...(diagnosticField ? { diagnosticField } : {}),
    cause,
  });
}

function unexpectedExceptionObservability(error?: {
  diagnosticReason?: string;
  diagnosticField?: string;
  cause?: unknown;
}) {
  if (!error || error.diagnosticReason !== "unexpected_exception") {
    return null;
  }
  return buildUnexpectedExceptionDiagnostics(error.cause ?? error);
}

async function rpc(client: DocumentReadRpcClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message ?? `${fn} failed`);
  return parsePayload(data);
}

async function transition(
  client: DocumentReadRpcClient,
  runId: string,
  from: ProcessingRunStatus,
  to: ProcessingRunStatus,
  details: TransitionDetails = {},
): Promise<TransitionResult> {
  const payload = await rpc(client, "transition_processing_run", {
    p_run_id: runId,
    p_from_status: from,
    p_to_status: to,
    p_details: details,
  });
  return {
    applied: payload?.applied === true,
    sourceChanged: payload?.sourceChanged === true,
    waiting: payload?.waiting === true,
    awaitingAcknowledgement: payload?.awaitingAcknowledgement === true,
    run: normalizeProcessingRun(payload?.processingRun),
  };
}

async function loadInputs(client: DocumentReadRpcClient, runId: string): Promise<RunInputs> {
  const payload = await rpc(client, "get_study_preparation_inputs", { p_run_id: runId });
  const run = normalizeProcessingRun(payload?.processingRun);
  const snapshot = payload?.sourceSnapshot as SourceSnapshot | undefined;
  const intents = Array.isArray(payload?.intents) ? (payload.intents as Record<string, unknown>[]) : null;
  if (!run || !snapshot || !Array.isArray(snapshot.documents) || !Array.isArray(snapshot.excluded) || !intents) {
    throw new Error("unexpected_inputs_shape");
  }
  if (payload?.snapshotCurrent === false) throw new SourceChanged(false);
  return {
    run,
    sourceSnapshot: snapshot,
    sourceSnapshotDigest: String(payload?.sourceSnapshotDigest),
    intentSnapshotDigest: String(payload?.intentSnapshotDigest),
    coverageDigest: String(payload?.coverageDigest),
    stageOutputs: (payload?.stageOutputs ?? {}) as StageOutputs,
    provisionalDomain: parseProvisionalDomainContextFromInputs(payload ?? {}),
    intents: intents
      .filter((intent) => typeof intent.id === "string" && typeof intent.intentText === "string")
      .map((intent) => ({
        id: (intent.id as string).toLowerCase(),
        intentText: intent.intentText as string,
        audience: typeof intent.audience === "string" && intent.audience.trim() ? intent.audience : null,
      })),
  };
}

function documentSummaries(snapshot: SourceSnapshot) {
  return snapshot.documents.map((document) => ({
    sourceDocumentId: document.sourceDocumentId,
    fileName: document.fileName,
    mimeType: document.mimeType,
    totalPhysicalPages: document.totalPhysicalPages,
    readStatus: document.readStatus,
    missingPageNumbers: document.missingPageNumbers,
    emptyPageNumbers: document.emptyPageNumbers,
  }));
}

function intentPayload(inputs: RunInputs) {
  return inputs.intents.map((intent) => ({
    intentRequestId: intent.id,
    intentText: intent.intentText,
    audience: intent.audience,
  }));
}

function coverageSummary(snapshot: SourceSnapshot) {
  return { complete: snapshot.coverageComplete, excludedDocumentCount: snapshot.excluded.length };
}

function log(
  run: Pick<ProcessingRun, "id" | "hiveId" | "correlationId" | "attemptNumber">,
  status: string,
  startedAt: number,
  error?: { errorCode: string; retryable: boolean; diagnosticReason?: string; diagnosticField?: string },
  failureStage?: string,
) {
  const reason = error?.diagnosticReason ?? (error ? "unexpected_exception" : undefined);
  const unexpected = unexpectedExceptionObservability(error);
  const classified =
    error && reason ? classifyFailure({ stage: failureStage ?? "INVESTIGATING", diagnosticReason: reason }) : null;
  emitStructuredEvent({
    eventName: `analysis.${status.toLowerCase()}`,
    severity: status === "FAILED" ? "ERROR" : "INFO",
    timestamp: new Date().toISOString(),
    component: classified?.component ?? "analysis",
    operation: classified?.operation ?? "analyze",
    stage: "ANALYZE",
    correlationId: run.correlationId,
    hiveId: run.hiveId,
    processingRunId: run.id,
    attempt: run.attemptNumber,
    status,
    durationMs: Date.now() - startedAt,
    ...(classified?.task ? { task: classified.task } : {}),
    ...(error
      ? {
          errorCode: error.errorCode,
          retryable: error.retryable,
          diagnosticReason: reason,
          ...(typeof error.diagnosticField === "string"
            ? { diagnosticField: error.diagnosticField }
            : unexpected?.diagnosticField
              ? { diagnosticField: unexpected.diagnosticField }
              : {}),
          ...(unexpected?.errorDetail ? { errorDetail: unexpected.errorDetail } : {}),
        }
      : {}),
  });
}

function persistedDiagnostic(input: {
  stage: string;
  errorCode: string;
  diagnosticReason: string;
  diagnosticField?: string | null;
  retryable: boolean;
  attempt: number;
}): TransitionDetails["failure_diagnostic"] {
  const classified = classifyFailure({ stage: input.stage, diagnosticReason: input.diagnosticReason });
  return (
    buildFailureDiagnostic({
      ...classified,
      stage: input.stage,
      errorCode: input.errorCode,
      diagnosticReason: input.diagnosticReason,
      diagnosticField: input.diagnosticField ?? null,
      retryable: input.retryable,
      attempt: input.attempt,
    }) ?? undefined
  );
}

type Context = {
  readonly deps: AnalysisWorkflowDeps;
  readonly runId: string;
  readonly correlationId: string;
  readonly catalog: () => PromptCatalog;
  readonly now: () => Date;
  readonly startedAt: number;
  stageAttempt: number;
  /** The run's persisted status; a step may advance it more than once. */
  status: ProcessingRunStatus;
};

async function modelStage<T>(
  context: Context,
  stage: ModelStageStatus,
  prompt: PlannerPrompt,
  userPayload: Record<string, unknown>,
  validate: (
    raw: unknown,
  ) =>
    | { ok: true; value: T }
    | { ok: false; message: string; diagnosticReason: string; diagnosticField?: string },
): Promise<{ value: T; metric: StageMetric; completion: PlannerCallResult }> {
  const { correlationId } = context;
  const baseMetric: StageMetric = {
    stage,
    attempt: context.stageAttempt,
    promptId: prompt.id,
    promptDigest: prompt.digest,
    modelAliasRequested: null,
    startedAt: context.now().toISOString(),
  };
  let completion: PlannerCallResult;
  try {
    completion = await callPlanner(context.deps.planner, { prompt, userPayload, correlationId, processingRunId: context.runId });
  } catch (error) {
    const hiveError = isHiveError(error)
      ? error
      : analysisError({
          errorCode: "MODEL_UNAVAILABLE",
          category: "DEPENDENCY",
          retryable: true,
          safeMessage: "The analysis service is temporarily unavailable. You can try again.",
          correlationId,
          diagnosticReason: "planner_unavailable",
          cause: error,
        });
    throw new StageFailure(hiveError, {
      ...baseMetric,
      outcome: "FAILED",
      completedAt: context.now().toISOString(),
      errorCode: hiveError.errorCode,
      retryable: hiveError.retryable,
    });
  }
  const metric: StageMetric = {
    ...baseMetric,
    modelAliasRequested: completion.modelAlias,
    resolvedModel: completion.resolvedModel,
    promptTokens: completion.usage.promptTokens,
    completionTokens: completion.usage.completionTokens,
    totalTokens: completion.usage.totalTokens,
    latencyMs: completion.latencyMs,
    plannerLatencyMs: completion.roundTripMs,
    finishReason: completion.finishReason,
    completedAt: context.now().toISOString(),
  };
  const validated = validate(completion.contentJson);
  if (!validated.ok) {
    throw new StageFailure(
      analysisError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        retryable: true,
        safeMessage: MODEL_OUTPUT_MESSAGE,
        correlationId,
        diagnosticReason: validated.diagnosticReason,
        diagnosticField: validated.diagnosticField,
      }),
      { ...metric, outcome: "FAILED", errorCode: "MODEL_OUTPUT_INVALID", retryable: true },
    );
  }
  return { value: validated.value, metric: { ...metric, outcome: "SUCCEEDED" }, completion };
}

function requireOutput<T>(value: T | undefined, context: Context): T {
  if (value === undefined || value === null) {
    throw new StageFailure(
      analysisError({
        errorCode: "INTERNAL_ERROR",
        retryable: true,
        safeMessage: STOPPED_MESSAGE,
        correlationId: context.correlationId,
        diagnosticReason: "stage_transition_rejected",
      }),
      null,
    );
  }
  return value;
}

async function advance(context: Context, from: ProcessingRunStatus, to: ProcessingRunStatus, details: TransitionDetails = {}) {
  const result = await transition(context.deps.client, context.runId, from, to, details);
  if (result.sourceChanged) throw new SourceChanged(true);
  if (!result.applied || !result.run) {
    throw new StageFailure(
      analysisError({
        errorCode: "INTERNAL_ERROR",
        retryable: true,
        safeMessage: STOPPED_MESSAGE,
        correlationId: context.correlationId,
        diagnosticReason: "stage_transition_rejected",
      }),
      null,
    );
  }
  log(result.run, to, context.startedAt);
  context.stageAttempt = result.run.stageAttempt;
  context.status = to;
  return result.run;
}

async function domainSamples(context: Context, inputs: RunInputs) {
  const sampleDocuments = await loadFrozenSampleDocuments(context.deps.client, {
    hiveId: inputs.run.hiveId,
    documents: inputs.sourceSnapshot.documents,
    correlationId: context.correlationId,
  });
  const selected = selectDomainSamples(sampleDocuments);
  return {
    ...selected,
    sampledRefs: selected.samples.map((sample) => ({ sourceDocumentId: sample.sourceDocumentId, pageNumber: sample.pageNumber })),
  };
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------
async function readDocuments(context: Context, run: ProcessingRun): Promise<StepResult> {
  const payload = await rpc(context.deps.client, "get_processing_run_queued_reads", { p_run_id: context.runId });
  const readIds = Array.isArray(payload?.readIds) ? payload.readIds.filter((id): id is string => typeof id === "string") : [];
  if (readIds.length > 0) {
    await processDocumentReads({ client: context.deps.client, reader: context.deps.reader }, readIds);
  }
  const result = await transition(context.deps.client, context.runId, "READING_DOCUMENTS", "EXTRACTING");
  if (result.applied && result.run) {
    log(result.run, "EXTRACTING", context.startedAt);
    return { next: "handoff", status: "EXTRACTING", delaySeconds: 0 };
  }
  if (result.waiting) return { next: "handoff", status: "READING_DOCUMENTS", delaySeconds: READ_WAIT_SECONDS };
  if (result.run) log(result.run, result.run.status, context.startedAt);
  // Paused for the owner's review (or stopped): nothing to dispatch until acknowledge_study_coverage.
  if (result.awaitingAcknowledgement) return { next: "stop", status: "AWAITING_ACKNOWLEDGEMENT" };
  return { next: "stop", status: result.run?.status ?? run.status };
}

async function understandRequest(context: Context): Promise<StepResult> {
  const inputs = await loadInputs(context.deps.client, context.runId);
  if (inputs.intents.length === 0) {
    throw new StageFailure(
      analysisError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        retryable: false,
        safeMessage: "Tell us what you want to understand from these documents, then analyze again.",
        correlationId: context.correlationId,
        diagnosticReason: "intent_missing",
      }),
      null,
    );
  }
  const catalog = context.catalog();
  const prompt = {
    ...catalog.planner.intent,
    systemPrompt: applyProvisionalDomainToIntentSystemPrompt(catalog.planner.intent.systemPrompt, inputs.provisionalDomain),
  };
  const analysis = await modelStage(
    context,
    "UNDERSTANDING_REQUEST",
    prompt,
    { task: "intent", processingRunId: context.runId, requests: intentPayload(inputs), domainContext: inputs.provisionalDomain },
    (raw) => validateIntentAnalysis(raw, { intents: inputs.intents, processingRunId: context.runId }),
  );
  await advance(context, "UNDERSTANDING_REQUEST", "IDENTIFYING_DOMAIN", {
    stage_outputs: { intentDecomposition: analysis.value },
    stage_metric: analysis.metric,
  });
  return { next: "handoff", status: "IDENTIFYING_DOMAIN", delaySeconds: 0 };
}

async function identifyDomain(context: Context): Promise<StepResult> {
  const inputs = await loadInputs(context.deps.client, context.runId);
  const { samples, coverage, sampledRefs } = await domainSamples(context, inputs);
  const domain = await modelStage(
    context,
    "IDENTIFYING_DOMAIN",
    context.catalog().planner.domain,
    {
      task: "domain",
      intents: intentPayload(inputs),
      documents: documentSummaries(inputs.sourceSnapshot),
      samples,
      coverage: coverageSummary(inputs.sourceSnapshot),
    },
    (raw) => validateDomainProposal(raw, { sampledRefs }),
  );
  await advance(context, "IDENTIFYING_DOMAIN", "DEVELOPING_QUESTIONS", {
    stage_outputs: { domainProposal: domain.value, sampleCoverage: coverage },
    stage_metric: domain.metric,
  });
  return { next: "handoff", status: "DEVELOPING_QUESTIONS", delaySeconds: 0 };
}

async function developQuestions(context: Context): Promise<StepResult> {
  const inputs = await loadInputs(context.deps.client, context.runId);
  const analysis = requireOutput(inputs.stageOutputs.intentDecomposition, context);
  const domain = requireOutput(inputs.stageOutputs.domainProposal, context);
  const { samples, sampledRefs } = await domainSamples(context, inputs);
  const intelligence = await modelStage(
    context,
    "DEVELOPING_QUESTIONS",
    context.catalog().planner.intelligence,
    {
      task: "intelligence",
      intents: intentPayload(inputs),
      intentDecomposition: analysis,
      domain,
      documents: documentSummaries(inputs.sourceSnapshot),
      samples,
      coverage: coverageSummary(inputs.sourceSnapshot),
    },
    (raw) => validateIntentIntelligence(raw, { analysis, sampledRefs }),
  );
  const plan = buildDeterministicInvestigationPlan({
    analysis,
    intelligence: intelligence.value,
    domain,
  });
  if (!plan.ok) {
    throw new StageFailure(
      analysisError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        retryable: false,
        safeMessage: MODEL_OUTPUT_MESSAGE,
        correlationId: context.correlationId,
        diagnosticReason: plan.diagnosticReason,
        ...(plan.diagnosticField ? { diagnosticField: plan.diagnosticField } : {}),
      }),
      intelligence.metric,
    );
  }
  const run = await advance(context, "DEVELOPING_QUESTIONS", "BUILDING_PROMPT", {
    stage_outputs: { intentIntelligence: intelligence.value, investigationPlan: plan.value },
    stage_metric: intelligence.metric,
  });
  return { next: "continue", run };
}

/** In-flight runs that stopped at the retired planning status: derive the plan in code and continue. */
async function resolveLegacyPlanning(context: Context): Promise<StepResult> {
  const inputs = await loadInputs(context.deps.client, context.runId);
  const analysis = requireOutput(inputs.stageOutputs.intentDecomposition, context);
  const domain = requireOutput(inputs.stageOutputs.domainProposal, context);
  const intelligence = requireOutput(inputs.stageOutputs.intentIntelligence, context);
  const plan = buildDeterministicInvestigationPlan({ analysis, intelligence, domain });
  if (!plan.ok) {
    throw new StageFailure(
      analysisError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        retryable: false,
        safeMessage: MODEL_OUTPUT_MESSAGE,
        correlationId: context.correlationId,
        diagnosticReason: plan.diagnosticReason,
        ...(plan.diagnosticField ? { diagnosticField: plan.diagnosticField } : {}),
      }),
      null,
    );
  }
  const run = await advance(context, "PLANNING_INVESTIGATION", "BUILDING_PROMPT", {
    stage_outputs: { investigationPlan: plan.value },
  });
  return { next: "continue", run };
}

/** Deterministic: the same persisted outputs always rebuild the same prompt and digest. */
async function buildAndSavePrompt(context: Context, from: "BUILDING_PROMPT" | "SAVING"): Promise<StepResult> {
  const inputs = await loadInputs(context.deps.client, context.runId);
  const analysis = requireOutput(inputs.stageOutputs.intentDecomposition, context);
  const intelligence = requireOutput(inputs.stageOutputs.intentIntelligence, context);
  const built = buildStudyPrompt({
    processingRunId: context.runId,
    catalog: context.catalog(),
    analysis,
    intelligence,
    domain: requireOutput(inputs.stageOutputs.domainProposal, context),
    plan: requireOutput(inputs.stageOutputs.investigationPlan, context),
    audience: resolveAudienceConfiguration({ analysis, intelligence }),
    sourceSnapshot: inputs.sourceSnapshot,
    sourceSnapshotDigest: inputs.sourceSnapshotDigest,
    intentSnapshotDigest: inputs.intentSnapshotDigest,
    coverageDigest: inputs.coverageDigest,
    intentRequestIds: inputs.run.intentRequestIds,
  });
  if (from === "BUILDING_PROMPT") await advance(context, "BUILDING_PROMPT", "SAVING");
  await savePreview(context, built);
  await advance(context, "SAVING", "INVESTIGATING", { prompt_digest: built.promptDigest });
  return { next: "handoff", status: "INVESTIGATING", delaySeconds: 0 };
}

async function savePreview(context: Context, built: ReturnType<typeof buildStudyPrompt>): Promise<void> {
  const saveFailed = (diagnosticReason: string, cause?: unknown) =>
    analysisError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      retryable: true,
      safeMessage: SAVE_FAILED_MESSAGE,
      correlationId: context.correlationId,
      diagnosticReason,
      cause,
    });
  if (!validateExecutionManifest(built.executionManifest).ok) throw saveFailed("artifact_hash_mismatch");

  const saved = await context.deps.client.rpc("save_study_prompt_preview", {
    p_run_id: context.runId,
    p_preview: {
      prompt_id: built.promptId,
      prompt_version: built.promptVersion,
      prompt_template_digest: built.promptTemplateDigest,
      prompt_text: built.promptText,
      prompt_digest: built.promptDigest,
      execution_manifest: built.executionManifest,
    },
  });
  if (saved.error) throw saveFailed("persistence_failed", saved.error);

  const preview = await readPreview(context);
  if (!preview || preview.promptText !== built.promptText || preview.promptDigest !== built.promptDigest) {
    throw saveFailed("preview_readback_mismatch");
  }
}

type SavedPreview = { promptId: string; promptText: string; promptDigest: string; manifest: ExecutionManifest };

async function readPreview(context: Context): Promise<SavedPreview | null> {
  const payload = await rpc(context.deps.client, "read_study_prompt_preview", { p_run_id: context.runId });
  const preview = payload?.preview as Record<string, unknown> | undefined;
  const manifest = validateExecutionManifest(preview?.executionManifest);
  if (
    payload?.found !== true ||
    !preview ||
    String(preview.processingRunId).toLowerCase() !== context.runId.toLowerCase() ||
    typeof preview.promptText !== "string" ||
    sha256Digest(preview.promptText) !== preview.promptDigest ||
    !manifest.ok ||
    manifest.value.prompt.promptDigest !== preview.promptDigest
  ) {
    return null;
  }
  return {
    promptId: typeof preview.promptId === "string" ? preview.promptId : manifest.value.prompt.id,
    promptText: preview.promptText,
    promptDigest: preview.promptDigest as string,
    manifest: manifest.value,
  };
}

type SourcePages = { pages: Map<string, string>; ordered: { sourceDocumentId: string; pageNumber: number; text: string }[] };

/** Frozen pages for the run, checked against the manifest before any model sees them. */
async function loadSourcePages(context: Context, manifest: ExecutionManifest): Promise<SourcePages> {
  const payload = await rpc(context.deps.client, "get_study_source_pages", { p_run_id: context.runId });
  if (payload?.snapshotCurrent === false) throw new SourceChanged(false);
  const rows = Array.isArray(payload?.pages) ? (payload.pages as Record<string, unknown>[]) : [];
  const pages = new Map<string, string>();
  const ordered: SourcePages["ordered"] = [];
  const digests = new Map(manifest.requiredInputs.sourceDocuments.documents.map((d) => [d.sourceDocumentId.toLowerCase(), d]));
  for (const row of rows) {
    const id = String(row.sourceDocumentId).toLowerCase();
    const pageNumber = Number(row.pageNumber);
    const text = String(row.pageText ?? "");
    const document = digests.get(id);
    if (!document || row.pageSetDigest !== document.pageSetDigest || sha256Digest(text) !== row.pageTextSha256) {
      throw manifestMismatch(context);
    }
    pages.set(pageKey(id, pageNumber), text);
    ordered.push({ sourceDocumentId: id, pageNumber, text });
  }
  for (const document of digests.values()) {
    for (const pageNumber of document.authorizedPageNumbers) {
      if (!pages.has(pageKey(document.sourceDocumentId, pageNumber))) throw manifestMismatch(context);
    }
  }
  if (ordered.length !== manifest.limits.authorizedPageCount) throw manifestMismatch(context);
  return { pages, ordered };
}

function manifestMismatch(context: Context): StageFailure {
  return new StageFailure(
    analysisError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      retryable: true,
      safeMessage: STOPPED_MESSAGE,
      correlationId: context.correlationId,
      diagnosticReason: "study_manifest_mismatch",
    }),
    null,
  );
}

function verifyStudy(context: Context, raw: unknown, manifest: ExecutionManifest, pages: SourcePages) {
  return verifyStudyInvestigation(raw, {
    processingRunId: context.runId,
    planQuestionIds: manifest.requiredInputs.investigationPlan.questionIds,
    pages: pages.pages,
    requireCorpusReconciliation: true,
  });
}

/**
 * Canonical Study investigation (D-042): a bounded tool-calling loop over the case-wide corpus of
 * frozen pages. Only a finished Study that still matches the current snapshot and passes the
 * verifier is persisted; anything else fails the stage before acceptance.
 */
async function investigate(context: Context): Promise<StepResult> {
  const preview = await readPreview(context);
  if (!preview) throw manifestMismatch(context);
  if (preview.manifest.bindings.some((binding) => binding.format !== SOURCE_PAGE_INDEX_FORMAT)) {
    throw new StageFailure(
      analysisError({
        errorCode: "INTERNAL_ERROR",
        retryable: false,
        safeMessage: PREVIEW_OUTDATED_MESSAGE,
        correlationId: context.correlationId,
        diagnosticReason: "study_preview_outdated",
      }),
      null,
    );
  }
  const pages = await loadSourcePages(context, preview.manifest);
  const systemPrompt = preview.promptText.replace(SOURCE_PAGES_PLACEHOLDER, () => renderSourcePageIndex(pages.ordered));
  const metric: StageMetric = {
    stage: "INVESTIGATING",
    attempt: context.stageAttempt,
    promptId: preview.promptId,
    promptDigest: preview.promptDigest,
    modelAliasRequested: null,
    startedAt: context.now().toISOString(),
  };
  const withTotals = (totals: StudyAgentTotals): StageMetric => ({
    ...metric,
    modelAliasRequested: totals.modelAlias,
    resolvedModel: totals.resolvedModel,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    totalTokens: totals.promptTokens + totals.completionTokens,
    latencyMs: totals.latencyMs,
    plannerLatencyMs: totals.roundTripMs,
    finishReason: totals.finishReason,
    completedAt: context.now().toISOString(),
  });
  let investigation: Awaited<ReturnType<typeof runStudyInvestigation>>;
  try {
    investigation = await runStudyInvestigation({
      planner: context.deps.planner,
      runId: context.runId,
      correlationId: context.correlationId,
      prompt: { id: preview.promptId, digest: preview.promptDigest, systemPrompt },
      questionIds: preview.manifest.requiredInputs.investigationPlan.questionIds,
      pages: pages.ordered,
      deadline: context.startedAt + STUDY_AGENT_BUDGET.wallClockMs,
    });
  } catch (error) {
    if (!(error instanceof StudyAgentFailure)) throw error;
    const { hiveError } = error;
    throw new StageFailure(hiveError, {
      ...withTotals(error.totals),
      outcome: "FAILED",
      errorCode: hiveError.errorCode,
      retryable: stageFailureRetryable(hiveError),
    });
  }
  const done = withTotals(investigation.totals);
  await loadInputs(context.deps.client, context.runId);
  const verified = verifyStudy(context, investigation.study, preview.manifest, pages);
  if (!verified.ok) {
    throw new StageFailure(
      analysisError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        retryable: false,
        safeMessage: MODEL_OUTPUT_MESSAGE,
        correlationId: context.correlationId,
        diagnosticReason: verified.diagnosticReason,
        diagnosticField: verified.diagnosticField,
      }),
      { ...done, outcome: "FAILED", errorCode: "MODEL_OUTPUT_INVALID", retryable: false },
    );
  }
  const run = await advance(context, "INVESTIGATING", "VERIFYING_EVIDENCE", {
    stage_outputs: { studyInvestigation: verified.value.investigation },
    stage_metric: { ...done, outcome: "SUCCEEDED" },
  });
  return { next: "continue", run };
}

async function verifiedStudyFromRun(context: Context): Promise<{ inputs: RunInputs; verified: VerifiedStudy }> {
  const inputs = await loadInputs(context.deps.client, context.runId);
  const preview = await readPreview(context);
  if (!preview) throw manifestMismatch(context);
  const pages = await loadSourcePages(context, preview.manifest);
  const verified = verifyStudy(context, requireOutput(inputs.stageOutputs.studyInvestigation, context), preview.manifest, pages);
  if (!verified.ok) {
    throw new StageFailure(
      analysisError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        retryable: true,
        safeMessage: MODEL_OUTPUT_MESSAGE,
        correlationId: context.correlationId,
        diagnosticReason: verified.diagnosticReason,
      }),
      null,
    );
  }
  return { inputs, verified: verified.value };
}

async function verifyEvidence(context: Context): Promise<StepResult> {
  await verifiedStudyFromRun(context);
  const run = await advance(context, "VERIFYING_EVIDENCE", "ACCEPTING_STUDY");
  return { next: "continue", run };
}

async function finishExtractingStage(context: Context, run: ProcessingRun): Promise<StepResult> {
  const advanced = await tryAdvanceExtractingToCanonicalizing(context.deps.client, context.runId);
  const nextRun = advanced.run ?? run;
  if (advanced.applied && nextRun) {
    log(nextRun, "CANONICALIZING", context.startedAt);
    context.stageAttempt = nextRun.stageAttempt;
    context.status = "CANONICALIZING";
  } else if (nextRun?.status === "CANONICALIZING") {
    context.stageAttempt = nextRun.stageAttempt;
    context.status = "CANONICALIZING";
  } else if (!advanced.applied) {
    throw new StageFailure(
      analysisError({
        errorCode: "INTERNAL_ERROR",
        retryable: true,
        safeMessage: STOPPED_MESSAGE,
        correlationId: context.correlationId,
        diagnosticReason: "extracting_incomplete",
      }),
      null,
    );
  }
  return { next: "handoff", status: "CANONICALIZING", delaySeconds: 0 };
}

async function extractDocuments(context: Context): Promise<StepResult> {
  const inputs = await loadInputs(context.deps.client, context.runId);
  if (inputs.intents.length === 0) {
    throw new StageFailure(
      analysisError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        retryable: false,
        safeMessage: "Tell us what you want to understand from these documents, then analyze again.",
        correlationId: context.correlationId,
        diagnosticReason: "intent_missing",
      }),
      null,
    );
  }
  const catalog = context.catalog();
  const payload = await rpc(context.deps.client, "get_doc_extractions_for_run", { p_processing_run_id: context.runId });
  const extracted = extractedDocumentIds(payload);
  const pending = documentsNeedingExtraction(inputs.sourceSnapshot, extracted);
  if (pending.length === 0) {
    return finishExtractingStage(context, inputs.run);
  }
  const invocationStartedAt = context.deps.invocationStartedAt ?? context.startedAt;
  const clock = context.deps.clock ?? (() => Date.now());
  let poolResult: { deferred: boolean };
  try {
    poolResult = await runExtractingWorkerPool({
      deps: context.deps,
      run: inputs.run,
      documents: pending,
      catalog,
      correlationId: context.correlationId,
      now: context.now,
      clock,
      invocationStartedAt,
    });
  } catch (error) {
    if (error instanceof ExtractStageFailure) {
      throw new StageFailure(error.error, error.metric);
    }
    throw error;
  }
  if (poolResult.deferred) {
    return { next: "handoff", status: "EXTRACTING", delaySeconds: 0 };
  }
  return finishExtractingStage(context, inputs.run);
}

async function canonicalizeStudy(context: Context): Promise<StepResult> {
  const inputs = await loadInputs(context.deps.client, context.runId);
  const extractions = await loadVerifiedExtractions(context.deps.client, context.runId);
  if (extractions.length === 0) {
    throw new StageFailure(
      analysisError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        retryable: false,
        safeMessage: MODEL_OUTPUT_MESSAGE,
        correlationId: context.correlationId,
        diagnosticReason: "canonicalize_no_extractions",
      }),
      null,
    );
  }
  // Rebuild Study: re-run CANONICALIZING from cached extractions; re-extract only changed documents (cheap path).
  const result = await runCanonicalizeForRun({
    deps: context.deps,
    run: inputs.run,
    extractions,
    catalog: context.catalog(),
    correlationId: context.correlationId,
    stageAttempt: context.stageAttempt,
    now: context.now,
    rebuildMode: inputs.run.preparationMode === "REBUILD",
  });
  if (!result.ok) {
    throw new StageFailure(result.error, result.metric);
  }
  await advance(context, "CANONICALIZING", "ACCEPTING_STUDY", {
    stage_outputs: { canonicalStudy: result.study },
    stage_metric: result.metric,
  });
  return { next: "handoff", status: "ACCEPTING_STUDY", delaySeconds: 0 };
}

async function acceptV5Study(context: Context, inputs: RunInputs, study: CanonicalStudy): Promise<StepResult> {
  const catalog = context.catalog();
  const canonicalMetric = [...inputs.run.stageMetrics].reverse().find((metric) => metric.stage === "CANONICALIZING" && metric.outcome === "SUCCEEDED");
  const revision = buildV5AcceptRevision({ study, intents: inputs.intents, canonicalMetric, catalog });
  let payload: Record<string, unknown> | null;
  try {
    payload = await rpc(context.deps.client, "accept_study_revision", { p_run_id: context.runId, p_revision: revision });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("study_documents_incomplete")) {
      throw new StageFailure(
        analysisError({
          errorCode: "MODEL_OUTPUT_INVALID",
          category: "MODEL",
          retryable: false,
          safeMessage:
            "The study did not record a document inventory, so it was not accepted. Your earlier study is unchanged.",
          correlationId: context.correlationId,
          diagnosticReason: "study_documents_incomplete",
        }),
        null,
      );
    }
    throw error;
  }
  if (payload?.sourceChanged === true) throw new SourceChanged(true);
  const run = normalizeProcessingRun(payload?.processingRun);
  if (run) log(run, run.status, context.startedAt);
  if (inputs.run.preparationMode !== "REBUILD") {
    const reportRuns = Array.isArray(payload?.reportRuns) ? (payload.reportRuns as { id?: unknown; status?: unknown }[]) : [];
    await Promise.all(
      reportRuns
        .filter((reportRun) => typeof reportRun.id === "string" && reportRun.status === "QUEUED")
        .map((reportRun) =>
          context.deps.dispatch({ kind: "report", id: reportRun.id as string }, context.correlationId, { delaySeconds: 0 }),
        ),
    );
  }
  return { next: "stop", status: run?.status ?? "SUCCEEDED" };
}

async function acceptStudy(context: Context): Promise<StepResult> {
  const loaded = await loadInputs(context.deps.client, context.runId);
  if (isV5CanonicalStudy(loaded.stageOutputs.canonicalStudy)) {
    return acceptV5Study(context, loaded, loaded.stageOutputs.canonicalStudy);
  }
  const { inputs, verified } = await verifiedStudyFromRun(context);
  if (inputs.run.preparationMode === "REBUILD") {
    const assessed = assessDocumentCenteredStudy(verified.investigation);
    if (!assessed.ok) {
      throw new StageFailure(
        analysisError({
          errorCode: "MODEL_OUTPUT_INVALID",
          category: "MODEL",
          retryable: false,
          safeMessage:
            "The study did not record a document inventory and atomic document findings, so it was not accepted. Your earlier study is unchanged.",
          correlationId: context.correlationId,
          diagnosticReason: assessed.diagnosticReason,
        }),
        null,
      );
    }
  }
  const studyMetric = [...inputs.run.stageMetrics].reverse().find((metric) => metric.stage === "INVESTIGATING" && metric.outcome === "SUCCEEDED");
  const revision = {
    p_run_id: context.runId,
    p_revision: {
      investigation: verified.investigation,
      verification: verified.verification,
      audience_configuration: resolveAudienceConfiguration({
        analysis: inputs.stageOutputs.intentDecomposition,
        intelligence: inputs.stageOutputs.intentIntelligence,
      }),
      investigation_digest: sha256Digest(canonicalJson(verified.investigation)),
      model_alias: studyMetric?.modelAliasRequested ?? null,
      resolved_model: studyMetric?.resolvedModel ?? null,
    },
  };
  let payload: Record<string, unknown> | null;
  try {
    payload = await rpc(context.deps.client, "accept_study_revision", revision);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("study_documents_incomplete")) {
      throw new StageFailure(
        analysisError({
          errorCode: "MODEL_OUTPUT_INVALID",
          category: "MODEL",
          retryable: false,
          safeMessage:
            "The study did not record a document inventory and atomic document findings, so it was not accepted. Your earlier study is unchanged.",
          correlationId: context.correlationId,
          diagnosticReason: "study_documents_incomplete",
        }),
        null,
      );
    }
    throw error;
  }
  if (payload?.sourceChanged === true) throw new SourceChanged(true);
  const run = normalizeProcessingRun(payload?.processingRun);
  if (run) log(run, run.status, context.startedAt);
  if (inputs.run.preparationMode !== "REBUILD") {
    const reportRuns = Array.isArray(payload?.reportRuns) ? (payload.reportRuns as { id?: unknown; status?: unknown }[]) : [];
    await Promise.all(
      reportRuns
        .filter((reportRun) => typeof reportRun.id === "string" && reportRun.status === "QUEUED")
        .map((reportRun) =>
          context.deps.dispatch({ kind: "report", id: reportRun.id as string }, context.correlationId, { delaySeconds: 0 }),
        ),
    );
  }
  return { next: "stop", status: run?.status ?? "SUCCEEDED" };
}

async function runStage(context: Context, run: ProcessingRun): Promise<StepResult> {
  switch (run.status) {
    case "QUEUED":
      if (run.snapshotFrozen) {
        return { next: "continue", run: await advance(context, "QUEUED", "EXTRACTING") };
      }
      return { next: "continue", run: await advance(context, "QUEUED", "READING_DOCUMENTS") };
    case "READING_DOCUMENTS":
      return readDocuments(context, run);
    case "EXTRACTING":
      return extractDocuments(context);
    case "CANONICALIZING":
      return canonicalizeStudy(context);
    case "UNDERSTANDING_REQUEST":
      return understandRequest(context);
    case "IDENTIFYING_DOMAIN":
      return identifyDomain(context);
    case "DEVELOPING_QUESTIONS":
      return developQuestions(context);
    case "PLANNING_INVESTIGATION":
      return resolveLegacyPlanning(context);
    case "BUILDING_PROMPT":
    case "SAVING":
      return buildAndSavePrompt(context, run.status);
    case "INVESTIGATING":
      return investigate(context);
    case "VERIFYING_EVIDENCE":
      return verifyEvidence(context);
    case "ACCEPTING_STUDY":
      return acceptStudy(context);
    default:
      return { next: "stop", status: run.status };
  }
}

async function failRun(context: Context, status: ProcessingRunStatus, run: ProcessingRun, error: unknown): Promise<ProcessingRunStatus | null> {
  const client = context.deps.client;
  const sourceChanged =
    error instanceof SourceChanged
      ? error
      : isHiveError(error) && error.diagnosticReason === "source_changed"
        ? new SourceChanged(false)
        : null;
  if (sourceChanged) {
    const sourceFailure = {
      errorCode: "SOURCE_CHANGED",
      retryable: true,
      diagnosticReason: "source_changed",
    };
    if (!sourceChanged.alreadyFailed) {
      await transition(client, context.runId, status, "FAILED", {
        error_code: "SOURCE_CHANGED",
        error_message_safe: SOURCE_CHANGED_MESSAGE,
        retryable: true,
        failure_diagnostic: persistedDiagnostic({ ...sourceFailure, stage: status, attempt: run.stageAttempt }),
      });
    }
    log(run, "FAILED", context.startedAt, sourceFailure, status);
    return "FAILED";
  }
  const failure =
    error instanceof StageFailure
      ? error
      : new StageFailure(
          isHiveError(error) ? error : unexpectedAnalysisFailure(context.correlationId, error),
          null,
        );
  const failureStage = failure.metric?.stage ?? status;
  const unexpected = unexpectedExceptionObservability(failure.hiveError);
  const diagnostic = persistedDiagnostic({
    stage: failureStage,
    errorCode: failure.hiveError.errorCode,
    diagnosticReason: failure.hiveError.diagnosticReason ?? "unexpected_exception",
    diagnosticField: failure.hiveError.diagnosticField ?? unexpected?.diagnosticField ?? null,
    retryable: failure.hiveError.retryable,
    attempt: failure.metric?.attempt ?? run.stageAttempt,
  });
  const details = {
    error_code: failure.hiveError.errorCode,
    error_message_safe: failure.hiveError.safeMessage,
    retryable: failure.hiveError.retryable,
    ...(failure.metric ? { stage_metric: failure.metric } : {}),
    ...(diagnostic ? { failure_diagnostic: diagnostic } : {}),
  };
  if (stageFailureRetryable(failure.hiveError)) {
    const payload = await rpc(client, "retry_processing_run_stage", { p_run_id: context.runId, p_status: status, p_details: details });
    const retried = payload?.retried === true;
    log(run, retried ? `${status}_retry` : "FAILED", context.startedAt, failure.hiveError, failureStage);
    if (retried) {
      const updated = normalizeProcessingRun(payload?.processingRun);
      const delaySeconds = updated ? 20 * Math.max(1, updated.stageAttempt - 1) : 20;
      await context.deps.dispatch({ kind: "analysis", id: context.runId }, context.correlationId, { delaySeconds });
      return status;
    }
    return "FAILED";
  }
  const result = await transition(client, context.runId, status, "FAILED", details);
  log(run, "FAILED", context.startedAt, failure.hiveError, failureStage);
  return result.applied || result.run?.status === "FAILED" ? "FAILED" : null;
}

/**
 * Runs the stages one invocation may run for this run. Safe to call for any run id at any time:
 * the claim is compare-and-set, so a duplicate or late invocation does nothing.
 */
export async function processAnalysisRun(deps: AnalysisWorkflowDeps, runId: string): Promise<ProcessingRunStatus | null> {
  const claim = await rpc(deps.client, "claim_processing_run", { p_run_id: runId });
  let run = normalizeProcessingRun(claim?.processingRun);
  if (claim?.claimed !== true || !run) return run?.status ?? null;

  let catalog: PromptCatalog | null = null;
  const context: Context = {
    deps,
    runId,
    correlationId: run.correlationId,
    catalog: () => (catalog ??= (deps.loadCatalog ?? loadPromptCatalog)()),
    now: deps.now ?? (() => new Date()),
    startedAt: Date.now(),
    stageAttempt: run.stageAttempt,
    status: run.status,
  };

  for (let step = 0; step < MAX_STEPS_PER_INVOCATION; step += 1) {
    context.status = run.status;
    let result: StepResult;
    try {
      result = await runStage(context, run);
    } catch (error) {
      try {
        return await failRun(context, context.status, run, error);
      } catch {
        // The lease lapses until it expires or another invocation claims the run.
        return null;
      }
    }
    if (result.next === "continue") {
      run = result.run;
      continue;
    }
    if (result.next === "handoff") {
      await rpc(deps.client, "release_processing_run", {
        p_run_id: runId,
        p_status: result.status,
        p_delay_seconds: result.delaySeconds,
      }).catch(() => null);
      await deps.dispatch({ kind: "analysis", id: runId }, context.correlationId, { delaySeconds: result.delaySeconds });
      return result.status;
    }
    return result.status;
  }
  await rpc(deps.client, "release_processing_run", { p_run_id: runId, p_status: run.status, p_delay_seconds: 0 }).catch(() => null);
  await deps.dispatch({ kind: "analysis", id: runId }, context.correlationId, { delaySeconds: 0 });
  return run.status;
}

/** Never throws, so it is safe inside `after()`. */
export async function processAnalysisRunSafely(deps: AnalysisWorkflowDeps, runId: string): Promise<void> {
  await processAnalysisRun(deps, runId).catch(() => null);
}
