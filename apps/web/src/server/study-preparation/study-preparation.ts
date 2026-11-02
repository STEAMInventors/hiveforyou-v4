import {
  createHiveError,
  type DomainProposal,
  type GetStudyPreparationResponse,
  type HiveError,
  type IntentAnalysis,
  type IntentIntelligence,
  type InvestigationPlan,
  isValidUuid,
  type ModelStageStatus,
  normalizeGetStudyPreparationResponse,
  type PlannerTask,
  normalizeProcessingRun,
  type ProcessingRun,
  type ProcessingRunStatus,
  type SampleCoverage,
  type SourceSnapshot,
  type StageMetric,
  type StartStudyPreparationResponse,
  type StoredIntent,
  validateDomainProposal,
  validateExecutionManifest,
  validateIntentAnalysis,
  validateIntentIntelligence,
  validateInvestigationPlan,
  validateStartStudyPreparationInput,
} from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";
import type { DocumentPageRpcClient } from "@/server/source-documents/document-pages-persistence";

import { loadFrozenSampleDocuments, selectDomainSamples } from "./page-sampling";
import { callPlanner, type PlannerCallResult, type PlannerDeps } from "./planner-client";
import { loadPromptCatalog, type PromptCatalog, sha256Digest } from "./prompt-catalog";
import {
  applyProvisionalDomainToIntentSystemPrompt,
  type ProvisionalDomainContext,
  parseProvisionalDomainContextFromInputs,
} from "./provisional-domain-context";
import { buildStudyPrompt } from "./study-prompt-builder";

export type StudyPreparationRpcClient = DocumentPageRpcClient;

export type ProcessStudyPreparationDeps = {
  readonly client: StudyPreparationRpcClient;
  readonly planner: PlannerDeps;
  readonly loadCatalog?: () => PromptCatalog;
  readonly now?: () => Date;
};

const STOPPED_MESSAGE = "Preparation stopped before it finished. You can try again.";
const MODEL_OUTPUT_MESSAGE = "The analysis model returned an answer we couldn't use. You can try again.";
const SAVE_FAILED_MESSAGE = "We couldn't save your study prompt. You can try again.";

// ---------------------------------------------------------------------------
// Owner operations (authenticated client)
// ---------------------------------------------------------------------------
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
  if (message.includes("document_read_active")) {
    return ownerError(
      "INVALID_REQUEST",
      "VALIDATION",
      "Wait for document reading to finish, then analyze.",
      "document_read_active",
      correlationId,
    );
  }
  if (message.includes("no_eligible_documents")) {
    return ownerError(
      "COVERAGE_INCOMPLETE",
      "DOCUMENT",
      "Read at least one document before analyzing.",
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

/** Starts (or replays) one preparation run. `process` is true only for a newly queued run. */
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
    process: created && processingRun.status === "QUEUED",
  };
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

// ---------------------------------------------------------------------------
// Worker (service-role client, inside `after()`)
// ---------------------------------------------------------------------------
type StageOutputs = {
  intentDecomposition?: IntentAnalysis;
  domainProposal?: DomainProposal;
  sampleCoverage?: SampleCoverage;
  intentIntelligence?: IntentIntelligence;
  investigationPlan?: InvestigationPlan;
};

type TransitionDetails = {
  readonly stage_outputs?: StageOutputs;
  readonly stage_metric?: StageMetric;
  readonly prompt_digest?: string;
  readonly error_code?: string;
  readonly error_message_safe?: string;
  readonly retryable?: boolean;
};

type TransitionResult = { applied: boolean; sourceChanged: boolean; run: ProcessingRun | null };

type PreparationInputs = {
  run: ProcessingRun;
  sourceSnapshot: SourceSnapshot;
  sourceSnapshotDigest: string;
  intentSnapshotDigest: string;
  coverageDigest: string;
  intents: StoredIntent[];
  provisionalDomain: ProvisionalDomainContext;
};

/** Internal failure carrying the stage metric for a failed model stage. */
class StageFailure extends Error {
  constructor(
    readonly hiveError: HiveError,
    readonly metric: StageMetric | null,
  ) {
    super(hiveError.errorCode);
  }
}

/** `alreadyFailed`: the database failed the run itself (SOURCE_CHANGED) during a transition. */
class SourceChanged extends Error {
  constructor(readonly alreadyFailed: boolean) {
    super("source_changed");
  }
}

const SOURCE_CHANGED_MESSAGE =
  "Your documents or request changed while preparing. Analyze again to use the latest versions.";

async function transition(
  client: StudyPreparationRpcClient,
  runId: string,
  from: ProcessingRunStatus,
  to: ProcessingRunStatus,
  details: TransitionDetails = {},
): Promise<TransitionResult> {
  const { data, error } = await client.rpc("transition_processing_run", {
    p_run_id: runId,
    p_from_status: from,
    p_to_status: to,
    p_details: details,
  });
  if (error) throw new Error(error.message ?? "transition_processing_run failed");
  const payload = parsePayload(data);
  return {
    applied: payload?.applied === true,
    sourceChanged: payload?.sourceChanged === true,
    run: normalizeProcessingRun(payload?.processingRun),
  };
}

async function loadInputs(client: StudyPreparationRpcClient, runId: string): Promise<PreparationInputs> {
  const { data, error } = await client.rpc("get_study_preparation_inputs", { p_run_id: runId });
  if (error) throw new Error(error.message ?? "get_study_preparation_inputs failed");
  const payload = parsePayload(data);
  const run = normalizeProcessingRun(payload?.processingRun);
  const snapshot = payload?.sourceSnapshot as SourceSnapshot | undefined;
  const intents = Array.isArray(payload?.intents) ? (payload.intents as Record<string, unknown>[]) : null;
  if (!run || !snapshot || !Array.isArray(snapshot.documents) || !Array.isArray(snapshot.excluded) || !intents) {
    throw new Error("unexpected_inputs_shape");
  }
  if (payload?.snapshotCurrent === false) throw new SourceChanged(false);
  const payloadRecord = payload ?? {};
  return {
    run,
    sourceSnapshot: snapshot,
    sourceSnapshotDigest: String(payload?.sourceSnapshotDigest),
    intentSnapshotDigest: String(payload?.intentSnapshotDigest),
    coverageDigest: String(payload?.coverageDigest),
    provisionalDomain: parseProvisionalDomainContextFromInputs(payloadRecord),
    intents: intents
      .filter((intent) => typeof intent.id === "string" && typeof intent.intentText === "string")
      .map((intent) => ({
        id: (intent.id as string).toLowerCase(),
        intentText: intent.intentText as string,
        audience: typeof intent.audience === "string" && intent.audience.trim() ? intent.audience : null,
      })),
  };
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

function log(input: {
  readonly run: Pick<ProcessingRun, "id" | "hiveId" | "correlationId" | "attemptNumber">;
  readonly status: ProcessingRunStatus;
  readonly startedAt: number;
  readonly error?: HiveError;
}): void {
  emitStructuredEvent({
    eventName: `studyPreparation.${input.status.toLowerCase()}`,
    severity: input.status === "FAILED" ? "ERROR" : "INFO",
    timestamp: new Date().toISOString(),
    component: "studyPreparation",
    operation: "prepareStudy",
    stage: "ANALYZE",
    correlationId: input.run.correlationId,
    hiveId: input.run.hiveId,
    processingRunId: input.run.id,
    attempt: input.run.attemptNumber,
    status: input.status,
    durationMs: Date.now() - input.startedAt,
    ...(input.error
      ? {
          errorCode: input.error.errorCode,
          retryable: input.error.retryable,
          diagnosticReason: input.error.diagnosticReason ?? "unexpected_exception",
        }
      : {}),
  });
}

/**
 * Runs one queued preparation to a terminal status. Each model output is validated before it is
 * saved, each stage starts only after the previous output is persisted, and the run succeeds only
 * after the saved preview is read back and matches what was built.
 */
export async function processStudyPreparation(
  deps: ProcessStudyPreparationDeps,
  runId: string,
): Promise<ProcessingRunStatus | null> {
  const startedAt = Date.now();
  const now = deps.now ?? (() => new Date());
  const claim = await transition(deps.client, runId, "QUEUED", "UNDERSTANDING_REQUEST");
  if (!claim.applied || !claim.run) return claim.run?.status ?? null;

  const run = claim.run;
  const correlationId = run.correlationId;
  let current: ProcessingRunStatus = "UNDERSTANDING_REQUEST";
  log({ run, status: current, startedAt });

  const advance = async (to: ProcessingRunStatus, details: TransitionDetails = {}) => {
    const result = await transition(deps.client, runId, current, to, details);
    if (result.sourceChanged) throw new SourceChanged(true);
    if (!result.applied) {
      throw new StageFailure(
        createHiveError({
          errorCode: "INTERNAL_ERROR",
          category: "INTERNAL",
          stage: "ANALYZE",
          retryable: true,
          safeMessage: STOPPED_MESSAGE,
          correlationId,
          diagnosticReason: "stage_transition_rejected",
        }),
        null,
      );
    }
    current = to;
    log({ run, status: to, startedAt });
  };

  const modelStage = async <T>(
    stage: ModelStageStatus,
    task: PlannerTask,
    catalog: PromptCatalog,
    userPayload: Record<string, unknown>,
    validate: (raw: unknown) => { ok: true; value: T } | { ok: false; message: string; diagnosticReason: string },
    options: { readonly systemPrompt?: string } = {},
  ): Promise<{ value: T; metric: StageMetric }> => {
    const basePrompt = catalog.planner[task];
    const prompt = options.systemPrompt ? { ...basePrompt, systemPrompt: options.systemPrompt } : basePrompt;
    const stageStartedAt = now().toISOString();
    const baseMetric: StageMetric = {
      stage,
      promptId: prompt.id,
      promptDigest: prompt.digest,
      modelAliasRequested: null,
      startedAt: stageStartedAt,
    };
    let completion: PlannerCallResult;
    try {
      completion = await callPlanner(deps.planner, { prompt, userPayload, correlationId, processingRunId: runId });
    } catch (error) {
      const hiveError = isHiveError(error) ? error : null;
      throw new StageFailure(
        hiveError ??
          createHiveError({
            errorCode: "MODEL_UNAVAILABLE",
            category: "DEPENDENCY",
            stage: "ANALYZE",
            retryable: true,
            safeMessage: "The analysis service is temporarily unavailable. You can try again.",
            correlationId,
            diagnosticReason: "planner_unavailable",
            cause: error,
          }),
        {
          ...baseMetric,
          outcome: "FAILED",
          completedAt: now().toISOString(),
          errorCode: hiveError?.errorCode ?? "MODEL_UNAVAILABLE",
          retryable: hiveError?.retryable ?? true,
        },
      );
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
      completedAt: now().toISOString(),
    };
    const validated = validate(completion.contentJson);
    if (!validated.ok) {
      throw new StageFailure(
        createHiveError({
          errorCode: "MODEL_OUTPUT_INVALID",
          category: "MODEL",
          stage: "ANALYZE",
          retryable: true,
          safeMessage: MODEL_OUTPUT_MESSAGE,
          correlationId,
          diagnosticReason: validated.diagnosticReason,
        }),
        { ...metric, outcome: "FAILED", errorCode: "MODEL_OUTPUT_INVALID", retryable: true },
      );
    }
    return { value: validated.value, metric: { ...metric, outcome: "SUCCEEDED" } };
  };

  try {
    const catalog = (deps.loadCatalog ?? loadPromptCatalog)();
    const inputs = await loadInputs(deps.client, runId);
    if (inputs.intents.length === 0) {
      throw ownerError(
        "INVALID_REQUEST",
        "VALIDATION",
        "Tell us what you want to understand from these documents, then analyze again.",
        "intent_missing",
        correlationId,
      );
    }
    const intentPayload = inputs.intents.map((intent) => ({
      intentRequestId: intent.id,
      intentText: intent.intentText,
      audience: intent.audience,
    }));
    const provisionalDomain = inputs.provisionalDomain;
    const documents = documentSummaries(inputs.sourceSnapshot);
    const sampleCoverageSummary = {
      complete: inputs.sourceSnapshot.coverageComplete,
      excludedDocumentCount: inputs.sourceSnapshot.excluded.length,
    };

    // 1. Understanding your request — hive.intent-analysis/1 (no document text).
    const intentSystemPrompt = applyProvisionalDomainToIntentSystemPrompt(
      catalog.planner.intent.systemPrompt,
      provisionalDomain,
    );
    const analysis = await modelStage(
      "UNDERSTANDING_REQUEST",
      "intent",
      catalog,
      {
        task: "intent",
        processingRunId: runId,
        requests: intentPayload,
        domainContext: provisionalDomain,
      },
      (raw) => validateIntentAnalysis(raw, { intents: inputs.intents, processingRunId: runId }),
      { systemPrompt: intentSystemPrompt },
    );
    await advance("IDENTIFYING_DOMAIN", {
      stage_outputs: { intentDecomposition: analysis.value },
      stage_metric: analysis.metric,
    });

    // 2. Identifying the domain — hive-domain/1 over a deterministic sample of frozen pages.
    const sampleDocuments = await loadFrozenSampleDocuments(deps.client, {
      hiveId: run.hiveId,
      documents: inputs.sourceSnapshot.documents,
      correlationId,
    });
    const { samples, coverage } = selectDomainSamples(sampleDocuments);
    const sampledRefs = samples.map((sample) => ({ sourceDocumentId: sample.sourceDocumentId, pageNumber: sample.pageNumber }));
    const domain = await modelStage(
      "IDENTIFYING_DOMAIN",
      "domain",
      catalog,
      { task: "domain", intents: intentPayload, documents, samples, coverage: sampleCoverageSummary },
      (raw) => validateDomainProposal(raw, { sampledRefs }),
    );
    await advance("DEVELOPING_QUESTIONS", {
      stage_outputs: { domainProposal: domain.value, sampleCoverage: coverage },
      stage_metric: domain.metric,
    });

    // 3. Developing specialist questions — hive-intent-intelligence/1 from the validated intent,
    //    domain and the same page sample.
    const intelligence = await modelStage(
      "DEVELOPING_QUESTIONS",
      "intelligence",
      catalog,
      {
        task: "intelligence",
        intents: inputs.intents.map((intent) => ({
          intentRequestId: intent.id,
          intentText: intent.intentText,
          audience: intent.audience,
        })),
        intentDecomposition: analysis.value,
        domain: domain.value,
        documents,
        samples,
        coverage: sampleCoverageSummary,
      },
      (raw) => validateIntentIntelligence(raw, { analysis: analysis.value, sampledRefs }),
    );
    await advance("PLANNING_INVESTIGATION", {
      stage_outputs: { intentIntelligence: intelligence.value },
      stage_metric: intelligence.metric,
    });

    // 4. Planning the investigation — hive-plan/1 from the validated intent, specialist questions and domain.
    const plan = await modelStage(
      "PLANNING_INVESTIGATION",
      "plan",
      catalog,
      {
        task: "plan",
        intentDecomposition: analysis.value,
        intentIntelligence: intelligence.value,
        domain: domain.value,
        documents,
        coverage: {
          complete: inputs.sourceSnapshot.coverageComplete,
          excludedDocuments: inputs.sourceSnapshot.excluded.map((document) => ({
            sourceDocumentId: document.sourceDocumentId,
            reason: document.reason,
          })),
        },
      },
      (raw) =>
        validateInvestigationPlan(raw, {
          analysis: analysis.value,
          intelligence: intelligence.value,
          domain: domain.value,
        }),
    );
    await advance("BUILDING_PROMPT", { stage_outputs: { investigationPlan: plan.value }, stage_metric: plan.metric });

    // 5. Constructing your study prompt — deterministic hive-study-preview/1, saved and read back.
    const built = buildStudyPrompt({
      processingRunId: runId,
      catalog,
      analysis: analysis.value,
      intelligence: intelligence.value,
      domain: domain.value,
      plan: plan.value,
      sourceSnapshot: inputs.sourceSnapshot,
      sourceSnapshotDigest: inputs.sourceSnapshotDigest,
      intentSnapshotDigest: inputs.intentSnapshotDigest,
      coverageDigest: inputs.coverageDigest,
      intentRequestIds: inputs.run.intentRequestIds,
    });
    await advance("SAVING");
    await savePreview(deps.client, runId, built, correlationId);
    await advance("SUCCEEDED", { prompt_digest: built.promptDigest });
    return current;
  } catch (error) {
    const sourceChanged =
      error instanceof SourceChanged
        ? error
        : isHiveError(error) && error.diagnosticReason === "source_changed"
          ? new SourceChanged(false)
          : null;
    if (sourceChanged?.alreadyFailed) {
      log({ run, status: "FAILED", startedAt });
      return "FAILED";
    }
    if (sourceChanged) {
      try {
        await transition(deps.client, runId, current, "FAILED", {
          error_code: "SOURCE_CHANGED",
          error_message_safe: SOURCE_CHANGED_MESSAGE,
          retryable: true,
        });
        log({ run, status: "FAILED", startedAt });
        return "FAILED";
      } catch {
        return null;
      }
    }
    const failure =
      error instanceof StageFailure
        ? error
        : new StageFailure(
            isHiveError(error)
              ? error
              : createHiveError({
                  errorCode: "INTERNAL_ERROR",
                  category: "INTERNAL",
                  stage: "ANALYZE",
                  retryable: true,
                  safeMessage: STOPPED_MESSAGE,
                  correlationId,
                  diagnosticReason: "unexpected_exception",
                  cause: error,
                }),
            null,
          );
    try {
      const result = await transition(deps.client, runId, current, "FAILED", {
        error_code: failure.hiveError.errorCode,
        error_message_safe: failure.hiveError.safeMessage,
        retryable: failure.hiveError.retryable,
        ...(failure.metric ? { stage_metric: failure.metric } : {}),
      });
      log({ run, status: "FAILED", startedAt, error: failure.hiveError });
      return result.applied || result.run?.status === "FAILED" ? "FAILED" : null;
    } catch {
      // The run's lease expires and get_study_preparation marks it FAILED (interrupted).
      return null;
    }
  }
}

async function savePreview(
  client: StudyPreparationRpcClient,
  runId: string,
  built: ReturnType<typeof buildStudyPrompt>,
  correlationId: string,
): Promise<void> {
  const saveFailed = (diagnosticReason: string, cause?: unknown) =>
    createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: SAVE_FAILED_MESSAGE,
      correlationId,
      diagnosticReason,
      cause,
    });

  if (!validateExecutionManifest(built.executionManifest).ok) throw saveFailed("artifact_hash_mismatch");

  const saved = await client.rpc("save_study_prompt_preview", {
    p_run_id: runId,
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

  const readback = await client.rpc("read_study_prompt_preview", { p_run_id: runId });
  if (readback.error) throw saveFailed("persistence_failed", readback.error);
  const payload = parsePayload(readback.data);
  const preview = payload?.preview as Record<string, unknown> | undefined;
  const manifest = validateExecutionManifest(preview?.executionManifest);
  if (
    payload?.found !== true ||
    !preview ||
    String(preview.processingRunId).toLowerCase() !== runId.toLowerCase() ||
    preview.promptText !== built.promptText ||
    preview.promptDigest !== built.promptDigest ||
    sha256Digest(String(preview.promptText)) !== built.promptDigest ||
    !manifest.ok ||
    manifest.value.prompt.promptDigest !== built.promptDigest
  ) {
    throw saveFailed("preview_readback_mismatch");
  }
}

/** Never throws, so it is safe inside `after()`. */
export async function processStudyPreparationSafely(
  deps: ProcessStudyPreparationDeps,
  runId: string,
): Promise<void> {
  await processStudyPreparation(deps, runId).catch(() => null);
}
