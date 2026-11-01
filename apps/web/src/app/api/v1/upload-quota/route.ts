import { createHiveError } from "@hiveforyou/contracts";

import {
  createLiveHiveVaultUploadAdapterDeps,
  getUploadQuotaWithV3Vault,
} from "@/server/source-documents/hive-vault-upload-adapter";
import { jsonWithCorrelation, withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export const GET = withApiRoute("sourceDocuments", "getUploadQuota", async ({ correlationId }) => {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
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
  const deps = createLiveHiveVaultUploadAdapterDeps(auth.client, correlationId);
  const body = await getUploadQuotaWithV3Vault(deps, auth.userId, correlationId);
  return jsonWithCorrelation(body, 200, correlationId);
});
