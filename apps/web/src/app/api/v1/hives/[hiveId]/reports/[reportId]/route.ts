import type { NextRequest } from "next/server";

import { jsonWithCorrelation, withApiRoute } from "@/server/observability/with-api-route";
import { getHiveReport } from "@/server/reports/reports";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string; reportId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("reports", "getHiveReport", async ({ correlationId }) => {
    const { hiveId, reportId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to see this report.");
    const body = await getHiveReport(client, { hiveId, reportId, correlationId });
    return jsonWithCorrelation(body, 200, correlationId);
  });
  return run(request);
}
