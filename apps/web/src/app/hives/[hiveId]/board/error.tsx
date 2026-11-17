"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";

export default function BoardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <HiveRouteError
      message="The hive board could not load."
      correlationId={error.digest ?? null}
      retryable
      reset={reset}
    />
  );
}