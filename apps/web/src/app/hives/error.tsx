"use client";

import { ClientsHomeSidebar } from "@/components/hives/ClientsHomeSidebar";
import { WorkspaceError } from "@/components/workspace/WorkspaceError";

export default function HivesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const emptyCounts = { needs: 0, ready: 0, all: 0, own: 0, mine: 0, unassigned: 0 };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-canvas min-[900px]:grid min-[900px]:grid-cols-[236px_minmax(0,1fr)]">
      <div className="hidden min-[900px]:block min-[900px]:border-r min-[900px]:border-line">
        <ClientsHomeSidebar
          queue="all"
          counts={emptyCounts}
          showFirmRail={false}
          hasOwnHives={false}
          searchActive={false}
          compact={false}
          onSelectQueue={() => undefined}
        />
      </div>
      <div className="mx-auto flex w-full max-w-workspace flex-1 flex-col px-4 py-6 min-[900px]:px-8">
        <WorkspaceError
          message="Your clients could not load. Your account and other hives are unchanged."
          correlationId={error.digest ?? null}
          retryable
          onRetry={reset}
        />
      </div>
    </div>
  );
}