import { createHiveError, isValidUuid } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";

import {
  CONVERSATION_LOAD_FAILED,
  conversationInvalidRequest,
  mapConversationRpcError,
  withHttpStatus,
} from "@/server/hives/map-conversation-rpc-error";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = { params: Promise<{ hiveId: string }> };

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "setHiveAssistantReplies", async ({ correlationId, request: req }) => {
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
        safeMessage: "Sign in to change assistant settings.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }
    const body = await readJsonBody(req, correlationId);
    const record = body && typeof body === "object" && !Array.isArray(body) ? (body as { on?: unknown }) : null;
    if (typeof record?.on !== "boolean") {
      throw conversationInvalidRequest("on", correlationId);
    }
    const { data, error } = await auth.client.rpc("set_hive_assistant_replies", {
      p_hive_id: hiveId,
      p_on: record.on,
    });
    if (error) throw mapConversationRpcError(error, correlationId, CONVERSATION_LOAD_FAILED);
    return jsonWithCorrelation({ assistantRepliesOn: data === true }, 200, correlationId);
  });
  return run(request);
}