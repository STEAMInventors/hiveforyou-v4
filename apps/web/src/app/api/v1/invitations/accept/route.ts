import { createHiveError } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { hashInviteToken } from "@/server/hives/invite-token";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export async function POST(request: NextRequest): Promise<Response> {
  const run = withApiRoute("invitations", "acceptInvitation", async ({ correlationId }) => {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to accept this invitation.",
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

    const token = raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { token?: unknown }).token === "string"
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

    const { data, error } = await auth.client.rpc("accept_invitation", {
      p_token_hash: hashInviteToken(token),
    });

    if (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      const lowered = message.toLowerCase();
      throw createHiveError({
        errorCode: lowered.includes("email_mismatch") ? "ACCESS_DENIED" : "INVALID_REQUEST",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: lowered.includes("email_mismatch")
          ? "This invitation was sent to a different email address."
          : "This invitation can no longer be used.",
        correlationId,
        diagnosticReason: "invitation_rejected",
      });
    }

    return NextResponse.json(data, {
      status: 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(request);
}