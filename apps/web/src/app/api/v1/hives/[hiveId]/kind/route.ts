import { createHiveError, isHiveKind, isValidUuid } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const run = withApiRoute("hives", "setHiveKind", async ({ correlationId }) => {
    const { hiveId } = await context.params;
    if (!hiveId || !isValidUuid(hiveId.trim())) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid Hive identifier.",
        correlationId,
        diagnosticReason: "invalid_hive_id",
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

    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const kindRaw = typeof record?.kind === "string" ? record.kind.trim().toLowerCase() : "";
    if (!isHiveKind(kindRaw)) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid Hive kind.",
        correlationId,
        diagnosticReason: "invalid_kind",
      });
    }

    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to update this Hive.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const { error } = await auth.client.rpc("set_hive_kind", {
      p_hive_id: hiveId.trim().toLowerCase(),
      p_kind: kindRaw,
    });
    if (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      const lowered = message.toLowerCase();
      if (lowered.includes("access_denied") || lowered.includes("hive_not_found")) {
        throw createHiveError({
          errorCode: lowered.includes("hive_not_found") ? "NOT_FOUND" : "ACCESS_DENIED",
          category: "SECURITY",
          stage: "SHELL",
          retryable: false,
          safeMessage: lowered.includes("hive_not_found")
            ? "We could not find that Hive."
            : "You do not have access to this Hive.",
          correlationId,
          diagnosticReason: lowered.includes("hive_not_found") ? "not_found" : "access_denied",
        });
      }
      throw createHiveError({
        errorCode: "PERSISTENCE_FAILED",
        category: "PERSISTENCE",
        stage: "SHELL",
        retryable: true,
        safeMessage: "Could not update this Hive.",
        correlationId,
        diagnosticReason: "persistence_failed",
      });
    }

    return NextResponse.json({ ok: true }, {
      status: 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(request);
}