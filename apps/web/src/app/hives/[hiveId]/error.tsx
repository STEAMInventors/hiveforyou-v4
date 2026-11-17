"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";

export default function HiveLayoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <HiveRouteError
      layoutLevel
      message="This hive could not load. Your account and other hives are unchanged."
      correlationId={error.digest ?? null}
      retryable
      reset={reset}
    />
  );
}