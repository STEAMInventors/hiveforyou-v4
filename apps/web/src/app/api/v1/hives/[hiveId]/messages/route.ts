import {
  createHiveError,
  HIVE_MESSAGE_PAGE_SIZE,
  isValidUuid,
  normalizeHiveMessagePage,
  normalizePostHiveMessageResult,
  parsePostHiveMessageRequest,
  type PostHiveMessageResponse,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after, type NextRequest } from "next/server";

import { hiveHomePath } from "@/lib/hive-routes";
import { sendHiveMessageNotices } from "@/server/hives/hive-message-notices";
import {
  CONVERSATION_LOAD_FAILED,
  CONVERSATION_SEND_FAILED,
  conversationInvalidRequest,
  mapConversationRpcError,
  withHttpStatus,
} from "@/server/hives/map-conversation-rpc-error";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { runHiveAssistantReply } from "@/server/hives/hive-assistant-service";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ hiveId: string }> };

const IDEMPOTENCY_HEADER = "idempotency-key";

function resolvePublicBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

async function requireHiveAndUser(context: RouteContext, correlationId: string, signInMessage: string) {
  const { hiveId: rawHiveId } = await context.params;
  const hiveId = rawHiveId?.trim().toLowerCase() ?? "";
  if (!isValidUuid(hiveId)) {
    throw withHttpStatus(
      createHiveError({
        errorCode: "NOT_FOUND",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "We could not find that hive.",
        correlationId,
        diagnosticReason: "invalid_hive_id",
      }),
      404,
    );
  }
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    throw createHiveError({
      errorCode: "UNAUTHENTICATED",
      category: "SECURITY",
      stage: "SHELL",
      retryable: false,
      safeMessage: signInMessage,
      correlationId,
      diagnosticReason: auth.diagnosticReason,
    });
  }
  return { hiveId, auth };
}

async function loadHiveName(client: SupabaseClient, hiveId: string): Promise<string> {
  try {
    const { data } = await client.rpc("get_hive", { p_hive_id: hiveId });
    const name = data && typeof data === "object" ? (data as { name?: unknown }).name : undefined;
    return typeof name === "string" && name.trim() ? name.trim() : "your hive";
  } catch {
    return "your hive";
  }
}

function malformedResponse(correlationId: string, message: string) {
  return withHttpStatus(
    createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: message,
      correlationId,
      diagnosticReason: "invalid_payload_shape",
    }),
    503,
  );
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "listHiveMessages", async ({ correlationId, request: req }) => {
    const { hiveId, auth } = await requireHiveAndUser(context, correlationId, "Sign in to see the conversation.");

    const before = req.nextUrl.searchParams.get("before")?.trim() || null;
    const beforeId = req.nextUrl.searchParams.get("beforeId")?.trim().toLowerCase() || null;
    if (before && (before.length > 64 || Number.isNaN(Date.parse(before)))) {
      throw conversationInvalidRequest("before", correlationId);
    }
    if (beforeId && !isValidUuid(beforeId)) {
      throw conversationInvalidRequest("before", correlationId);
    }

    const channelRaw = req.nextUrl.searchParams.get("channel")?.trim().toLowerCase() ?? "people";
    const channel = channelRaw === "assistant" ? "assistant" : channelRaw === "people" ? "people" : null;
    if (!channel) {
      throw conversationInvalidRequest("channel", correlationId);
    }
    const threadOwnerRaw = req.nextUrl.searchParams.get("threadOwner")?.trim().toLowerCase() || null;
    if (threadOwnerRaw && !isValidUuid(threadOwnerRaw)) {
      throw conversationInvalidRequest("threadOwner", correlationId);
    }

    const { data, error } = await auth.client.rpc("list_hive_messages", {
      p_hive_id: hiveId,
      p_channel: channel,
      p_thread_owner: threadOwnerRaw,
      p_before_created_at: before,
      p_before_id: before ? beforeId : null,
      p_limit: HIVE_MESSAGE_PAGE_SIZE,
    });
    if (error) throw mapConversationRpcError(error, correlationId, CONVERSATION_LOAD_FAILED);

    const page = normalizeHiveMessagePage(data);
    if (!page) throw malformedResponse(correlationId, CONVERSATION_LOAD_FAILED);
    return jsonWithCorrelation(page, 200, correlationId);
  });
  return run(request);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "postHiveMessage", async ({ correlationId, request: req }) => {
    const { hiveId, auth } = await requireHiveAndUser(context, correlationId, "Sign in to send a message.");

    const clientRequestId = req.headers.get(IDEMPOTENCY_HEADER)?.trim().toLowerCase() ?? "";
    if (!isValidUuid(clientRequestId)) {
      throw conversationInvalidRequest("client_request_id", correlationId);
    }

    const parsed = parsePostHiveMessageRequest(await readJsonBody(req, correlationId));
    if (!parsed.ok) {
      throw conversationInvalidRequest(parsed.field === "body" ? "body" : "reply_to", correlationId);
    }

    const { data, error } = await auth.client.rpc("post_hive_message", {
      p_hive_id: hiveId,
      p_body: parsed.value.body,
      p_client_request_id: clientRequestId,
      p_reply_to: parsed.value.replyTo,
      p_channel: parsed.value.channel,
      p_handoff_from: parsed.value.handoffFrom,
    });
    if (error) throw mapConversationRpcError(error, correlationId, CONVERSATION_SEND_FAILED);

    const result = normalizePostHiveMessageResult(data);
    if (!result) throw malformedResponse(correlationId, CONVERSATION_SEND_FAILED);

    const posterClient = auth.client;
    if (!result.duplicate && parsed.value.channel === "assistant") {
      after(() =>
        runHiveAssistantReply({
          hiveId,
          triggerMessage: result.message,
          authorRole: result.message.authorRole,
          correlationId,
          userClient: posterClient,
        }),
      );
    }

    if (!result.duplicate && parsed.value.channel === "people" && result.notifyUserIds.length > 0) {
      await sendHiveMessageNotices({
        userIds: result.notifyUserIds,
        hiveName: await loadHiveName(auth.client, hiveId),
        conversationUrl: `${resolvePublicBaseUrl(req)}${hiveHomePath(hiveId)}`,
        correlationId,
      }).catch(() => undefined);
    }

    const body: PostHiveMessageResponse = { message: result.message, duplicate: result.duplicate };
    return jsonWithCorrelation(body, result.duplicate ? 200 : 201, correlationId);
  });
  return run(request);
}
