import { createHiveError } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { emitStructuredEvent } from "@/server/observability/logger";
import { withApiRoute } from "@/server/observability/with-api-route";
import { signedUrlShapeForLog } from "@/lib/signed-url-log-shape";
import { createLiveHiveVaultUploadAdapterDeps, openSourceDocumentPageWithV3Vault } from "@/server/source-documents/hive-vault-upload-adapter";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string; documentId: string }>;
};

/**
 * Returns a short-lived signed URL for embedding in the evidence viewer after the usual
 * ownership check. Body: `{ "pageNumber": number }`. POST avoids caching; response never includes document text or quotes.
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("sourceDocuments", "viewerOpen", async ({ correlationId }) => {
    const { hiveId, documentId } = await context.params;
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to view this document.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }
    const body = (await request.json().catch(() => null)) as { pageNumber?: unknown } | null;
    const page =
      body &&
      typeof body === "object" &&
      typeof body.pageNumber === "number" &&
      Number.isInteger(body.pageNumber) &&
      body.pageNumber >= 1
        ? body.pageNumber
        : null;
    if (page === null) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid page number.",
        correlationId,
        diagnosticReason: "invalid_page_number",
      });
    }
    const deps = createLiveHiveVaultUploadAdapterDeps(auth.client, correlationId);
    const { signedUrl: locationWithHash, mimeType } = await openSourceDocumentPageWithV3Vault(deps, {
      ownerUserId: auth.userId,
      hiveId,
      sourceDocumentId: documentId,
      pageNumber: String(page),
      correlationId,
    });
    const signedUrl = locationWithHash.includes("#") ? locationWithHash.slice(0, locationWithHash.indexOf("#")) : locationWithHash;
    const shape = signedUrlShapeForLog(signedUrl);
    if (shape.kind === "ok") {
      emitStructuredEvent({
        eventName: "viewerOpen.signedUrlReady",
        severity: "INFO",
        timestamp: new Date().toISOString(),
        component: "sourceDocuments",
        operation: "viewerOpen",
        correlationId,
        hiveId,
        sourceDocumentId: documentId,
        status: "OK",
        diagnosticReason: "unclassified",
        errorDetail: `host=${shape.host} scheme=${shape.scheme} pathSegments=${shape.pathSegmentCount}`,
      });
    }
    return Response.json(
      { signedUrl, mimeType },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", [CORRELATION_HEADER]: correlationId },
      },
    );
  });
  return run(request);
}
