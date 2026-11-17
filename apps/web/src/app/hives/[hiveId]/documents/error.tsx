"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";

export default function DocumentsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <HiveRouteError message="Documents could not load." correlationId={error.digest ?? null} retryable reset={reset} />
  );
}