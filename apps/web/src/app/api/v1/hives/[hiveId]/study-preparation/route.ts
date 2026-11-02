import { after, type NextRequest } from "next/server";

import { resolveAppOrigin } from "@/server/config/app-origin";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { loadPlannerServiceConfig } from "@/server/study-preparation/planner-client";
import { getStudyPreparation, startStudyPreparation } from "@/server/study-preparation/study-preparation";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";
import { processAnalysisRunSafely } from "@/server/workflow/analysis-workflow";
import { createWorkerDeps, requireWorkerDispatch } from "@/server/workflow/worker";

export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("studyPreparation", "getStudyPreparation", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to see analysis progress.");
    const includePreview = request.nextUrl.searchParams.get("preview") === "1";
    const body = await getStudyPreparation(client, { hiveId, correlationId, includePreview });
    return jsonWithCorrelation(body, 200, correlationId);
  });
  return run(request);
}

/** Analyze: starts the whole chain. Later stages hand off server-side through the internal worker route. */
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("studyPreparation", "startStudyPreparation", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to analyze your documents.");
    const rawBody = await readJsonBody(request, correlationId);
    loadPlannerServiceConfig(process.env, correlationId);
    requireWorkerDispatch(process.env, correlationId);

    const started = await startStudyPreparation(client, { hiveId, rawBody, correlationId });
    const { response } = started;
    if (started.process) {
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
