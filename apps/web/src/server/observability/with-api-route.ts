import {
  suggestedHttpStatus,
  toPublicErrorResponse,
} from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER, resolveCorrelationId } from "./correlation";
import { emitStructuredEvent } from "./logger";
import { mapExceptionToHiveError } from "./map-exception-to-hive-error";

export type ApiRouteContext = {
  correlationId: string;
  request: NextRequest;
};

type ApiRouteHandler = (context: ApiRouteContext) => Promise<Response> | Response;

export function withApiRoute(
  component: string,
  operation: string,
  handler: ApiRouteHandler,
): (request: NextRequest) => Promise<Response> {
  return async (request: NextRequest) => {
    const started = Date.now();
    const { correlationId, regenerated } = resolveCorrelationId(
      request.headers.get(CORRELATION_HEADER),
    );

    if (regenerated) {
      emitStructuredEvent({
        eventName: "request.correlation.regenerated",
        severity: "INFO",
        timestamp: new Date().toISOString(),
        component,
        operation,
        stage: "SHELL",
        correlationId,
        status: "OK",
        diagnosticReason: "correlation_regenerated",
      });
    }

    emitStructuredEvent({
      eventName: `${operation}.started`,
      severity: "INFO",
      timestamp: new Date().toISOString(),
      component,
      operation,
      stage: "SHELL",
      correlationId,
      status: "RUNNING",
    });

    try {
      const response = await handler({ correlationId, request });
      const durationMs = Date.now() - started;

      emitStructuredEvent({
        eventName: `${operation}.completed`,
        severity: "INFO",
        timestamp: new Date().toISOString(),
        component,
        operation,
        stage: "SHELL",
        correlationId,
        status: "SUCCEEDED",
        durationMs,
      });

      if (response.headers.get(CORRELATION_HEADER)) {
        return response;
      }
      const headers = new Headers(response.headers);
      headers.set(CORRELATION_HEADER, correlationId);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      const hiveError = mapExceptionToHiveError(error, correlationId);

      emitStructuredEvent({
        eventName: `${operation}.failed`,
        severity: "ERROR",
        timestamp: new Date().toISOString(),
        component,
        operation,
        stage: hiveError.stage,
        correlationId,
        status: "FAILED",
        errorCode: hiveError.errorCode,
        retryable: hiveError.retryable,
        durationMs,
        diagnosticReason: hiveError.diagnosticReason ?? "unexpected_exception",
      });

      return NextResponse.json(toPublicErrorResponse(hiveError), {
        status: suggestedHttpStatus(hiveError.errorCode),
        headers: { [CORRELATION_HEADER]: correlationId },
      });
    }
  };
}
