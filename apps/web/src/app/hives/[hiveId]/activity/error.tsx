"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";

export default function ActivityError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <HiveRouteError
      message="What happened could not load."
      correlationId={error.digest ?? null}
      retryable
      reset={reset}
    />
  );
}