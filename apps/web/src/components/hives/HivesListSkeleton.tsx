/** Placeholder rows shown while Your hives loads. */
export function HivesListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading your hives" data-testid="hives-skeleton" className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-line py-3.5" aria-hidden>
          <span className="size-9 shrink-0 animate-pulse rounded-[8px] bg-mist" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3.5 w-40 max-w-full animate-pulse rounded-[4px] bg-mist" />
            <span className="h-3 w-56 max-w-full animate-pulse rounded-[4px] bg-mist" />
          </span>
          <span className="hidden h-3 w-28 animate-pulse rounded-[4px] bg-mist min-[760px]:block" />
        </div>
      ))}
    </div>
  );
}
