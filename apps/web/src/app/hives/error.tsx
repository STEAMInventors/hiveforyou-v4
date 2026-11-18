"use client";

import Link from "next/link";

import { TEXT_LINK_CLASS } from "@/components/button-classes";
import { WorkspaceError } from "@/components/workspace/WorkspaceError";
import { routeErrorReferences } from "@/lib/route-error-reference";

export default function HivesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { correlationId, errorDigest } = routeErrorReferences(error);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-lg flex-col items-center justify-center gap-4 px-4 py-12">
      <WorkspaceError
        message="Your clients could not load. Your account and other hives are unchanged."
        correlationId={correlationId}
        errorDigest={errorDigest}
        retryable
        onRetry={reset}
      />
      <Link href="/hives" className={TEXT_LINK_CLASS}>
        Back to your hives
      </Link>
    </main>
  );
}