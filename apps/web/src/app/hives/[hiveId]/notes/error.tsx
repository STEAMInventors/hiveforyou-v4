"use client";

import { HiveRouteError } from "@/components/workspace/HiveRouteError";

export default function NotesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <HiveRouteError message="Team notes could not load." correlationId={error.digest ?? null} retryable reset={reset} />
  );
}