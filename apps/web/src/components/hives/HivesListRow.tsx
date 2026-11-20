"use client";

import type { Hive } from "@hiveforyou/contracts";
import Link from "next/link";

import { StatusDot, type StatusDotState } from "@/components/ui/StatusDot";
import { hiveHomePath } from "@/lib/hive-routes";
import { hiveBadgeInitials } from "@/lib/hives/hive-badge-initials";
import { hiveRowStatuses, type HiveRowStatus } from "@/lib/hives/hive-list-copy";
import { formatHiveUpdated, hiveRowSubline } from "@/lib/hives/hive-row-copy";
import type { HiveSummary } from "@/server/hives/hive-summary";

import { HiveCardMenu } from "./HiveCardMenu";

const DOT_STATE: Record<HiveRowStatus["state"], StatusDotState> = {
  needs: "needs",
  changed: "changed",
  missing: "missing",
  unreadable: "missing",
  grey: "grey",
  leaf: "checked",
};

function MiniMeter({ received, total }: { received: number; total: number }) {
  const filled = Math.max(0, Math.min(received, total));
  return (
    <span
      className="flex w-[120px] max-w-full gap-0.5"
      role="img"
      aria-label={`${filled} of ${total} documents in`}
      data-testid="row-meter"
    >
      {Array.from({ length: total }, (_, index) => (
        <i
          key={index}
          aria-hidden
          className={`h-[5px] flex-1 rounded-[3px] ${index < filled ? "bg-leaf" : "bg-line"}`}
        />
      ))}
    </span>
  );
}

/**
 * One hive in Your hives. The whole row is a link to the hive; the options menu sits after it,
 * outside the link, as a quiet icon button.
 */
export function HivesListRow({
  hive,
  summary,
  viewerUserId,
  lastActivityAt,
  onRequestDelete,
  onKindChanged,
}: {
  hive: Hive;
  summary: HiveSummary | undefined;
  viewerUserId: string | null;
  lastActivityAt: string;
  onRequestDelete: (hive: Hive) => void;
  onKindChanged: () => void | Promise<void>;
}) {
  const sub = hiveRowSubline(hive, viewerUserId);
  const statuses = hiveRowStatuses(summary?.attention);
  const intake = summary?.intake;
  const showIntake = intake !== undefined && intake.total > 0;
  const updated = formatHiveUpdated(lastActivityAt);

  return (
    <li
      className="flex list-none items-center gap-2 border-b border-line hover:bg-mist hover:shadow-[-10px_0_0_var(--mist),10px_0_0_var(--mist)]"
      data-testid="clients-home-row"
    >
      <Link
        href={hiveHomePath(hive.id)}
        className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3.5 text-ink no-underline min-[760px]:grid-cols-[minmax(0,1.6fr)_150px_170px_minmax(0,1fr)] min-[760px]:gap-x-5"
      >
        <span className="flex min-w-0 items-center gap-3 max-[759px]:col-start-1 max-[759px]:row-start-1">
          <span
            aria-hidden
            className="inline-grid size-9 shrink-0 place-items-center rounded-[8px] bg-mist text-[12.5px] font-semibold text-ink-2"
          >
            {hiveBadgeInitials(hive.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-[1.35]">{hive.name}</span>
            {sub ? <span className="block truncate text-[13px] leading-[1.4] text-ink-3">{sub}</span> : null}
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-[5px] max-[759px]:col-start-1 max-[759px]:row-start-2">
          {showIntake ? (
            <>
              <MiniMeter received={intake.received} total={intake.total} />
              <span className="text-meta tabular-nums text-ink-3">
                {intake.received} of {intake.total} documents in
              </span>
            </>
          ) : null}
        </span>
        <span className="flex flex-col gap-[3px] max-[759px]:col-start-2 max-[759px]:row-start-1 max-[759px]:items-end">
          {statuses.map((status) => (
            <StatusDot key={status.label} state={DOT_STATE[status.state]} label={status.label} />
          ))}
        </span>
        <span
          className="text-[13px] text-ink-3 min-[760px]:text-right max-[759px]:col-start-2 max-[759px]:row-start-2 max-[759px]:text-right"
          suppressHydrationWarning
        >
          {updated}
        </span>
      </Link>
      <HiveCardMenu
        hiveId={hive.id}
        hiveName={hive.name}
        hiveKind={hive.kind}
        onDeleteHive={() => onRequestDelete(hive)}
        onKindChanged={onKindChanged}
        triggerClassName="flex size-10 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink min-[760px]:size-8"
      />
    </li>
  );
}
