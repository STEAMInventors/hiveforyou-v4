import { isValidCorrelationId } from "@hiveforyou/contracts";

export const CORRELATION_HEADER = "x-correlation-id";

export type CorrelationResolution = {
  correlationId: string;
  regenerated: boolean;
};

export function resolveCorrelationId(headerValue: string | null): CorrelationResolution {
  const trimmed = headerValue?.trim();
  if (trimmed && isValidCorrelationId(trimmed)) {
    return { correlationId: trimmed, regenerated: false };
  }
  return { correlationId: crypto.randomUUID(), regenerated: Boolean(trimmed) };
}
