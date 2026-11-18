"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";
import { routeErrorReferences } from "@/lib/route-error-reference";

export default function MissingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { correlationId, errorDigest } = routeErrorReferences(error);
  return (
    <HiveRouteError
      message="Missing and conflicts could not load."
      correlationId={correlationId}
      errorDigest={errorDigest}
      retryable
      reset={reset}
    />
  );
}