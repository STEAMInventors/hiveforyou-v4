import { createHiveError, normalizePracticeAreaIds } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { loadFirm } from "@/server/firm/load-firm";
import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

const FIRM_NAME_MAX = 100;
const ASSISTANT_NAME_MAX = 40;

export async function GET(request: NextRequest): Promise<Response> {
  const run = withApiRoute("firm", "listFirm", async ({ correlationId }) => {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to view your firm.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }
    const firm = await loadFirm(auth.client);
    return NextResponse.json(firm ?? { firm: null, members: [], pendingInvitations: [] }, {
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });
  return run(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const run = withApiRoute("firm", "createFirm", async ({ correlationId }) => {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to create a firm.",
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

    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    const assistantName =
      typeof record?.assistantName === "string" ? record.assistantName.trim() : undefined;
    const practiceAreas = Array.isArray(record?.practiceAreas)
      ? normalizePracticeAreaIds(record.practiceAreas.filter((item): item is string => typeof item === "string"))
      : [];
    if (name.length < 1 || name.length > FIRM_NAME_MAX) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Enter a firm name up to 100 characters.",
        correlationId,
        diagnosticReason: "invalid_firm_name",
      });
    }
    if (assistantName && assistantName.length > ASSISTANT_NAME_MAX) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Assistant name must be 40 characters or fewer.",
        correlationId,
        diagnosticReason: "invalid_assistant_name",
      });
    }

    const { data, error } = await auth.client.rpc("create_firm", {
      p_name: name,
      p_assistant_name: assistantName ?? null,
      p_practice_areas: practiceAreas,
    });
    if (error) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not create the firm. Try again.",
        correlationId,
        diagnosticReason: error.message?.slice(0, 80) ?? "create_firm_failed",
      });
    }

    return NextResponse.json(data, { headers: { [CORRELATION_HEADER]: correlationId } });
  });
  return run(request);
}