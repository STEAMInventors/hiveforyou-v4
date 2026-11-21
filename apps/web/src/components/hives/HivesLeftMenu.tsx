"use client";

import type { ClientsHomeQueue, ClientsHomeQueueCounts } from "@/lib/hives/clients-home-queue";
import { hiveBadgeInitials } from "@/lib/hives/hive-badge-initials";

import { ClientsHomeQueueIcon } from "./clients-home-icons";

type QueueRow = {
  queue: ClientsHomeQueue;
  label: string;
  count: number;
};

function QueueNavButton({
  item,
  active,
  onSelect,
}: {
  item: QueueRow;
  active: boolean;
  onSelect: (queue: ClientsHomeQueue) => void;
}) {
  return (
    <button
      type="button"
      data-queue={item.queue}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(item.queue)}
      className="flex h-[38px] w-full items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2.5 text-left text-small font-medium text-ink-2 hover:bg-hover hover:text-ink aria-[current=page]:bg-mist aria-[current=page]:font-semibold aria-[current=page]:text-ink"
    >
      <span className="text-ink-3 aria-[current=page]:text-ink">
        <ClientsHomeQueueIcon queue={item.queue} />
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <span
        className={`rounded-[9px] px-[7px] py-px text-[11.5px] font-semibold tabular-nums text-ink-3 ${
          active ? "bg-paper" : "bg-mist"
        }`}
      >
        {item.count}
      </span>
    </button>
  );
}

export function HivesLeftMenu({
  firmName,
  personLine,
  queue,
  counts,
  showMine,
  showUnassigned,
  showYourOwn,
  searchActive,
  onSelectQueue,
}: {
  firmName: string | null;
  personLine: string | null;
  queue: ClientsHomeQueue;
  counts: ClientsHomeQueueCounts;
  showMine: boolean;
  showUnassigned: boolean;
  showYourOwn: boolean;
  searchActive: boolean;
  onSelectQueue: (queue: ClientsHomeQueue) => void;
}) {
  const items: QueueRow[] = [{ queue: "all", label: "All", count: counts.all }];
  if (showMine) items.push({ queue: "mine", label: "Mine", count: counts.mine });
  if (showUnassigned) items.push({ queue: "unassigned", label: "Unassigned", count: counts.unassigned });
  if (showYourOwn) items.push({ queue: "own", label: "Your own", count: counts.own });

  const active = !searchActive;

  return (
    <aside
      className="side hidden w-[232px] shrink-0 flex-col bg-paper px-3 pb-[18px] pt-4 min-[1100px]:sticky min-[1100px]:top-[var(--app-header-height,64px)] min-[1100px]:flex min-[1100px]:max-h-[calc(100dvh-var(--app-header-height,64px))] min-[1100px]:overflow-y-auto min-[1100px]:border-r min-[1100px]:border-line"
      aria-label="Hives menu"
      data-testid="hives-left-menu"
    >
      <div className="mb-2 flex items-center gap-2.5 border-b border-line px-2 pb-3.5 pt-1.5">
        {firmName ? (
          <>
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-mist text-caption font-bold text-ink"
              aria-hidden
            >
              {hiveBadgeInitials(firmName)}
            </span>
            <div className="min-w-0">
              <p className="m-0 truncate text-small font-semibold text-ink">{firmName}</p>
              {personLine ? <p className="m-0 truncate text-caption text-ink-3">{personLine}</p> : null}
            </div>
          </>
        ) : personLine ? (
          <p className="m-0 truncate px-2 text-small font-semibold text-ink">{personLine}</p>
        ) : null}
      </div>

      <nav className="side-nav flex flex-col gap-0.5" aria-label="Which hives">
        {items.map((item) => (
          <QueueNavButton
            key={item.queue}
            item={item}
            active={active && queue === item.queue}
            onSelect={onSelectQueue}
          />
        ))}
      </nav>
    </aside>
  );
}
