"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";
import { routeErrorReferences } from "@/lib/route-error-reference";

export default function HiveLayoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { correlationId, errorDigest } = routeErrorReferences(error);
  return (
    <HiveRouteError
      layoutLevel
      message="This hive could not load. Your account and other hives are unchanged."
      correlationId={correlationId}
      errorDigest={errorDigest}
      retryable
      reset={reset}
    />
  );
}