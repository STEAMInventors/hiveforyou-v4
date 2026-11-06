import {
  type CanonicalStudy,
  createHiveError,
  type HiveError,
  MIN_PLANNER_CALL_MS,
  type ReportAudience,
  type StudyView,
  type StudyViewContext,
  type StudyViewDrops,
  type WriteFactRecord,
  type WriteOutput,
  V5_CLIENT_TASK_TIMEOUT_MS,
  buildStudyView,
  parseWriteOutput,
} from "@hiveforyou/contracts";

import { callPlanner, type PlannerDeps } from "@/server/study-preparation/planner-client";
import { type WritePrompt, loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";

/** Planner failures that mean the model answered but the answer was not a usable JSON object. */
const UNPARSEABLE_REASONS = new Set(["model_output_not_json", "model_output_invalid", "model_content_missing"]);

const TRUNCATION_REASON = "model_output_truncated";

export type WriteCallRecord = {
  readonly attempt: 1 | 2;
  readonly outcome: "ok" | "unparseable" | "failed";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number | null;
  readonly roundTripMs: number;
  readonly finishReason: string | null;
  readonly modelAlias: string | null;
  readonly resolvedModel: string | null;
  readonly errorCode: string | null;
  readonly diagnosticReason: string | null;
};

type CallInput = {
  readonly planner: PlannerDeps;
  readonly correlationId: string;
  readonly runId: string;
};

export type WriteStudyInput = CallInput & {
  readonly canonicalStudy: CanonicalStudy;
  readonly facts: readonly WriteFactRecord[];
  readonly reportRole: ReportAudience;
  readonly audience: string;
  readonly intent: string;
  /** Optional view context (intent on the view, referenced documents for gap grouping). */
  readonly studyViewContext?: StudyViewContext;
  readonly prompt?: WritePrompt;
  /**
   * Absolute time by which the write HTTP call must have aborted, at least 30s before the route's
   * maxDuration, so a timeout can be stored before the platform kills the function.
   */
  readonly deadlineMs?: number;
  readonly resolvePlannerTimeoutMs?: () => number | "expired";
  readonly clock?: () => number;
};

export type WriteStudyResult =
  | {
      ok: true;
      view: StudyView;
      drops: StudyViewDrops;
      malformed: Record<string, number>;
      calls: WriteCallRecord[];
    }
  | { ok: false; error: HiveError; calls: WriteCallRecord[] };

/** Payload for `hive-write/1`: verified canonical study, fact snippets only, intent and audience. */
export function buildWritePayload(
  canonicalStudy: CanonicalStudy,
  facts: readonly WriteFactRecord[],
  reportRole: ReportAudience,
  audience: string,
  intent: string,
) {
  return {
    canonicalStudy,
    facts: facts.map((fact) => ({
      id: fact.id,
      subject: fact.subject,
      attribute: fact.attribute,
      valueAsWritten: fact.valueAsWritten,
      quote: fact.quote,
    })),
    reportRole,
    audience: audience.trim(),
    intent: intent.trim(),
  };
}

/** Builds fact snippets from verified extractions for the write stage (first quote only). */
export function factRecordsFromExtractions(
  extractions: readonly { readonly documentId: string; readonly facts: readonly { readonly id: string; readonly subject: string; readonly attribute: string; readonly valueAsWritten: string; readonly evidence: readonly { readonly page: number; readonly quote: string }[] }[] }[],
): WriteFactRecord[] {
  return extractions.flatMap((extraction) =>
    extraction.facts.map((fact) => ({
      id: fact.id,
      subject: fact.subject,
      attribute: fact.attribute,
      valueAsWritten: fact.valueAsWritten,
      sourceDocumentId: extraction.documentId,
      pageNumber: fact.evidence[0]?.page ?? 0,
      quote: fact.evidence[0]?.quote ?? "",
    })),
  );
}

function asHiveError(error: unknown): HiveError | null {
  return error && typeof error === "object" && "errorCode" in error && "stage" in error ? (error as HiveError) : null;
}

const RETRY_NOTE = (reason: string) =>
  `Your previous answer could not be used (${reason}). Return only the JSON object described in the instructions, with no text before or after it.`;

function timeoutError(correlationId: string, runId: string): HiveError {
  return createHiveError({
    errorCode: "MODEL_TIMEOUT",
    category: "DEPENDENCY",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "The analysis model took too long to answer. You can try again.",
    correlationId,
    operationId: runId,
    diagnosticReason: "planner_timeout",
  });
}

function failedCall(attempt: 1 | 2, errorCode: string, reason: string, roundTripMs: number): WriteCallRecord {
  return {
    attempt,
    outcome: "failed",
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
    roundTripMs,
    finishReason: null,
    modelAlias: null,
    resolvedModel: null,
    errorCode,
    diagnosticReason: reason,
  };
}

function plannerCallTimeoutMs(input: {
  readonly resolvePlannerTimeoutMs?: () => number | "expired";
  readonly deadlineMs?: number;
  readonly clock?: () => number;
}): number | "default" | "expired" {
  const now = (input.clock ?? Date.now)();
  const safeNow = Number.isFinite(now) ? now : Date.now();
  let budgetMs: number | "default" = "default";
  if (input.resolvePlannerTimeoutMs) {
    const computed = input.resolvePlannerTimeoutMs();
    if (computed === "expired") return "expired";
    if (typeof computed !== "number" || !Number.isFinite(computed) || computed < MIN_PLANNER_CALL_MS) {
      return "expired";
    }
    budgetMs = computed;
  }
  if (input.deadlineMs !== undefined) {
    if (!Number.isFinite(input.deadlineMs)) return "expired";
    const remaining = Math.floor(input.deadlineMs - safeNow);
    if (!Number.isFinite(remaining) || remaining < MIN_PLANNER_CALL_MS) return "expired";
    budgetMs =
      budgetMs === "default"
        ? Math.min(remaining, V5_CLIENT_TASK_TIMEOUT_MS)
        : Math.min(budgetMs, remaining);
  }
  if (budgetMs === "default") return "default";
  if (!Number.isFinite(budgetMs) || budgetMs < MIN_PLANNER_CALL_MS) return "expired";
  return budgetMs;
}

async function callWithRetry(
  input: CallInput & {
    prompt: WritePrompt;
    payload: Record<string, unknown>;
    deadlineMs?: number;
    resolvePlannerTimeoutMs?: () => number | "expired";
    clock?: () => number;
  },
  calls: WriteCallRecord[],
): Promise<{ ok: true; value: WriteOutput; malformed: Record<string, number> } | { ok: false; error: HiveError }> {
  const clock = input.clock ?? Date.now;
  let parseError: string | null = null;
  for (const attempt of [1, 2] as const) {
    const started = clock();
    const timeoutMs = plannerCallTimeoutMs(input);
    if (timeoutMs === "expired") {
      calls.push(failedCall(attempt, "MODEL_TIMEOUT", "planner_timeout", Math.max(0, clock() - started)));
      return { ok: false, error: timeoutError(input.correlationId, input.runId) };
    }
    const userPayload = parseError === null ? input.payload : { ...input.payload, retryNote: RETRY_NOTE(parseError) };
    try {
      const completion = await callPlanner(input.planner, {
        prompt: input.prompt,
        userPayload,
        correlationId: input.correlationId,
        processingRunId: input.runId,
        ...(timeoutMs === "default" ? {} : { timeoutMs }),
      });
      const parsed = parseWriteOutput(completion.contentJson);
      calls.push({
        attempt,
        outcome: parsed.ok ? "ok" : "unparseable",
        inputTokens: completion.usage.promptTokens,
        outputTokens: completion.usage.completionTokens,
        latencyMs: completion.latencyMs,
        roundTripMs: completion.roundTripMs,
        finishReason: completion.finishReason,
        modelAlias: completion.modelAlias,
        resolvedModel: completion.resolvedModel,
        errorCode: null,
        diagnosticReason: parsed.ok ? null : parsed.message,
      });
      if (parsed.ok) return { ok: true, value: parsed.value, malformed: parsed.malformed };
      parseError = parsed.message;
    } catch (error) {
      const hiveError = asHiveError(error);
      if (!hiveError) throw error;
      const reason = hiveError.diagnosticReason ?? "";
      const unparseable = hiveError.errorCode === "MODEL_OUTPUT_INVALID" && UNPARSEABLE_REASONS.has(reason);
      calls.push({
        attempt,
        outcome: unparseable ? "unparseable" : "failed",
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        roundTripMs: Date.now() - started,
        finishReason: null,
        modelAlias: null,
        resolvedModel: null,
        errorCode: hiveError.errorCode,
        diagnosticReason: reason || null,
      });
      if (hiveError.errorCode === "MODEL_TIMEOUT" || reason === TRUNCATION_REASON) {
        return { ok: false, error: hiveError };
      }
      if (!unparseable) return { ok: false, error: hiveError };
      parseError = reason;
    }
  }
  return {
    ok: false,
    error: createHiveError({
      errorCode: "MODEL_OUTPUT_INVALID",
      category: "MODEL",
      stage: "MERGE",
      retryable: false,
      safeMessage: "The model returned an answer we couldn't use.",
      correlationId: input.correlationId,
      operationId: input.runId,
      diagnosticReason: "write_unparseable_after_retry",
    }),
  };
}

/** Runs `hive-write/1` once (retry only on unusable JSON), then `buildStudyView`. */
export async function writeStudyView(input: WriteStudyInput): Promise<WriteStudyResult> {
  const prompt = input.prompt ?? loadPromptCatalog().write;
  const payload = buildWritePayload(input.canonicalStudy, input.facts, input.reportRole, input.audience, input.intent);
  const calls: WriteCallRecord[] = [];
  const outcome = await callWithRetry(
    {
      ...input,
      prompt,
      payload,
      deadlineMs: input.deadlineMs,
      resolvePlannerTimeoutMs: input.resolvePlannerTimeoutMs,
      clock: input.clock,
    },
    calls,
  );
  if (!outcome.ok) return { ok: false, error: outcome.error, calls };
  const context: StudyViewContext = {
    ...(input.studyViewContext ?? {}),
    ...(input.intent.trim() !== "" ? { intent: input.intent.trim() } : {}),
  };
  const { view, drops } = buildStudyView(input.canonicalStudy, outcome.value, input.facts, outcome.malformed, context);
  return { ok: true, view, drops, malformed: outcome.malformed, calls };
}
