import { createHiveError } from "@hiveforyou/contracts";
import { after, type NextRequest } from "next/server";

import { resolveAppOrigin } from "@/server/config/app-origin";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";
import { isAuthorizedWorkerRequest, loadInternalWorkerToken, parseWorkItem } from "@/server/workflow/dispatch";
import { createWorkerDeps, runWorkItem } from "@/server/workflow/worker";

/**
 * Internal hand-off endpoint for chained workflow invocations. Not for browsers: it requires
 * `Authorization: Bearer <HIVE_INTERNAL_WORKER_TOKEN>` and refuses every request when the token is
 * not configured. Work runs in `after()`; the caller only learns it was accepted.
 * Report generation in that `after()` has this function's full lifetime. The write client aborts 30s before it.
 */
export const maxDuration = 300;

export async function POST(request: NextRequest): Promise<Response> {
  const invocationStartedAt = Date.now();
  const run = withApiRoute("workflow", "dispatchWork", async ({ correlationId, request }) => {
    const token = loadInternalWorkerToken(process.env);
    if (!isAuthorizedWorkerRequest(request.headers.get("authorization"), token)) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Not allowed.",
        correlationId,
        diagnosticReason: token ? "worker_unauthorized" : "dispatch_unconfigured",
      });
    }
    const item = parseWorkItem(await readJsonBody(request, correlationId));
    if (!item) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Unknown work item.",
        correlationId,
        diagnosticReason: "invalid_payload_shape",
      });
    }
    const deps = createWorkerDeps(process.env, {
      origin: resolveAppOrigin({ requestUrl: request.url }),
      correlationId,
      invocationStartedAt,
    });
    after(() => runWorkItem(deps, item));
    return jsonWithCorrelation({ accepted: true }, 202, correlationId);
  });
  return run(request);
}
