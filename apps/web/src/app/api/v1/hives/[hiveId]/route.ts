import { createHiveError, isValidUuid } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getHiveViaEdge } from "@/server/hives/hive-edge-gateway";
import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const run = withApiRoute("hives", "getHive", async ({ correlationId }) => {
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
        safeMessage: "Sign in to open this Hive.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const body = await getHiveViaEdge(auth.client, hiveId, correlationId);
    return NextResponse.json(body, {
      status: 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(request);
}
