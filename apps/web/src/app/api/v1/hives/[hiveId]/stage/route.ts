import { createHiveError, isHiveStage, isValidUuid } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = { params: Promise<{ hiveId: string }> };

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "setHiveStage", async ({ correlationId }) => {
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

    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to update this hive.",
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

    const stageRaw =
      raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { stage?: unknown }).stage === "string"
        ? (raw as { stage: string }).stage.trim().toLowerCase()
        : "";
    if (!isHiveStage(stageRaw)) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Stage must be open, review, or closed.",
        correlationId,
        diagnosticReason: "invalid_stage",
      });
    }

    const { data, error } = await auth.client.rpc("set_hive_stage", {
      p_hive_id: hiveId.trim().toLowerCase(),
      p_stage: stageRaw,
    });
    if (error) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not update the stage.",
        correlationId,
        diagnosticReason: error.message?.slice(0, 80) ?? "set_hive_stage_failed",
      });
    }

    return NextResponse.json(data, { headers: { [CORRELATION_HEADER]: correlationId } });
  });
  return run(request);
}