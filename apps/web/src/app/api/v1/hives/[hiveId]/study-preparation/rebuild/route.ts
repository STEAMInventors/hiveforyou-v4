import { after, type NextRequest } from "next/server";

import { resolveAppOrigin } from "@/server/config/app-origin";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { loadPlannerServiceConfig } from "@/server/study-preparation/planner-client";
import { rebuildStudy } from "@/server/study-preparation/study-preparation";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";
import { markRebuildWithoutDomainPack } from "@/server/workflow/domain-pack-rebuild-opt-out";
import { processAnalysisRunSafely } from "@/server/workflow/analysis-workflow";
import { createWorkerDeps, requireWorkerDispatch } from "@/server/workflow/worker";

export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

/**
 * Rebuild Study: owner-only. Starts a new Canonical Study revision from the pages and intent
 * already saved. Does not upload, re-read, or dispatch Writer.
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("studyPreparation", "rebuildStudy", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to rebuild the study.");
    const rawBody = await readJsonBody(request, correlationId);
    loadPlannerServiceConfig(process.env, correlationId);
    requireWorkerDispatch(process.env, correlationId);

    const started = await rebuildStudy(client, { hiveId, rawBody, correlationId });
    if (started.withoutDomainPack) {
      markRebuildWithoutDomainPack(started.response.processingRun.id);
    }
    if (started.process) {
      const deps = createWorkerDeps(process.env, {
        origin: resolveAppOrigin({ requestUrl: request.url }),
        correlationId,
      });
      after(() => processAnalysisRunSafely(deps, started.response.processingRun.id));
    }
    const settled = started.response.processingRun.status === "SUCCEEDED";
    return jsonWithCorrelation(started.response, settled ? 200 : 202, correlationId);
  });
  return run(request);
}
