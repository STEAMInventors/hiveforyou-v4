import type { NextRequest } from "next/server";

import { getFailureDiagnostics } from "@/server/observability/failure-lookup";
import { jsonWithCorrelation, withApiRoute } from "@/server/observability/with-api-route";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

/** Read-only support lookup. The owner sees safe diagnostic fields for one correlation id. */
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("diagnostics", "getFailureDiagnostics", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to look up a support reference.");
    const reference = request.nextUrl.searchParams.get("correlationId") ?? "";
    const body = await getFailureDiagnostics(client, { hiveId, correlationId, reference });
    return jsonWithCorrelation(body, 200, correlationId);
  });
  return run(request);
}
