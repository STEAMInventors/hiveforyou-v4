import { after, type NextRequest } from "next/server";

import { resolveAppOrigin } from "@/server/config/app-origin";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { loadPlannerServiceConfig } from "@/server/study-preparation/planner-client";
import { acknowledgeStudyCoverage } from "@/server/study-preparation/study-preparation";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";
import { processAnalysisRunSafely } from "@/server/workflow/analysis-workflow";
import { createWorkerDeps, requireWorkerDispatch } from "@/server/workflow/worker";

export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

/** The owner reviewed the gaps reading found and continues the same run (no document is read again). */
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("studyPreparation", "acknowledgeStudyCoverage", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to continue your analysis.");
    const rawBody = await readJsonBody(request, correlationId);
    loadPlannerServiceConfig(process.env, correlationId);
    requireWorkerDispatch(process.env, correlationId);

    const acknowledged = await acknowledgeStudyCoverage(client, { hiveId, rawBody, correlationId });
    const { response } = acknowledged;
    if (acknowledged.process) {
      const deps = createWorkerDeps(process.env, {
        origin: resolveAppOrigin({ requestUrl: request.url }),
        correlationId,
      });
      after(() => processAnalysisRunSafely(deps, response.processingRun.id));
    }
    return jsonWithCorrelation(response, 202, correlationId);
  });
  return run(request);
}
