"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";

export default function MissingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <HiveRouteError
      message="Missing and conflicts could not load."
      correlationId={error.digest ?? null}
      retryable
      reset={reset}
    />
  );
}