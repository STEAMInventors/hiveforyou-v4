"use client";

import type { ClientsHomeQueue, ClientsHomeQueueCounts } from "@/lib/hives/clients-home-queue";

type QueueRow = {
  queue: ClientsHomeQueue;
  label: string;
  count: number;
};

export function HivesQueueTabs({
  queue,
  counts,
  showMine,
  showUnassigned,
  showYourOwn,
  searchActive,
  onSelectQueue,
}: {
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

  return (
    <nav aria-label="Hive queue tabs" className="lp tabs border-b border-line min-[1100px]:hidden" data-testid="hives-queue-tabs">
      <div role="tablist" className="flex gap-5 overflow-x-auto scrollbar-none">
        {items.map((item) => {
          const selected = !searchActive && queue === item.queue;
          return (
            <button
              key={item.queue}
              type="button"
              role="tab"
              data-queue={item.queue}
              aria-selected={selected}
              onClick={() => onSelectQueue(item.queue)}
              className={`flex h-[42px] shrink-0 items-center gap-1.5 border-b-2 bg-transparent px-0 text-small ${
                selected ? "border-ink font-semibold text-ink" : "border-transparent font-medium text-ink-3 hover:text-ink"
              }`}
            >
              {item.label}
              <span className="rounded-[9px] bg-mist px-1.5 py-px text-[11.5px] font-semibold text-ink-3">{item.count}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}