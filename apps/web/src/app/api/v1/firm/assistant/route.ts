import { createHiveError } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

const ASSISTANT_NAME_MAX = 40;

export async function POST(request: NextRequest): Promise<Response> {
  const run = withApiRoute("firm", "setAssistantName", async ({ correlationId }) => {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to rename the assistant.",
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

    const name =
      raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { assistantName?: unknown }).assistantName === "string"
        ? (raw as { assistantName: string }).assistantName.trim()
        : "";
    if (name.length < 1 || name.length > ASSISTANT_NAME_MAX) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Use 1 to 40 characters.",
        correlationId,
        diagnosticReason: "invalid_assistant_name",
      });
    }

    const { error } = await auth.client.rpc("set_assistant_name", { p_assistant_name: name });
    if (error) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not rename the assistant.",
        correlationId,
        diagnosticReason: "set_assistant_name_failed",
      });
    }

    return NextResponse.json({ ok: true }, { headers: { [CORRELATION_HEADER]: correlationId } });
  });
  return run(request);
}
