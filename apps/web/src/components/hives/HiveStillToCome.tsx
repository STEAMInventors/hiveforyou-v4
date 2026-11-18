import Link from "next/link";

import { StatusDot } from "@/components/workspace/StatusDot";
import { hiveRequestedItemsPath } from "@/lib/hive-routes";

export const EVERYTHING_REQUESTED_IN = "Everything requested is in.";

/** One line above the conversation while the hive has a checklist. */
export function HiveStillToCome({
  hiveId,
  progress,
}: {
  hiveId: string;
  progress: { in: number; total: number } | null;
}) {
  if (!progress || progress.total <= 0) return null;
  return (
    <p className="m-0 text-small text-graphite" data-testid="hive-still-to-come">
      {progress.in >= progress.total ? (
        <StatusDot state="checked" label={EVERYTHING_REQUESTED_IN} />
      ) : (
        <>
          {`Still to come · ${progress.in} of ${progress.total} in · `}
          <Link href={hiveRequestedItemsPath(hiveId)} className="font-medium text-cell-blue-deep">
            See items →
          </Link>
        </>
      )}
    </p>
  );
}
