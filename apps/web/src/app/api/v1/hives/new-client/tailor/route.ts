import { createHiveError, MAX_TAILOR_PROFESSIONAL_TEXT, normalizeListFirmResponse } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute, readJsonBody } from "@/server/observability/with-api-route";
import { createDefaultChecklistTailorModelRunner } from "@/server/hives/checklist-tailor-model-runner";
import { runChecklistTailor } from "@/server/hives/checklist-tailor-service";
import { loadPackEntries } from "@/server/pipeline/pack-loader";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";
export async function POST(request: NextRequest): Promise<Response> {
  const run = withApiRoute("hives", "newClientTailor", async ({ correlationId, request: req }) => {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to tailor a checklist.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const { data: firmData, error: firmError } = await auth.client.rpc("list_firm");
    if (firmError || !normalizeListFirmResponse(firmData)?.firm) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Only firm staff can tailor a checklist.",
        correlationId,
        diagnosticReason: "list_firm_failed",
      });
    }

    const raw = await readJsonBody(req, correlationId);
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const packId = typeof record?.packId === "string" ? record.packId.trim() : "";
    const professionalText =
      typeof record?.professionalText === "string" ? record.professionalText.replace(/\s+/g, " ").trim() : "";

    if (!packId) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Choose a matter type first.",
        correlationId,
        diagnosticReason: "missing_pack",
      });
    }
    if (professionalText.length > MAX_TAILOR_PROFESSIONAL_TEXT) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: `Keep your note to ${MAX_TAILOR_PROFESSIONAL_TEXT} characters or fewer.`,
        correlationId,
        diagnosticReason: "professional_text_too_long",
      });
    }

    const { entries } = loadPackEntries();
    const pack = entries.find((entry) => entry.id === packId)?.pack ?? null;
    if (!pack) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "That matter type is not available.",
        correlationId,
        diagnosticReason: "unknown_pack",
      });
    }

    const runner = createDefaultChecklistTailorModelRunner();
    const result = await runChecklistTailor(pack, professionalText, correlationId, runner);

    return NextResponse.json(result, { status: 200, headers: { [CORRELATION_HEADER]: correlationId } });
  });

  return run(request);
}