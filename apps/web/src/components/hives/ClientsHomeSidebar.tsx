"use client";

import Link from "next/link";

import { WORKSPACE_PRIMARY } from "@/components/button-classes";
import { STATE_LABEL } from "@/components/study/status-state";
import type { ClientsHomeQueue, ClientsHomeQueueCounts } from "@/lib/hives/clients-home-queue";
import { NEW_CLIENT_HIVE_PATH } from "@/lib/hive-routes";

import { ClientsHomeQueueIcon } from "./clients-home-icons";

type QueueItem = {
  queue: ClientsHomeQueue;
  label: string;
  count: number;
  needsBlueBadge?: boolean;
};

function QueueCount({ count, needsBlueBadge }: { count: number; needsBlueBadge?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={`ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-pill px-1.5 py-0.5 text-[11px] font-semibold ${
        needsBlueBadge ? "bg-cell-blue-wash text-cell-blue-deep" : "bg-mist text-graphite"
      }`}
    >
      {count}
    </span>
  );
}

function QueueButton({
  item,
  active,
  compact,
  onSelect,
}: {
  item: QueueItem;
  active: boolean;
  compact: boolean;
  onSelect: (queue: ClientsHomeQueue) => void;
}) {
  const shared = `inline-flex min-h-11 items-center gap-2.5 text-small font-medium ${
    active ? "bg-cell-blue-wash text-cell-blue-deep" : "text-graphite hover:bg-mist hover:text-ink"
  }`;

  if (compact) {
    return (
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(item.queue)}
        className={`${shared} shrink-0 rounded-control border px-3 ${active ? "border-cell-blue-wash" : "border-line bg-paper"}`}
      >
        <ClientsHomeQueueIcon queue={item.queue} />
        {item.label}
        {item.count > 0 ? <span className="font-semibold">{item.count}</span> : null}
      </button>
    );
  }

  return (
    <li className="list-none">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(item.queue)}
        className={`${shared} w-full rounded-control px-2.5 text-left`}
      >
        <ClientsHomeQueueIcon queue={item.queue} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <QueueCount count={item.count} needsBlueBadge={item.needsBlueBadge} />
      </button>
    </li>
  );
}

function GroupLabel({ label, compact }: { label: string; compact: boolean }) {
  if (compact) return null;
  return (
    <p className="mb-1 mt-3 px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-quiet first:mt-0">{label}</p>
  );
}

export function ClientsHomeSidebar({
  queue,
  counts,
  showFirmRail,
  hasOwnHives,
  searchActive,
  compact,
  onSelectQueue,
}: {
  queue: ClientsHomeQueue;
  counts: ClientsHomeQueueCounts;
  showFirmRail: boolean;
  hasOwnHives: boolean;
  searchActive: boolean;
  compact: boolean;
  onSelectQueue: (queue: ClientsHomeQueue) => void;
}) {
  const clientItems: QueueItem[] = [
    { queue: "needs", label: STATE_LABEL.needs, count: counts.needs, needsBlueBadge: true },
    { queue: "ready", label: "Ready for review", count: counts.ready },
    { queue: "all", label: "All clients", count: counts.all },
  ];

  const teamItems: QueueItem[] = showFirmRail
    ? [
        { queue: "mine", label: "Mine", count: counts.mine },
        { queue: "unassigned", label: "Unassigned", count: counts.unassigned },
      ]
    : [];

  const personalItems: QueueItem[] = hasOwnHives ? [{ queue: "own", label: "My own matters", count: counts.own }] : [];

  const newClient = (
    <Link href={NEW_CLIENT_HIVE_PATH} className={`${WORKSPACE_PRIMARY} w-full shrink-0 px-4 no-underline ${compact ? "" : ""}`}>
      <PlusIcon />
      New client
    </Link>
  );

  if (compact) {
    return (
      <nav aria-label="Clients" className="flex gap-2 overflow-x-auto pb-1" data-testid="clients-home-sidebar-compact">
        <span className="shrink-0">{newClient}</span>
        {[...teamItems, ...clientItems, ...personalItems].map((item) => (
          <QueueButton
            key={item.queue}
            item={item}
            active={!searchActive && queue === item.queue}
            compact
            onSelect={onSelectQueue}
          />
        ))}
      </nav>
    );
  }

  return (
    <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto bg-paper px-3 py-4 min-[900px]:sticky min-[900px]:top-[var(--app-header-height,57px)] min-[900px]:max-h-[calc(100dvh-var(--app-header-height,57px))]">
      {newClient}
      <nav aria-label="Clients" data-testid="clients-home-sidebar">
        {teamItems.length > 0 ? (
          <>
            <GroupLabel label="Team" compact={compact} />
            <ul className="m-0 flex flex-col gap-0.5 p-0">
              {teamItems.map((item) => (
                <QueueButton
                  key={item.queue}
                  item={item}
                  active={!searchActive && queue === item.queue}
                  compact={false}
                  onSelect={onSelectQueue}
                />
              ))}
            </ul>
          </>
        ) : null}
        <GroupLabel label="Clients" compact={compact} />
        <ul className="m-0 flex flex-col gap-0.5 p-0">
          {clientItems.map((item) => (
            <QueueButton
              key={item.queue}
              item={item}
              active={!searchActive && queue === item.queue}
              compact={false}
              onSelect={onSelectQueue}
            />
          ))}
        </ul>
        {personalItems.length > 0 ? (
          <>
            <GroupLabel label="Personal" compact={compact} />
            <ul className="m-0 flex flex-col gap-0.5 p-0">
              {personalItems.map((item) => (
                <QueueButton
                  key={item.queue}
                  item={item}
                  active={!searchActive && queue === item.queue}
                  compact={false}
                  onSelect={onSelectQueue}
                />
              ))}
            </ul>
          </>
        ) : null}
      </nav>
    </aside>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}