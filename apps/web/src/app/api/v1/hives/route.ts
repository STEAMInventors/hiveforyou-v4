import { createHiveError } from "@hiveforyou/contracts";
import { NextResponse } from "next/server";

import {
  createHiveViaEdge,
  listHivesViaEdge,
} from "@/server/hives/hive-edge-gateway";
import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export const GET = withApiRoute("hives", "listHives", async ({ correlationId }) => {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    throw createHiveError({
      errorCode: "UNAUTHENTICATED",
      category: "SECURITY",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Sign in to see your Hives.",
      correlationId,
      diagnosticReason: auth.diagnosticReason,
    });
  }

  const body = await listHivesViaEdge(auth.client, correlationId);
  return NextResponse.json(body, {
    status: 200,
    headers: { [CORRELATION_HEADER]: correlationId },
  });
});

export const POST = withApiRoute(
  "hives",
  "createHive",
  async ({ correlationId, request }) => {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Request body must be valid JSON.",
        correlationId,
        diagnosticReason: "invalid_json",
      });
    }

    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to create a Hive.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const body = await createHiveViaEdge(auth.client, rawBody, correlationId);
    return NextResponse.json(body, {
      status: body.created ? 201 : 200,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  },
);
