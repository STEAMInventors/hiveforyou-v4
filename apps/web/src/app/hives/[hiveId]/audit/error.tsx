"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";
import { routeErrorReferences } from "@/lib/route-error-reference";

export default function AuditError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { correlationId, errorDigest } = routeErrorReferences(error);
  return (
    <HiveRouteError
      message="Audit trail could not load."
      correlationId={correlationId}
      errorDigest={errorDigest}
      retryable
      reset={reset}
    />
  );
}
