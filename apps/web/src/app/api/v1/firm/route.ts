import { createHiveError } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { loadFirm } from "@/server/firm/load-firm";
import { mapFirmRpcError } from "@/server/firm/map-firm-rpc-error";
import { practiceAreaAllowlistFromPacks } from "@/server/firm/practice-area-options";
import { validatePracticeAreasForFirm } from "@/server/firm/validate-practice-areas";
import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute, readJsonBody } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

const FIRM_NAME_MAX = 100;
const ASSISTANT_NAME_MAX = 40;

function isFirmMembershipExists(error: { code?: string; message?: string }): boolean {
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return error.code === "23505" && message.includes("firm_membership_exists");
}

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
  const run = withApiRoute("firm", "createFirm", async ({ correlationId, request: req }) => {
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

    const raw = await readJsonBody(req, correlationId);
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    const assistantName =
      typeof record?.assistantName === "string" ? record.assistantName.trim() : undefined;
    const practiceAreasRaw = Array.isArray(record?.practiceAreas)
      ? record.practiceAreas.filter((item): item is string => typeof item === "string")
      : [];
    const allowed = practiceAreaAllowlistFromPacks();
    const practiceAreas = validatePracticeAreasForFirm(practiceAreasRaw, allowed, correlationId);
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
      if (isFirmMembershipExists(error)) {
        const existing = await loadFirm(auth.client);
        if (existing?.firm && existing.firm.name.trim() === name) {
          return NextResponse.json(existing, { headers: { [CORRELATION_HEADER]: correlationId } });
        }
      }
      throw mapFirmRpcError(error, correlationId);
    }

    return NextResponse.json(data, { headers: { [CORRELATION_HEADER]: correlationId } });
  });
  return run(request);
}