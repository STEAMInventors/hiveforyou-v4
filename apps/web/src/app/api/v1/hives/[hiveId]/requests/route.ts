import { parseAddRequest } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";

import {
  listHiveRequests,
  mapRequestRpcError,
  REQUEST_ACTION_FAILED,
  requestInvalid,
  requireRequestRouteUser,
} from "@/server/hives/hive-requests";
import { jsonWithCorrelation, readJsonBody, withApiRoute } from "@/server/observability/with-api-route";

type RouteContext = { params: Promise<{ hiveId: string }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "listHiveRequests", async ({ correlationId }) => {
    const { hiveId, auth } = await requireRequestRouteUser((await context.params).hiveId, correlationId);
    const listed = await listHiveRequests(auth.client, hiveId, correlationId);
    return jsonWithCorrelation(listed, 200, correlationId);
  });
  return run(request);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "addHiveRequest", async ({ correlationId, request: req }) => {
    const { hiveId, auth } = await requireRequestRouteUser((await context.params).hiveId, correlationId);
    const parsed = parseAddRequest(await readJsonBody(req, correlationId));
    if (!parsed.ok) throw requestInvalid(parsed.field, correlationId);

    const { error } = await auth.client.rpc("add_request", {
      p_hive_id: hiveId,
      p_title: parsed.value.title,
      p_detail: parsed.value.detail,
    });
    if (error) throw mapRequestRpcError(error, correlationId, REQUEST_ACTION_FAILED);

    const listed = await listHiveRequests(auth.client, hiveId, correlationId);
    return jsonWithCorrelation(listed, 201, correlationId);
  });
  return run(request);
}
