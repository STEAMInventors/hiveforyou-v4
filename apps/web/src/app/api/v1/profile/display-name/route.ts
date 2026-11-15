import { createHiveError } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export async function POST(request: NextRequest): Promise<Response> {
  const run = withApiRoute("profile", "setDisplayName", async ({ correlationId }) => {
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

    const displayName =
      raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { displayName?: unknown }).displayName === "string"
        ? (raw as { displayName: string }).displayName.trim()
        : "";
    if (displayName.length < 1) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Enter a name.",
        correlationId,
        diagnosticReason: "empty_display_name",
      });
    }

    const { error } = await auth.client.rpc("set_display_name", { p_name: displayName });
    if (error) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not save your name.",
        correlationId,
        diagnosticReason: "set_display_name_failed",
      });
    }

    return NextResponse.json({ ok: true }, {
      status: 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(request);
}