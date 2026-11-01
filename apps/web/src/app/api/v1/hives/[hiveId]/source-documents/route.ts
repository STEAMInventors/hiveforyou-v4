import type { NextRequest } from "next/server";

import {
  createLiveHiveVaultUploadAdapterDeps,
  listHiveSourceDocumentsWithV3Vault,
  prepareHiveSourceDocumentFromApiBody,
} from "@/server/source-documents/hive-vault-upload-adapter";
import { jsonWithCorrelation, withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string }>;
};

async function requireOwner(correlationId: string) {
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
  return auth;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("sourceDocuments", "listSourceDocuments", async ({ correlationId }) => {
    const { hiveId } = await context.params;
    const auth = await requireOwner(correlationId);
    const deps = createLiveHiveVaultUploadAdapterDeps(auth.client, correlationId);
    const body = await listHiveSourceDocumentsWithV3Vault(deps, {
      ownerUserId: auth.userId,
      hiveId,
      correlationId,
    });
    return jsonWithCorrelation(body, 200, correlationId);
  });
  return run(request);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("sourceDocuments", "prepareSourceDocument", async ({ correlationId }) => {
    const { hiveId } = await context.params;
    const auth = await requireOwner(correlationId);
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
    const result = await prepareHiveSourceDocumentFromApiBody(
      deps,
      hiveId,
      auth.userId,
      rawBody,
      correlationId,
    );
    return jsonWithCorrelation(result, result.created ? 201 : 200, correlationId);
  });
  return run(request);
}
