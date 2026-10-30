import type { Hive } from "@hiveforyou/contracts";
import Link from "next/link";

import { hiveDocumentsPath } from "@/lib/hive-routes";

import { HiveCardMenu } from "./HiveCardMenu";

function formatHiveActivity(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return `Updated ${parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

function HiveCard({ hive }: { hive: Hive }) {
  const href = hiveDocumentsPath(hive.id);
  return (
    <li className="flex min-h-[190px] flex-col justify-between rounded-[18px] border border-line bg-paper p-5 shadow-[0_1px_2px_rgba(31,35,40,0.04)] transition-shadow hover:shadow-[0_8px_24px_rgba(31,35,40,0.08)]">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="m-0 min-w-0 flex-1 break-words font-brand text-[21px] font-semibold text-ink">
            <Link href={href} className="text-ink no-underline hover:text-cell-blue-deep">
              {hive.name}
            </Link>
          </h2>
          <HiveCardMenu hiveId={hive.id} hiveName={hive.name} />
        </div>
        {hive.description ? (
          <p className="mb-0 mt-2 line-clamp-2 text-sm text-ink-muted">{hive.description}</p>
        ) : null}
        <p className="mb-0 mt-2 text-sm text-ink-muted">No accepted Study yet</p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="m-0 text-xs text-ink-muted">{formatHiveActivity(hive.updatedAt)}</p>
        <Link
          href={href}
          className="text-sm font-semibold text-cell-blue-deep no-underline hover:underline"
          aria-label={`Open Hive ${hive.name}`}
        >
          Open Hive
        </Link>
      </div>
    </li>
  );
}

export function HiveCardGrid({ hives }: { hives: Hive[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-5 p-0">
      {hives.map((hive) => (
        <HiveCard key={hive.id} hive={hive} />
      ))}
    </ul>
  );
}
