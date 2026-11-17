"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";

export default function FactsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <HiveRouteError message="Facts could not load." correlationId={error.digest ?? null} retryable reset={reset} />
  );
}