import { after, type NextRequest } from "next/server";

import { resolveAppOrigin } from "@/server/config/app-origin";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { generateHiveReport, getHiveReports } from "@/server/reports/reports";
import { loadPlannerServiceConfig } from "@/server/study-preparation/planner-client";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";
import { recoverExpiredWorkflowLeases } from "@/server/workflow/lease-recovery";
import { processReportRunSafely } from "@/server/workflow/report-generation";
import { createWorkerDeps, requireWorkerDispatch } from "@/server/workflow/worker";

/** Includes `after()` report generation. The write client aborts 30s before this. */
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const invocationStartedAt = Date.now();
  const run = withApiRoute("reports", "getHiveReports", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to see your reports.");
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
    const body = await getHiveReports(client, { hiveId, correlationId });
    return jsonWithCorrelation(body, 200, correlationId);
  });
  return run(request);
}

/** Generate again: one new Writer run for one audience over the accepted Study revision. */
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const invocationStartedAt = Date.now();
  const run = withApiRoute("reports", "generateHiveReport", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to generate a report.");
    const rawBody = await readJsonBody(request, correlationId);
    loadPlannerServiceConfig(process.env, correlationId);
    requireWorkerDispatch(process.env, correlationId);

    const started = await generateHiveReport(client, { hiveId, rawBody, correlationId });
    if (started.process) {
      const deps = createWorkerDeps(process.env, {
        origin: resolveAppOrigin({ requestUrl: request.url }),
        correlationId,
        invocationStartedAt,
      });
      after(() => processReportRunSafely(deps, started.response.reportRun.id));
    }
    return jsonWithCorrelation(started.response, 202, correlationId);
  });
  return run(request);
}
