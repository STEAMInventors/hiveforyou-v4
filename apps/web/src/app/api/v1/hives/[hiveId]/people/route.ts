import { createHiveError, isValidUuid } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = { params: Promise<{ hiveId: string }> };

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "listHivePeople", async ({ correlationId }) => {
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
        safeMessage: "Sign in to continue.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const { data, error } = await auth.client.rpc("list_hive_people", {
      p_hive_id: hiveId.trim().toLowerCase(),
    });

    if (error) {
      throw createHiveError({
        errorCode: "NOT_FOUND",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "We could not find that Hive.",
        correlationId,
        diagnosticReason: "not_found",
      });
    }

    return NextResponse.json(data, {
      status: 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(_request);
}