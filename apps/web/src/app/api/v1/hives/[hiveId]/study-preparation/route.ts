import { after, type NextRequest } from "next/server";

import { resolveAppOrigin } from "@/server/config/app-origin";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { loadPlannerServiceConfig } from "@/server/study-preparation/planner-client";
import { getStudyPreparation, startStudyPreparation } from "@/server/study-preparation/study-preparation";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";
import { processAnalysisRunSafely } from "@/server/workflow/analysis-workflow";
import { recoverExpiredWorkflowLeases } from "@/server/workflow/lease-recovery";
import { processReportRunSafely } from "@/server/workflow/report-generation";
import { createWorkerDeps, requireWorkerDispatch } from "@/server/workflow/worker";

/** Includes `after()` analysis and report generation. The write client aborts 30s before this. */
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const invocationStartedAt = Date.now();
  const run = withApiRoute("studyPreparation", "getStudyPreparation", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to see analysis progress.");
    await recoverExpiredWorkflowLeases({
      client,
      hiveId,
      correlationId,
      createDispatch: () =>
        createWorkerDeps(process.env, {
          origin: resolveAppOrigin({ requestUrl: request.url }),
          correlationId,
          invocationStartedAt,
        }).dispatch,
    });
    const includePreview = request.nextUrl.searchParams.get("preview") === "1";
    const body = await getStudyPreparation(client, { hiveId, correlationId, includePreview });
    return jsonWithCorrelation(body, 200, correlationId);
  });
  return run(request);
}

/**
 * Analyze: starts or resumes the workflow. When a compatible accepted Study exists, reuses it and
 * dispatches only missing/failed Writer runs (or nothing when both reports exist or are active).
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const invocationStartedAt = Date.now();
  const run = withApiRoute("studyPreparation", "startStudyPreparation", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to analyze your documents.");
    const rawBody = await readJsonBody(request, correlationId);
    loadPlannerServiceConfig(process.env, correlationId);
    requireWorkerDispatch(process.env, correlationId);

    const started = await startStudyPreparation(client, { hiveId, rawBody, correlationId });
    const { response, queuedReportRunIds } = started;
    if (started.process) {
      const deps = createWorkerDeps(process.env, {
        origin: resolveAppOrigin({ requestUrl: request.url }),
        correlationId,
        invocationStartedAt,
      });
      after(() => processAnalysisRunSafely(deps, response.processingRun.id));
    } else if (queuedReportRunIds && queuedReportRunIds.length > 0) {
      const deps = createWorkerDeps(process.env, {
        origin: resolveAppOrigin({ requestUrl: request.url }),
        correlationId,
        invocationStartedAt,
      });
      for (const reportRunId of queuedReportRunIds) {
        after(() => processReportRunSafely(deps, reportRunId));
      }
    }
    return jsonWithCorrelation(response, response.reportsReady === true ? 200 : 202, correlationId);
  });
  return run(request);
}
