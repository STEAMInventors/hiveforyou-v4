import {
  CORRELATION_HEADER as HEADER,
  resolveCorrelationId as resolveV4CorrelationId,
} from "@/server/observability/correlation";

export const CORRELATION_HEADER = HEADER;

export function resolveCorrelationId(rawHeader: string | null | undefined): string {
  return resolveV4CorrelationId(rawHeader ?? null).correlationId;
}
