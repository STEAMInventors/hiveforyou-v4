import { CORRELATION_HEADER, resolveCorrelationId } from "@/server/observability/correlation";
import { emitStructuredEvent } from "@/server/observability/logger";

export async function register() {
  // Runtime hooks are added as Next.js expands the instrumentation surface.
}

export const onRequestError = async (
  error: unknown,
  request: { headers: Headers },
  context: { digest?: string },
) => {
  const headerCorrelation = request.headers.get(CORRELATION_HEADER);
  const { correlationId, regenerated } = resolveCorrelationId(headerCorrelation);
  const digest = typeof context.digest === "string" ? context.digest : "unknown";

  emitStructuredEvent({
    eventName: "request.error",
    severity: "ERROR",
    timestamp: new Date().toISOString(),
    component: "next",
    operation: "onRequestError",
    stage: "SHELL",
    correlationId,
    status: "FAILED",
    diagnosticReason: regenerated ? "correlation_regenerated" : "server_render_error",
    errorDetail: digest,
    exceptionType: error instanceof Error ? error.name : typeof error,
  });
};