import Link from "next/link";

import { StatusDot } from "@/components/ui/StatusDot";
import { hiveRequestedItemsPath } from "@/lib/hive-routes";

export const EVERYTHING_REQUESTED_IN = "Everything requested is in.";

/** Progress bar above the board thread while the hive has a checklist. */
export function HiveStillToCome({
  hiveId,
  progress,
}: {
  hiveId: string;
  progress: { in: number; total: number } | null;
}) {
  if (!progress || progress.total <= 0) return null;
  const complete = progress.in >= progress.total;
  const pct = Math.min(100, Math.round((progress.in / progress.total) * 100));
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-y border-line py-3 text-small text-ink-2"
      data-testid="hive-still-to-come"
    >
      {complete ? (
        <StatusDot state="checked" label={EVERYTHING_REQUESTED_IN} />
      ) : (
        <>
          <span>Still to come</span>
          <span className="h-1 max-w-[160px] flex-1 overflow-hidden rounded bg-line" aria-hidden>
            <span className="block h-full bg-leaf" style={{ width: `${pct}%` }} />
          </span>
          <span className="tabular-nums">
            {progress.in} of {progress.total} in
          </span>
          <Link href={hiveRequestedItemsPath(hiveId)} className="ms-auto text-label font-medium text-blue-deep no-underline hover:underline">
            See items →
          </Link>
        </>
      )}
    </div>
  );
}
