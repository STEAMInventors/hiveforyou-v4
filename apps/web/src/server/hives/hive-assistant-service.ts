import { loadSupabaseAdminEnv } from "@hives/persistence/env";
import { createSupabaseAdminClient } from "@hives/persistence/storage/supabase-client";
import {
  ASSISTANT_REPLY_PROMPT_ID,
  buildAssistantBriefing,
  canonicalStudyDocumentRoleLabel,
  buildUnexpectedExceptionDiagnostics,
  HIVE_MESSAGE_PAGE_SIZE,
  isErrorCategory,
  isErrorCode,
  isProcessingStage,
  mapLegacyAssistantFactRefs,
  normalizeGetStudyTabViewResponse,
  normalizeHiveMessagePage,
  normalizeListRequestsResponse,
  revisionIdForAssistant,
  validateAssistantReply,
  type AssistantBriefingAskerRole,
  type HiveError,
  type HiveMessage,
  type LegacyAssistantEvidence,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitStructuredEvent } from "@/server/observability/logger";
import { loadPackById } from "@/server/pipeline/pack-loader";
import { VaultAdminConfigError } from "@/server/source-documents/v3-vault/persistence/vault-admin-config-error";
import { getStudyPreparation, getStudyTabView } from "@/server/study-preparation/study-preparation";

import { loadHiveAssistantReplyPrompt } from "./hive-assistant-prompt";
import { createDefaultAssistantModelRunner, type AssistantModelRunner } from "./hive-assistant-model-runner";
import {
  shouldTriggerHiveAssistant,
  type AssistantHiveFlags,
  type AssistantSkipReason,
} from "./hive-assistant-trigger";
import { loadHiveOverview } from "./hive-summary";
import { loadAcceptedLegacyAssistantEvidence } from "./load-legacy-assistant-evidence";

type RunInput = {
  hiveId: string;
  triggerMessage: HiveMessage;
  correlationId: string;
  userClient: SupabaseClient;
};

function authorRoleToBriefing(role: string): AssistantBriefingAskerRole {
  if (role === "client" || role === "staff" || role === "owner" || role === "professional") return role;
  return "professional";
}

type LoadedHiveFlags = AssistantHiveFlags & { name: string; stage: string | null; firmId: string | null };

async function loadHiveFlags(client: SupabaseClient, hiveId: string): Promise<LoadedHiveFlags | null> {
  const { data, error } = await client
    .schema("hive")
    .from("hives")
    .select("content_class,assistant_replies_on,name,stage,firm_id")
    .eq("id", hiveId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    content_class?: string;
    assistant_replies_on?: boolean;
    name?: string;
    stage?: string | null;
    firm_id?: string | null;
  };
  return {
    contentClass: row.content_class === "synthetic" ? "synthetic" : "real",
    assistantRepliesOn: row.assistant_replies_on !== false,
    name: typeof row.name === "string" ? row.name : "Hive",
    stage: typeof row.stage === "string" ? row.stage : null,
    firmId: typeof row.firm_id === "string" ? row.firm_id : null,
  };
}

function assistantLogBase(input: RunInput, runId?: string | null): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    component: "hives",
    operation: "hiveAssistantReply",
    stage: "SHELL",
    correlationId: input.correlationId,
    hiveId: input.hiveId,
    ...(runId ? { processingRunId: runId } : {}),
    task: ASSISTANT_REPLY_PROMPT_ID,
  };
}

function logAssistantSkipped(input: RunInput, reason: AssistantSkipReason, runId?: string | null): void {
  emitStructuredEvent({
    ...assistantLogBase(input, runId),
    eventName: "hive.assistant.skipped",
    severity: "INFO",
    status: "OK",
    errorCode: reason,
  });
}

function logAssistantFlagsUnavailable(input: RunInput): void {
  emitStructuredEvent({
    ...assistantLogBase(input),
    eventName: "hive.assistant.flags_unavailable",
    severity: "WARN",
    status: "FAILED",
    diagnosticReason: "persistence_failed",
  });
}

function logAssistantClaimFailed(input: RunInput, code: string): void {
  emitStructuredEvent({
    ...assistantLogBase(input),
    eventName: "hive.assistant.claim_failed",
    severity: "WARN",
    status: "FAILED",
    errorCode: code,
  });
}

function logAssistantFailed(
  input: RunInput,
  runId: string,
  errorCode: string,
  cause: unknown,
  durationMs?: number,
): void {
  const name = cause instanceof Error ? cause.name : "Error";
  const { errorDetail } = buildUnexpectedExceptionDiagnostics(cause);
  emitStructuredEvent({
    ...assistantLogBase(input, runId),
    eventName: "hive.assistant.failed",
    severity: "WARN",
    status: "FAILED",
    errorCode,
    diagnosticField: `${errorCode}:${name}`,
    errorDetail,
    ...(durationMs != null ? { durationMs } : {}),
  });
}

function logAssistantPackUnavailable(input: RunInput, runId: string, cause: unknown): void {
  const name = cause instanceof Error ? cause.name : "Error";
  const { errorDetail } = buildUnexpectedExceptionDiagnostics(cause);
  emitStructuredEvent({
    ...assistantLogBase(input, runId),
    eventName: "hive.assistant.pack_unavailable",
    severity: "INFO",
    status: "OK",
    errorCode: "pack_unavailable",
    diagnosticField: `pack_unavailable:${name}`,
    errorDetail,
  });
}

function logAssistantLegacyEvidenceUnavailable(input: RunInput, runId: string, reason: string): void {
  emitStructuredEvent({
    ...assistantLogBase(input, runId),
    eventName: "hive.assistant.legacy_evidence_unavailable",
    severity: "INFO",
    status: "OK",
    errorCode: reason,
  });
}

function logAssistantAnswered(
  input: RunInput,
  runId: string,
  status: "answered" | "routed",
  durationMs: number,
  factsSent: number,
  claimsKept: number,
  claimsDropped: number,
): void {
  emitStructuredEvent({
    ...assistantLogBase(input, runId),
    eventName: status === "routed" ? "hive.assistant.routed" : "hive.assistant.answered",
    severity: "INFO",
    status: "OK",
    durationMs,
    totalCount: factsSent,
    inputCount: claimsKept,
    outputCount: claimsDropped,
  });
}

async function loadAssistantName(client: SupabaseClient, firmId: string | null): Promise<string> {
  if (!firmId) return "HiveForYou";
  const { data } = await client.schema("hive").from("firms").select("assistant_name").eq("id", firmId).maybeSingle();
  const name = (data as { assistant_name?: string | null } | null)?.assistant_name;
  return typeof name === "string" && name.trim() ? name.trim() : "HiveForYou";
}

async function countRunsLastHour(client: SupabaseClient, hiveId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await client
    .schema("hive")
    .from("assistant_runs")
    .select("id", { count: "exact", head: true })
    .eq("hive_id", hiveId)
    .gte("created_at", since);
  return count ?? 0;
}

async function finishRun(
  client: SupabaseClient,
  input: {
    runId: string;
    status: "answered" | "routed" | "failed" | "skipped";
    body: string | null;
    sourceRefs: unknown[];
    studyRevisionId: string | null;
    promptId: string;
    model: string | null;
    latencyMs: number | null;
    errorCode: string | null;
    itemKey?: string | null;
  },
): Promise<void> {
  const refs = [...input.sourceRefs];
  if (input.itemKey) refs.push({ itemKey: input.itemKey });
  await client.rpc("finish_assistant_run", {
    p_run_id: input.runId,
    p_status: input.status,
    p_body: input.body,
    p_source_refs: refs,
    p_study_revision_id: input.studyRevisionId,
    p_prompt_id: input.promptId,
    p_model: input.model,
    p_latency_ms: input.latencyMs,
    p_error_code: input.errorCode,
  });
}

async function loadBriefingMessages(
  userClient: SupabaseClient,
  hiveId: string,
  assistantName: string,
  authorRole: string,
  triggerMessage: HiveMessage,
): Promise<HiveMessage[]> {
  const threadOwner = triggerMessage.authorUserId;
  if (!threadOwner) throw new Error("invalid_trigger_author");
  const { data, error } = await userClient.rpc("list_hive_messages", {
    p_hive_id: hiveId,
    p_channel: "assistant",
    p_thread_owner: threadOwner,
    p_before_created_at: null,
    p_before_id: null,
    p_limit: HIVE_MESSAGE_PAGE_SIZE,
  });
  if (error) throw error;
  const page = normalizeHiveMessagePage(data);
  if (!page) throw new Error("invalid_message_page");
  return page.messages.map((message) => {
    if (message.authorKind === "assistant") {
      return {
        ...message,
        authorDisplayName: assistantName,
        authorRoleLabel: assistantName,
      };
    }
    if (message.id === triggerMessage.id) return triggerMessage;
    return message;
  });
}

async function loadBriefingChecklist(userClient: SupabaseClient, hiveId: string) {
  const { data, error } = await userClient.rpc("list_requests", { p_hive_id: hiveId });
  if (error) throw error;
  return normalizeListRequestsResponse(data)?.requests ?? [];
}

export const ASSISTANT_PRE_CLAIM_STAGES = [
  "model_runner_init",
  "supabase_env_load",
  "admin_client_create",
  "hive_flags_query",
  "assistant_name_lookup",
  "rate_limit_lookup",
  "trigger_eval",
  "assistant_run_claim",
] as const;

export type AssistantPreClaimStage = (typeof ASSISTANT_PRE_CLAIM_STAGES)[number];

type AssistantUnexpectedStage = AssistantPreClaimStage | "finish";

const SAFE_EXCEPTION_TYPE = /^[A-Z][A-Za-z0-9]{0,39}$/;
const SAFE_EXCEPTION_CODE = /^(?:[A-Z0-9][A-Z0-9_]{1,39}|[a-z][a-z0-9_]{1,39})$/;
const LONG_HEX_CODE = /^[0-9a-f]{16,}$/i;
const SENSITIVE_EXCEPTION_MARKER =
  /password|token|quote|documenttext|prompt|authorization|secret|credential|ssn|phi|pii|bearer|apikey|api_key|service_role|jwt/i;

class AssistantStageError extends Error {
  override readonly name = "AssistantStageError";
  readonly assistantStage: AssistantPreClaimStage;

  constructor(stage: AssistantPreClaimStage, cause: unknown) {
    super(stage);
    this.assistantStage = stage;
    Object.defineProperty(this, "cause", {
      value: cause,
      enumerable: false,
      configurable: true,
    });
  }
}

function runStageSync<T>(stage: AssistantPreClaimStage, fn: () => T): T {
  try {
    return fn();
  } catch (cause) {
    throw new AssistantStageError(stage, cause);
  }
}

async function runStageAsync<T>(stage: AssistantPreClaimStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new AssistantStageError(stage, cause);
  }
}

function isHiveErrorLike(value: unknown): value is HiveError {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.errorCode === "string" &&
    isErrorCode(record.errorCode) &&
    typeof record.category === "string" &&
    isErrorCategory(record.category) &&
    typeof record.stage === "string" &&
    isProcessingStage(record.stage) &&
    typeof record.retryable === "boolean" &&
    typeof record.safeMessage === "string" &&
    typeof record.correlationId === "string"
  );
}

function sanitizeExceptionType(cause: unknown): string {
  if (cause instanceof VaultAdminConfigError) return "VaultAdminConfigError";
  if (isHiveErrorLike(cause)) return "HiveError";
  const isDomException = typeof DOMException !== "undefined" && cause instanceof DOMException;
  if (cause instanceof Error || isDomException) {
    const rawName = cause.name;
    if (
      typeof rawName === "string" &&
      SAFE_EXCEPTION_TYPE.test(rawName) &&
      !SENSITIVE_EXCEPTION_MARKER.test(rawName)
    ) {
      return rawName;
    }
    return "Error";
  }
  return "Unknown";
}

function sanitizeExceptionCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!SAFE_EXCEPTION_CODE.test(trimmed)) return null;
  if (LONG_HEX_CODE.test(trimmed)) return null;
  if (SENSITIVE_EXCEPTION_MARKER.test(trimmed)) return null;
  return trimmed;
}

function sanitizeHttpStatusCode(record: Record<string, unknown>): string | null {
  const raw = record.status ?? record.statusCode;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 100 && raw <= 599) {
    return `http_${raw}`;
  }
  return null;
}

function extractSanitizedExceptionCode(cause: unknown): string | null {
  if (cause instanceof VaultAdminConfigError) {
    return cause.diagnosticReason;
  }
  if (isHiveErrorLike(cause)) {
    return sanitizeExceptionCode(cause.diagnosticReason) ?? sanitizeExceptionCode(cause.errorCode);
  }
  if (!cause || typeof cause !== "object") return null;
  const record = cause as Record<string, unknown>;
  const direct = sanitizeExceptionCode(record.code);
  if (direct) return direct;
  const nestedCause = record.cause;
  if (nestedCause && typeof nestedCause === "object") {
    const nested = sanitizeExceptionCode((nestedCause as Record<string, unknown>).code);
    if (nested) return nested;
  }
  return sanitizeHttpStatusCode(record);
}

function buildAssistantUnexpectedDiagnostics(error: unknown): {
  stage: AssistantUnexpectedStage;
  exceptionType: string;
  exceptionCode: string | null;
  diagnosticReason: string;
  diagnosticField: string;
} {
  const stage: AssistantUnexpectedStage =
    error instanceof AssistantStageError ? error.assistantStage : "finish";
  const cause = error instanceof AssistantStageError ? error.cause : error;
  const exceptionType = sanitizeExceptionType(cause);
  const exceptionCode = extractSanitizedExceptionCode(cause);
  const diagnosticReason =
    cause instanceof VaultAdminConfigError ? cause.diagnosticReason : "unexpected_exception";
  const diagnosticField = exceptionCode
    ? `${stage}:${exceptionType}:${exceptionCode}`
    : `${stage}:${exceptionType}`;
  return {
    stage,
    exceptionType,
    exceptionCode,
    diagnosticReason,
    diagnosticField,
  };
}

export async function maybeScheduleHiveAssistantReply(
  input: RunInput & { authorRole: string },
  runModel?: AssistantModelRunner,
): Promise<void> {
  const resolvedRunModel = runStageSync("model_runner_init", () => runModel ?? createDefaultAssistantModelRunner());
  const adminEnv = runStageSync("supabase_env_load", () => loadSupabaseAdminEnv(process.env));
  const admin = runStageSync("admin_client_create", () => createSupabaseAdminClient(adminEnv));
  const { userClient } = input;
  const hive = await runStageAsync("hive_flags_query", () => loadHiveFlags(admin, input.hiveId));
  if (!hive) {
    logAssistantFlagsUnavailable(input);
    return;
  }
  const assistantName = await runStageAsync("assistant_name_lookup", () => loadAssistantName(admin, hive.firmId));
  const runsInLastHour = await runStageAsync("rate_limit_lookup", () => countRunsLastHour(admin, input.hiveId));
  const decision = runStageSync("trigger_eval", () =>
    shouldTriggerHiveAssistant({
      hive: { contentClass: hive.contentClass, assistantRepliesOn: hive.assistantRepliesOn, firmId: hive.firmId },
      message: input.triggerMessage,
      authorRole: input.authorRole as never,
      assistantName,
      runsInLastHour,
    }),
  );
  if (!decision.trigger) {
    if (decision.skipReason) logAssistantSkipped(input, decision.skipReason);
    return;
  }

  const skipForRate = decision.skipReason === "rate_limited";

  const { data: claimRaw, error: claimError } = await runStageAsync("assistant_run_claim", async () => {
    const result = await admin.rpc("claim_assistant_run", {
      p_trigger_message_id: input.triggerMessage.id,
    });
    return { data: result.data, error: result.error };
  });
  if (claimError) {
    logAssistantClaimFailed(input, claimError.code ?? "claim_failed");
    return;
  }
  const claim = claimRaw as { runId?: string; claimed?: boolean } | null;
  if (!claim?.runId || !claim.claimed) {
    logAssistantClaimFailed(input, "not_claimed");
    return;
  }
  const runId = claim.runId;

  if (skipForRate) {
    await finishRun(admin, {
      runId,
      status: "skipped",
      body: null,
      sourceRefs: [],
      studyRevisionId: null,
      promptId: ASSISTANT_REPLY_PROMPT_ID,
      model: null,
      latencyMs: null,
      errorCode: "rate_limited",
    });
    logAssistantSkipped(input, "rate_limited", runId);
    return;
  }

  const started = Date.now();
  const registryPromptId = ASSISTANT_REPLY_PROMPT_ID;
  const hasTeam = hive.firmId != null;
  const replyFallback = { teamFirstName: null, hasTeam };

  let preparation: Awaited<ReturnType<typeof getStudyPreparation>>;
  let overview: Awaited<ReturnType<typeof loadHiveOverview>>;
  let requests: Awaited<ReturnType<typeof loadBriefingChecklist>>;
  let rawTab: unknown;
  let messageList: HiveMessage[];

  try {
    preparation = await getStudyPreparation(userClient, {
      hiveId: input.hiveId,
      correlationId: input.correlationId,
      includePreview: false,
    });
    overview = await loadHiveOverview(userClient, { hiveId: input.hiveId, correlationId: input.correlationId });
    requests = await loadBriefingChecklist(userClient, input.hiveId);
    rawTab = await getStudyTabView(userClient, { hiveId: input.hiveId, correlationId: input.correlationId });
    messageList = await loadBriefingMessages(
      userClient,
      input.hiveId,
      assistantName,
      input.authorRole,
      input.triggerMessage,
    );
  } catch {
    const durationMs = Date.now() - started;
    await finishRun(admin, {
      runId,
      status: "failed",
      body: null,
      sourceRefs: [],
      studyRevisionId: null,
      promptId: registryPromptId,
      model: null,
      latencyMs: durationMs,
      errorCode: "briefing_unavailable",
    });
    logAssistantFailed(input, runId, "briefing_unavailable", new Error("briefing_unavailable"), durationMs);
    return;
  }

  const failRun = async (errorCode: string, cause: unknown, studyRevisionId: string | null = null): Promise<void> => {
    const durationMs = Date.now() - started;
    await finishRun(admin, {
      runId,
      status: "failed",
      body: null,
      sourceRefs: [],
      studyRevisionId,
      promptId: registryPromptId,
      model: null,
      latencyMs: durationMs,
      errorCode,
    });
    logAssistantFailed(input, runId, errorCode, cause, durationMs);
  };

  const tab = normalizeGetStudyTabViewResponse(rawTab);
  let pack: ReturnType<typeof loadPackById> = null;
  if (tab?.canonicalStudy?.packRef != null) {
    try {
      pack = loadPackById(tab.canonicalStudy.packRef.id, tab.canonicalStudy.packRef.version);
    } catch (cause) {
      pack = null;
      logAssistantPackUnavailable(input, runId, cause);
    }
  }

  const isCanonicalStudy =
    overview.canonicalStudy != null || preparation.studyRevision?.format === "canonical-study-1";
  let legacyEvidence: LegacyAssistantEvidence | null = null;
  if (!isCanonicalStudy && preparation.studyRevision != null) {
    try {
      const loaded = await loadAcceptedLegacyAssistantEvidence(userClient, {
        hiveId: input.hiveId,
        expectedRevision: preparation.studyRevision,
        activeEligibleDocuments: preparation.eligibility.documents.map((doc) => ({
          sourceDocumentId: doc.sourceDocumentId,
          totalPhysicalPages: doc.totalPhysicalPages,
        })),
      });
      if (loaded.ok) {
        legacyEvidence = loaded.evidence;
      } else {
        logAssistantLegacyEvidenceUnavailable(input, runId, loaded.reason);
      }
    } catch {
      legacyEvidence = null;
      logAssistantLegacyEvidenceUnavailable(input, runId, "load_failed");
    }
  }

  let briefing: ReturnType<typeof buildAssistantBriefing>;
  try {
    briefing = buildAssistantBriefing({
      viewer: {
        role: authorRoleToBriefing(input.authorRole),
        roleLabel: input.triggerMessage.authorRoleLabel ?? input.authorRole,
        firstName: input.triggerMessage.authorDisplayName.split(/\s+/)[0] ?? "there",
      },
      hive: {
        name: hive.name,
        purpose: null,
        matterType: pack?.meta.title ?? null,
        stage: hive.stage,
      },
      pack,
      checklist: requests,
      study: {
        revisionId: preparation.studyRevision?.id ?? null,
        revisionNumber: preparation.studyRevision?.revisionNumber ?? null,
        canonical: overview.canonicalStudy,
        sources: overview.studyTab?.sources ?? null,
        legacyFacts: legacyEvidence?.briefingFacts ?? null,
      },
      documents: preparation.eligibility.documents.map((doc, index) => ({
        label: overview.canonicalStudy
          ? canonicalStudyDocumentRoleLabel(overview.canonicalStudy, doc.sourceDocumentId, {
              sources: overview.studyTab?.sources ?? null,
            })
          : legacyEvidence?.documentLabels[doc.sourceDocumentId.toLowerCase()] ?? `Document ${index + 1}`,
        pages: doc.totalPhysicalPages ?? null,
        readState: doc.readStatus,
        unreadablePages: [],
      })),
      messages: messageList,
      question: input.triggerMessage.body,
      assistantName,
      hasTeam,
    });
  } catch (cause) {
    await failRun("briefing_build_failed", cause);
    return;
  }

  try {
    loadHiveAssistantReplyPrompt();
  } catch (cause) {
    await failRun("prompt_unavailable", cause, preparation.studyRevision?.id ?? null);
    return;
  }

  let model: Awaited<ReturnType<AssistantModelRunner>>;
  try {
    model = await resolvedRunModel({
      briefing: JSON.parse(JSON.stringify(briefing)) as Record<string, unknown>,
      correlationId: input.correlationId,
    });
  } catch (cause) {
    await failRun("model_failed", cause, preparation.studyRevision?.id ?? null);
    return;
  }

  if (!model.ok) {
    await failRun("model_failed", new Error(model.errorCode), preparation.studyRevision?.id ?? null);
    return;
  }

  const revisionId = revisionIdForAssistant(preparation.studyRevision?.id ?? null);
  let validated: ReturnType<typeof validateAssistantReply>;
  try {
    validated = validateAssistantReply(
      model.output,
      briefing,
      {
        revisionId,
        mapFact: (fact) => {
          if (overview.canonicalStudy) {
            const sources = overview.studyTab?.sources;
            const ref = sources?.facts[fact.id];
            if (!ref) return null;
            return {
              sourceDocumentId: ref.sourceDocumentId,
              pageNumber: ref.pageNumber,
              shortLabel: fact.sourceLabel,
              factId: fact.id,
              studyRevisionId: revisionId,
            };
          }
          if (legacyEvidence) {
            return mapLegacyAssistantFactRefs(legacyEvidence, fact.id, revisionId);
          }
          return null;
        },
      },
      replyFallback,
    );
  } catch (cause) {
    await failRun("validation_failed", cause, preparation.studyRevision?.id ?? null);
    return;
  }

  const status = validated.routedOnly ? "routed" : "answered";
  try {
    await finishRun(admin, {
      runId,
      status,
      body: validated.reply,
      sourceRefs: [...validated.sourceRefs],
      studyRevisionId: preparation.studyRevision?.id ?? null,
      promptId: registryPromptId,
      model: model.modelId,
      latencyMs: model.latencyMs,
      errorCode: null,
      itemKey: validated.itemKey,
    });
  } catch (cause) {
    await failRun("finish_failed", cause, preparation.studyRevision?.id ?? null);
    return;
  }

  logAssistantAnswered(
    input,
    runId,
    status,
    model.latencyMs,
    briefing.study.facts.length,
    validated.sourceRefs.length,
    validated.sourceRefs.length,
  );
}

export async function runHiveAssistantReply(input: RunInput & { authorRole: string }): Promise<void> {
  try {
    await maybeScheduleHiveAssistantReply(input);
  } catch (cause) {
    const diagnostics = buildAssistantUnexpectedDiagnostics(cause);
    emitStructuredEvent({
      ...assistantLogBase(input),
      eventName: "hive.assistant.failed",
      severity: "ERROR",
      status: "FAILED",
      errorCode: "unexpected",
      diagnosticReason: diagnostics.diagnosticReason,
      diagnosticField: diagnostics.diagnosticField,
      exceptionType: diagnostics.exceptionType,
    });
  }
}