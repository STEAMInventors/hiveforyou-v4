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

export async function PATCH(request: NextRequest): Promise<Response> {
  const run = withApiRoute("firm", "updateFirmPracticeAreas", async ({ correlationId, request: req }) => {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to update practice areas.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const firm = await loadFirm(auth.client);
    const role = firm?.firm?.callerRole;
    if (!firm?.firm || (role !== "owner" && role !== "attorney")) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "You cannot edit practice areas for this firm.",
        correlationId,
        diagnosticReason: "not_attorney_or_owner",
      });
    }

    const raw = await readJsonBody(req, correlationId);
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const practiceAreasRaw = Array.isArray(record?.practiceAreas)
      ? record.practiceAreas.filter((item): item is string => typeof item === "string")
      : [];
    const allowed = practiceAreaAllowlistFromPacks();
    const practiceAreas = validatePracticeAreasForFirm(practiceAreasRaw, allowed, correlationId);

    const { data, error } = await auth.client.rpc("update_firm_profile", {
      p_name: null,
      p_practice_areas: practiceAreas,
      p_places: null,
      p_languages: null,
      p_bio: null,
      p_listed: null,
    });
    if (error) {
      throw mapFirmRpcError(error, correlationId);
    }

    const updated = await loadFirm(auth.client);
    return NextResponse.json(updated ?? data, { headers: { [CORRELATION_HEADER]: correlationId } });
  });
  return run(request);
}