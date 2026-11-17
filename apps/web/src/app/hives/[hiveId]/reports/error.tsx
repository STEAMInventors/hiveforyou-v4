"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";

export default function ReportsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <HiveRouteError message="Reports could not load." correlationId={error.digest ?? null} retryable reset={reset} />
  );
}