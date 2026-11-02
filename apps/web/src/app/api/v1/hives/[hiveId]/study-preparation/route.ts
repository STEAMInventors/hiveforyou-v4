import { loadSupabaseAdminEnv } from "@hives/persistence/env";
import { createSupabaseAdminClient } from "@hives/persistence/storage/supabase-client";
import { after, type NextRequest } from "next/server";

import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { loadPlannerServiceConfig } from "@/server/study-preparation/planner-client";
import { loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";
import {
  getStudyPreparation,
  processStudyPreparationSafely,
  startStudyPreparation,
} from "@/server/study-preparation/study-preparation";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";

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

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("studyPreparation", "startStudyPreparation", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to analyze your documents.");
    const rawBody = await readJsonBody(request, correlationId);

    const plannerConfig = loadPlannerServiceConfig(process.env, correlationId);
    const catalog = loadPromptCatalog();
    const serviceClient = createSupabaseAdminClient(loadSupabaseAdminEnv(process.env));

    const started = await startStudyPreparation(client, { hiveId, rawBody, correlationId });
    const { response } = started;
    if (started.process) {
      after(() =>
        processStudyPreparationSafely(
          { client: serviceClient, planner: { getConfig: () => plannerConfig }, loadCatalog: () => catalog },
          response.processingRun.id,
        ),
      );
    }
    return jsonWithCorrelation(response, 202, correlationId);
  });
  return run(request);
}
