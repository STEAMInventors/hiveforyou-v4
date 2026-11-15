import { createHiveError } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { hashInviteToken } from "@/server/hives/invite-token";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export async function POST(request: NextRequest): Promise<Response> {
  const run = withApiRoute("invitations", "welcomeContext", async ({ correlationId }) => {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to view this invitation.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Request body must be valid JSON.",
        correlationId,
        diagnosticReason: "invalid_json",
      });
    }

    const token =
      raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { token?: unknown }).token === "string"
        ? (raw as { token: string }).token.trim()
        : "";
    if (token.length !== 64) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "This invitation link is not valid.",
        correlationId,
        diagnosticReason: "invalid_token",
      });
    }

    const { data, error } = await auth.client.rpc("get_invitation_welcome_context", {
      p_token_hash: hashInviteToken(token),
    });

    if (error) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "This invitation summary is not available.",
        correlationId,
        diagnosticReason: "welcome_context_denied",
      });
    }

    return NextResponse.json(data, {
      status: 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(request);
}