import { createHiveError, isValidUuid } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = { params: Promise<{ hiveId: string }> };

/** A pending professional joins a personal Hive. Firm hives are refused by the RPC. */
export async function POST(_request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "activateProfessionalMembership", async ({ correlationId }) => {
    const { hiveId } = await context.params;
    const trimmed = hiveId?.trim().toLowerCase() ?? "";
    if (!isValidUuid(trimmed)) {
      throw createHiveError({
        errorCode: "NOT_FOUND",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "We could not find that Hive.",
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
        safeMessage: "Sign in to join this Hive.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const { data, error } = await auth.client.rpc("activate_professional_membership", { p_hive_id: trimmed });
    if (error) {
      const lowered = (typeof error.message === "string" ? error.message : "").toLowerCase();
      throw createHiveError({
        errorCode: lowered.includes("access_denied") || lowered.includes("42501") ? "ACCESS_DENIED" : "PERSISTENCE_FAILED",
        category: lowered.includes("access_denied") || lowered.includes("42501") ? "SECURITY" : "PERSISTENCE",
        stage: "SHELL",
        retryable: !(lowered.includes("access_denied") || lowered.includes("42501")),
        safeMessage:
          lowered.includes("access_denied") || lowered.includes("42501")
            ? "You can't join this Hive."
            : "Could not join this Hive. Try again.",
        correlationId,
        diagnosticReason: lowered.includes("access_denied") ? "access_denied" : "persistence_failed",
      });
    }

    return NextResponse.json(data ?? { hiveId: trimmed, memberState: "active" }, {
      status: 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(_request);
}
