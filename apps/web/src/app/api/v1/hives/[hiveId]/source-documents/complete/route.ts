import type { NextRequest } from "next/server";

import {
  completeHiveSourceDocumentFromApiBody,
  createLiveHiveVaultUploadAdapterDeps,
} from "@/server/source-documents/hive-vault-upload-adapter";
import { jsonWithCorrelation, withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("sourceDocuments", "completeSourceDocument", async ({ correlationId }) => {
    const { hiveId } = await context.params;
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      const { createHiveError } = await import("@hiveforyou/contracts");
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to continue.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      const { createHiveError } = await import("@hiveforyou/contracts");
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "REGISTER",
        retryable: false,
        safeMessage: "Request body must be JSON.",
        correlationId,
        diagnosticReason: "invalid_payload_shape",
      });
    }
    const deps = createLiveHiveVaultUploadAdapterDeps(auth.client, correlationId);
    const result = await completeHiveSourceDocumentFromApiBody(
      deps,
      hiveId,
      auth.userId,
      rawBody,
      correlationId,
    );
    return jsonWithCorrelation(
      { sourceDocument: result.sourceDocument },
      result.created ? 201 : 200,
      correlationId,
    );
  });
  return run(request);
}
