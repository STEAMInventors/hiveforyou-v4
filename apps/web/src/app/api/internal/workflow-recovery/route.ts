import { createHiveError } from "@hiveforyou/contracts";
import { type NextRequest } from "next/server";

import { resolveAppOrigin } from "@/server/config/app-origin";
import { jsonWithCorrelation, withApiRoute } from "@/server/observability/with-api-route";
import { isAuthorizedCronRequest, loadCronSecret } from "@/server/workflow/cron-auth";
import { loadInternalWorkerToken } from "@/server/workflow/dispatch";
import { sweepWorkflowRecovery } from "@/server/workflow/workflow-recovery-sweep";
import { createWorkerDeps } from "@/server/workflow/worker";

/**
 * Vercel Cron recovery sweeper: expired leases and lost hand-offs without an owner GET.
 * Authenticated via CRON_SECRET (or HIVE_INTERNAL_WORKER_TOKEN for manual calls).
 */
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<Response> {
  const invocationStartedAt = Date.now();
  const run = withApiRoute("workflow", "recoverySweep", async ({ correlationId, request: req }) => {
    if (!loadCronSecret(process.env) && !loadInternalWorkerToken(process.env)) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Not allowed.",
        correlationId,
        diagnosticReason: "cron_unconfigured",
      });
    }
    if (!isAuthorizedCronRequest(req.headers.get("authorization"))) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Not allowed.",
        correlationId,
        diagnosticReason: "cron_unauthorized",
      });
    }
    const deps = createWorkerDeps(process.env, {
      origin: resolveAppOrigin({ requestUrl: req.url }),
      correlationId,
      invocationStartedAt,
    });
    const result = await sweepWorkflowRecovery({
      client: deps.client,
      correlationId,
      createDispatch: () => deps.dispatch,
    });
    return jsonWithCorrelation(
      {
        hivesScanned: result.hivesScanned,
        dispatchCount: result.revived.length,
        revived: result.revived.map((item) => ({ kind: item.kind, id: item.id })),
      },
      200,
      correlationId,
    );
  });
  return run(request);
}
