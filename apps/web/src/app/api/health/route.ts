import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";

export const GET = withApiRoute("shell", "healthCheck", ({ correlationId }) => {
  return NextResponse.json(
    { ok: true, correlationId },
    { headers: { [CORRELATION_HEADER]: correlationId } },
  );
});
