import type { NextRequest } from "next/server";

import { createIntentRequestForOwnedHive } from "@/server/source-documents/hive-vault-upload-adapter";
import {
  jsonWithCorrelation,
  readJsonBody,
  withApiRoute,
} from "@/server/observability/with-api-route";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("sourceDocuments", "createIntentRequest", async ({ correlationId }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to continue.");
    const rawBody = await readJsonBody(request, correlationId);
    const body = await createIntentRequestForOwnedHive(client, hiveId, rawBody, correlationId);
    return jsonWithCorrelation(body, body.created ? 201 : 200, correlationId);
  });
  return run(request);
}
