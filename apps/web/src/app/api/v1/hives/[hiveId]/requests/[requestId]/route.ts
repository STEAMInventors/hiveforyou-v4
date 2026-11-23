import { isValidUuid, parseRequestAction } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";

import { hiveMessageNoticeTarget, sendHiveMessageNotices } from "@/server/hives/hive-message-notices";
import {
  listHiveRequests,
  requestInvalid,
  requestNotFound,
  requireRequestRouteUser,
  runRequestAction,
} from "@/server/hives/hive-requests";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";

type RouteContext = { params: Promise<{ hiveId: string; requestId: string }> };

const IDEMPOTENCY_HEADER = "idempotency-key";

/** Upload attach, client response, reply, or staff resolution on one request. Returns the refreshed list. */
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "hiveRequestAction", async ({ correlationId, request: req }) => {
    const params = await context.params;
    const { hiveId, auth } = await requireRequestRouteUser(params.hiveId, correlationId);
    const requestId = params.requestId?.trim().toLowerCase() ?? "";
    if (!isValidUuid(requestId)) throw requestNotFound(correlationId);

    const parsed = parseRequestAction(await readJsonBody(req, correlationId));
    if (!parsed.ok) throw requestInvalid(parsed.field, correlationId);

    let clientRequestId: string | null = null;
    if (parsed.value.action === "reply") {
      clientRequestId = req.headers.get(IDEMPOTENCY_HEADER)?.trim().toLowerCase() ?? "";
      if (!isValidUuid(clientRequestId)) throw requestInvalid("client_request_id", correlationId);
    }

    const result = await runRequestAction(
      auth.client,
      { hiveId, requestId, action: parsed.value, clientRequestId },
      correlationId,
    );

    if (!result.duplicate && result.notifyUserIds.length > 0) {
      await sendHiveMessageNotices({
        userIds: result.notifyUserIds,
        ...(await hiveMessageNoticeTarget(auth.client, req, hiveId)),
        correlationId,
      }).catch(() => undefined);
    }

    const listed = await listHiveRequests(auth.client, hiveId, correlationId);
    return jsonWithCorrelation({ ...listed, duplicate: result.duplicate }, 200, correlationId);
  });
  return run(request);
}
