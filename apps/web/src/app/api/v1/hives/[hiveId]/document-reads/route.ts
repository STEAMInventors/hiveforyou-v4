import { loadSupabaseAdminEnv } from "@hives/persistence/env";
import { createSupabaseAdminClient } from "@hives/persistence/storage/supabase-client";
import { after, type NextRequest } from "next/server";

import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import {
  listDocumentReads,
  processDocumentReads,
  startDocumentReads,
} from "@/server/source-documents/document-reads";
import { loadReaderServiceConfig } from "@/server/source-documents/read-document";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";

export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("sourceDocuments", "listDocumentReads", async ({ correlationId }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to see reading progress.");
    const body = await listDocumentReads(client, { hiveId, correlationId });
    return jsonWithCorrelation(body, 200, correlationId);
  });
  return run(request);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("sourceDocuments", "startDocumentReads", async ({ correlationId, request }) => {
    const { hiveId } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to read your documents.");
    const rawBody = await readJsonBody(request, correlationId);

    const readerConfig = loadReaderServiceConfig(process.env, correlationId);
    const serviceClient = createSupabaseAdminClient(loadSupabaseAdminEnv(process.env));

    const { response, queuedReadIds } = await startDocumentReads(client, {
      hiveId,
      rawBody,
      correlationId,
    });
    if (queuedReadIds.length > 0) {
      after(() =>
        processDocumentReads(
          { client: serviceClient, reader: { getReaderConfig: () => readerConfig } },
          queuedReadIds,
        ),
      );
    }
    return jsonWithCorrelation(response, 202, correlationId);
  });
  return run(request);
}
