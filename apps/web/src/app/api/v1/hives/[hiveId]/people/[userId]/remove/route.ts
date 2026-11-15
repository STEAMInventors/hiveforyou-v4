import { createHiveError, isValidUuid } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = { params: Promise<{ hiveId: string; userId: string }> };

export async function POST(_request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "removeMember", async ({ correlationId }) => {
    const { hiveId, userId } = await context.params;
    const trimmedHive = hiveId?.trim().toLowerCase() ?? "";
    const trimmedUser = userId?.trim().toLowerCase() ?? "";
    if (!isValidUuid(trimmedHive) || !isValidUuid(trimmedUser)) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid request.",
        correlationId,
        diagnosticReason: "invalid_ids",
      });
    }

    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to continue.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const { error } = await auth.client.rpc("remove_member", {
      p_hive_id: trimmedHive,
      p_user_id: trimmedUser,
    });

    if (error) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not remove this person.",
        correlationId,
        diagnosticReason: "remove_member_denied",
      });
    }

    return NextResponse.json({ ok: true }, {
      status: 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(_request);
}