"use client";

import Link from "next/link";

import { TEXT_LINK_CLASS } from "@/components/button-classes";

import { WorkspaceError } from "./WorkspaceError";

export function HiveRouteError({
  message,
  correlationId,
  retryable,
  reset,
  layoutLevel = false,
}: {
  message: string;
  correlationId?: string | null;
  retryable?: boolean;
  reset?: () => void;
  layoutLevel?: boolean;
}) {
  if (layoutLevel) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
        <WorkspaceError
          message={message}
          correlationId={correlationId}
          retryable={retryable}
          onRetry={reset}
        />
        <Link href="/hives" className={TEXT_LINK_CLASS}>
          Back to your hives
        </Link>
      </main>
    );
  }

  return (
    <div className="p-4 min-[900px]:p-6">
      <WorkspaceError message={message} correlationId={correlationId} retryable={retryable} onRetry={reset} />
    </div>
  );
}