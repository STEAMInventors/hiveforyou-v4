import { createHiveError, isValidUuid, type MarkHiveMessagesReadResponse } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";

import {
  CONVERSATION_SEND_FAILED,
  conversationInvalidRequest,
  mapConversationRpcError,
  withHttpStatus,
} from "@/server/hives/map-conversation-rpc-error";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = { params: Promise<{ hiveId: string }> };

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "markHiveMessagesRead", async ({ correlationId, request: req }) => {
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
        safeMessage: "Sign in to see the conversation.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const raw = await readJsonBody(req, correlationId);
    const upTo =
      raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { upTo?: unknown }).upTo === "string"
        ? ((raw as { upTo: string }).upTo).trim()
        : "";
    if (!upTo || upTo.length > 64 || Number.isNaN(Date.parse(upTo))) {
      throw conversationInvalidRequest("up_to", correlationId);
    }

    const { data, error } = await auth.client.rpc("mark_hive_messages_read", { p_hive_id: hiveId, p_up_to: upTo });
    if (error) throw mapConversationRpcError(error, correlationId, CONVERSATION_SEND_FAILED);

    const lastReadAt =
      data && typeof data === "object" && typeof (data as { lastReadAt?: unknown }).lastReadAt === "string"
        ? (data as { lastReadAt: string }).lastReadAt
        : null;
    if (!lastReadAt) throw mapConversationRpcError({}, correlationId, CONVERSATION_SEND_FAILED);
    const body: MarkHiveMessagesReadResponse = { lastReadAt };
    return jsonWithCorrelation(body, 200, correlationId);
  });
  return run(request);
}
