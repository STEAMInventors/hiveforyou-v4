"use client";

import { useRouter } from "next/navigation";

import { WorkspaceError } from "./WorkspaceError";

export function WorkspaceLoadError({
  message,
  correlationId,
  retryable,
}: {
  message: string;
  correlationId: string;
  retryable: boolean;
}) {
  const router = useRouter();
  return (
    <WorkspaceError
      message={message}
      correlationId={correlationId}
      retryable={retryable}
      onRetry={retryable ? () => router.refresh() : undefined}
    />
  );
}
