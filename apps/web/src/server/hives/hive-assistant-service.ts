import { loadSupabaseAdminEnv } from "@hives/persistence/env";
import { createSupabaseAdminClient } from "@hives/persistence/storage/supabase-client";
import {
  buildAssistantBriefing,
  HIVE_MESSAGE_PAGE_SIZE,
  normalizeGetStudyTabViewResponse,
  normalizeHiveMessagePage,
  normalizeListRequestsResponse,
  revisionIdForAssistant,
  validateAssistantReply,
  type AssistantBriefingAskerRole,
  type HiveMessage,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitStructuredEvent } from "@/server/observability/logger";
import { loadPackById } from "@/server/pipeline/pack-loader";
import { getStudyPreparation, getStudyTabView } from "@/server/study-preparation/study-preparation";

import { createDefaultAssistantModelRunner, type AssistantModelRunner } from "./hive-assistant-model-runner";
import { shouldTriggerHiveAssistant, type AssistantHiveFlags } from "./hive-assistant-trigger";
import { loadHiveOverview } from "./hive-summary";

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

async function loadHiveFlags(client: SupabaseClient, hiveId: string): Promise<AssistantHiveFlags & { name: string; stage: string | null; firmId: string | null }> {
  const { data, error } = await client
    .schema("hive")
    .from("hives")
    .select("content_class,assistant_replies_on,name,stage,firm_id")
    .eq("id", hiveId)
    .maybeSingle();
  if (error || !data) {
    return { contentClass: "real", assistantRepliesOn: false, name: "Hive", stage: null, firmId: null };
  }
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
  const { data, error } = await userClient.rpc("list_hive_messages", {
    p_hive_id: hiveId,
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

export async function maybeScheduleHiveAssistantReply(
  input: RunInput & { authorRole: string },
  runModel: AssistantModelRunner = createDefaultAssistantModelRunner(),
): Promise<void> {
  const admin = createSupabaseAdminClient(loadSupabaseAdminEnv(process.env));
  const { userClient } = input;
  const hive = await loadHiveFlags(admin, input.hiveId);
  const assistantName = await loadAssistantName(admin, hive.firmId);
  const runsInLastHour = await countRunsLastHour(admin, input.hiveId);
  const decision = shouldTriggerHiveAssistant({
    hive: { contentClass: hive.contentClass, assistantRepliesOn: hive.assistantRepliesOn, firmId: hive.firmId },
    message: input.triggerMessage,
    authorRole: input.authorRole as never,
    assistantName,
    runsInLastHour,
  });
  if (!decision.trigger) return;

  const skipForRate = decision.skipReason === "rate_limited";

  const { data: claimRaw, error: claimError } = await admin.rpc("claim_assistant_run", {
    p_trigger_message_id: input.triggerMessage.id,
  });
  if (claimError) return;
  const claim = claimRaw as { runId?: string; claimed?: boolean } | null;
  if (!claim?.runId || !claim.claimed) return;

  if (skipForRate) {
    await finishRun(admin, {
      runId: claim.runId,
      status: "skipped",
      body: null,
      sourceRefs: [],
      studyRevisionId: null,
      promptId: "hive-assistant-reply/1",
      model: null,
      latencyMs: null,
      errorCode: "rate_limited",
    });
    return;
  }

  const started = Date.now();
  const registryPromptId = "hive-assistant-reply/1";
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
    await finishRun(admin, {
      runId: claim.runId,
      status: "failed",
      body: null,
      sourceRefs: [],
      studyRevisionId: null,
      promptId: registryPromptId,
      model: null,
      latencyMs: Date.now() - started,
      errorCode: "briefing_unavailable",
    });
    emitAssistantOutcome(input, claim.runId, "failed", Date.now() - started, "briefing_unavailable", 0, 0, 0);
    return;
  }

  try {
    const tab = normalizeGetStudyTabViewResponse(rawTab);
    const pack =
      tab?.canonicalStudy?.packRef != null
        ? loadPackById(tab.canonicalStudy.packRef.id, tab.canonicalStudy.packRef.version)
        : null;

    const briefing = buildAssistantBriefing({
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
      },
      documents: preparation.eligibility.documents.map((doc) => ({
        label: "Document",
        pages: doc.totalPhysicalPages ?? null,
        readState: doc.readStatus,
        unreadablePages: [],
      })),
      messages: messageList,
      question: input.triggerMessage.body,
      assistantName,
    });

    const model = await runModel({
      briefing: JSON.parse(JSON.stringify(briefing)) as Record<string, unknown>,
      correlationId: input.correlationId,
    });
    if (!model.ok) {
      await finishRun(admin, {
        runId: claim.runId,
        status: "failed",
        body: null,
        sourceRefs: [],
        studyRevisionId: preparation.studyRevision?.id ?? null,
        promptId: registryPromptId,
        model: null,
        latencyMs: Date.now() - started,
        errorCode: model.errorCode,
      });
      emitAssistantOutcome(input, claim.runId, "failed", Date.now() - started, model.errorCode, briefing.study.facts.length, 0, 0);
      return;
    }

    const revisionId = revisionIdForAssistant(preparation.studyRevision?.id ?? null);
    const validated = validateAssistantReply(
      model.output,
      briefing,
      {
        revisionId,
        mapFact: (fact) => {
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
        },
      },
      replyFallback,
    );

    const status = validated.routedOnly ? "routed" : "answered";
    await finishRun(admin, {
      runId: claim.runId,
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

    emitAssistantOutcome(
      input,
      claim.runId,
      status,
      model.latencyMs,
      null,
      briefing.study.facts.length,
      validated.sourceRefs.length,
      validated.sourceRefs.length,
    );
  } catch {
    await finishRun(admin, {
      runId: claim.runId,
      status: "failed",
      body: null,
      sourceRefs: [],
      studyRevisionId: null,
      promptId: registryPromptId,
      model: null,
      latencyMs: Date.now() - started,
      errorCode: "internal",
    });
  }
}

function emitAssistantOutcome(
  input: RunInput,
  runId: string,
  status: string,
  latencyMs: number,
  errorCode: string | null,
  factsSent: number,
  claimsKept: number,
  claimsDropped: number,
): void {
  emitStructuredEvent({
    eventName: "hive.assistant.completed",
    severity: status === "failed" || status === "skipped" ? "WARN" : "INFO",
    timestamp: new Date().toISOString(),
    component: "hives",
    operation: "hiveAssistantReply",
    stage: "SHELL",
    correlationId: input.correlationId,
    operationId: runId,
    status: status === "answered" || status === "routed" ? "OK" : "FAILED",
    durationMs: latencyMs,
    diagnosticReason: errorCode ?? status,
    totalCount: factsSent,
    inputCount: claimsKept,
    outputCount: claimsDropped,
    task: "hive-assistant-reply/1",
  });
}

export function processHiveAssistantReplySafely(input: RunInput & { authorRole: string }): void {
  void maybeScheduleHiveAssistantReply(input).catch(() => undefined);
}