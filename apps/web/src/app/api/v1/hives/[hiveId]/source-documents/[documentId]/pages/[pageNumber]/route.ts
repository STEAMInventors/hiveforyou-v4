import { createHiveError } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import {
  createLiveHiveVaultUploadAdapterDeps,
  openSourceDocumentPageWithV3Vault,
} from "@/server/source-documents/hive-vault-upload-adapter";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string; documentId: string; pageNumber: string }>;
};

/** Source chip target (D-011): redirects the owner to the original file at that physical page. */
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("sourceDocuments", "openSourcePage", async ({ correlationId }) => {
    const { hiveId, documentId, pageNumber } = await context.params;
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to open this page.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }
    const deps = createLiveHiveVaultUploadAdapterDeps(auth.client, correlationId);
    const location = await openSourceDocumentPageWithV3Vault(deps, {
      ownerUserId: auth.userId,
      hiveId,
      sourceDocumentId: documentId,
      pageNumber,
      correlationId,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: location, "Cache-Control": "no-store", [CORRELATION_HEADER]: correlationId },
    });
  });
  return run(request);
}
