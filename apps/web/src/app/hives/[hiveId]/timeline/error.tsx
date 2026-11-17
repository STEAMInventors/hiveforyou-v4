"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";

export default function TimelineError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <HiveRouteError message="Timeline could not load." correlationId={error.digest ?? null} retryable reset={reset} />
  );
}