import { createHiveError, isValidUuid } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = { params: Promise<{ hiveId: string; invitationId: string }> };

export async function POST(_request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "revokeInvitation", async ({ correlationId }) => {
    const { invitationId } = await context.params;
    if (!invitationId || !isValidUuid(invitationId.trim())) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid invitation.",
        correlationId,
        diagnosticReason: "invalid_invitation_id",
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

    const { error } = await auth.client.rpc("revoke_invitation", {
      p_invitation_id: invitationId.trim().toLowerCase(),
    });

    if (error) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not revoke this invitation.",
        correlationId,
        diagnosticReason: "access_denied",
      });
    }

    return NextResponse.json({ ok: true }, {
      status: 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(_request);
}