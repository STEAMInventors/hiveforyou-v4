"use client";

import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import Link from "next/link";

import { hiveListBackLink } from "@/lib/hives/hive-list-back";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import {
  HIVE_SECTION_LABELS,
  hiveSectionPath,
  type HiveWorkspaceSection,
} from "@/lib/hive-routes";
import type { StartingView } from "@/lib/auth/profile";

import { HiveSidebarCard } from "./HiveSidebarCard";
import { countAccessibleLabel, type HiveSidebarCounts } from "./sidebar-counts";
import { WORKSPACE_NAV_ICONS } from "./workspace-nav-icons";

const HIVE_GROUP: readonly HiveWorkspaceSection[] = ["board", "documents", "facts", "missing", "reports"];
const MORE_GROUP: readonly HiveWorkspaceSection[] = ["timeline", "notes", "activity"];

type HiveSidebarProps = {
  hive: Hive;
  startingView: StartingView;
  active: HiveWorkspaceSection;
  counts: HiveSidebarCounts;
  compact?: boolean;
  firm: ListFirmResponse | null;
  currentUserId: string | null;
  assigneeLabel: string | null;
  assigneeTitle: string | null;
  assistantName: string;
};

function NavCount({ count, ariaLabel }: { count: number | null; ariaLabel: string }) {
  if (count === null) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-pill bg-mist px-1.5 py-0.5 text-[11px] font-semibold text-graphite"
      aria-label={ariaLabel}
    >
      {count}
    </span>
  );
}

function NavItem({
  hiveId,
  section,
  active,
  count,
  countLabel,
  compact,
}: {
  hiveId: string;
  section: HiveWorkspaceSection;
  active: HiveWorkspaceSection;
  count: number | null;
  countLabel?: string;
  compact?: boolean;
}) {
  const href = hiveSectionPath(hiveId, section);
  const isActive = active === section;
  const Icon = WORKSPACE_NAV_ICONS[section];
  const label = HIVE_SECTION_LABELS[section];
  const ariaCount = count !== null && countLabel ? countAccessibleLabel(count, countLabel) : undefined;

  if (compact) {
    return (
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control border px-3 text-small font-medium no-underline ${
          isActive ? "border-cell-blue-wash bg-cell-blue-wash text-cell-blue-deep" : "border-line bg-paper text-graphite hover:bg-mist"
        }`}
      >
        {Icon ? <Icon /> : null}
        {label}
        {count !== null ? <span className="font-semibold">{count}</span> : null}
      </Link>
    );
  }

  return (
    <li className="list-none">
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={`flex min-h-10 items-center gap-2.5 rounded-control px-2.5 text-small font-medium no-underline ${
          isActive ? "bg-cell-blue-wash text-cell-blue-deep" : "text-graphite hover:bg-mist hover:text-ink"
        }`}
      >
        {Icon ? <Icon /> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <NavCount count={count} ariaLabel={ariaCount ?? label} />
      </Link>
    </li>
  );
}

export function HiveSidebar({
  hive,
  startingView,
  active,
  counts,
  compact = false,
  firm,
  currentUserId,
  assigneeLabel,
  assigneeTitle,
  assistantName,
}: HiveSidebarProps) {
  const back = hiveListBackLink(startingView, hive.kind);
  const firmClient = showsFirmThreePane(hive);

  const countFor = (section: HiveWorkspaceSection): number | null => {
    switch (section) {
      case "board":
        return counts.boardNeedsYou;
      case "documents":
        return counts.documents;
      case "reports":
        return counts.reports;
      case "notes":
        return firmClient ? counts.teamNotes : null;
      default:
        return null;
    }
  };

  const countLabelFor = (section: HiveWorkspaceSection): string | undefined => {
    if (section === "board") return "items for your review";
    if (section === "documents") return "documents";
    if (section === "reports") return "reports";
    if (section === "notes") return "team notes";
    return undefined;
  };

  const moreSections = MORE_GROUP.filter((section) => (section === "notes" ? firmClient : true));

  if (compact) {
    return (
      <nav aria-label="Hive sections" className="flex gap-2 overflow-x-auto pb-1" data-testid="hive-sidebar-compact">
        <Link
          href={back.href}
          className="inline-flex min-h-11 shrink-0 items-center rounded-control border border-line bg-paper px-3 text-small font-medium text-cell-blue-deep no-underline hover:bg-mist"
        >
          {back.label}
        </Link>
        {[...HIVE_GROUP, ...moreSections].map((section) => (
          <NavItem
            key={section}
            hiveId={hive.id}
            section={section}
            active={active}
            count={countFor(section)}
            countLabel={countLabelFor(section)}
            compact
          />
        ))}
      </nav>
    );
  }

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto bg-paper px-3 py-4 min-[900px]:sticky min-[900px]:top-[var(--app-header-height,57px)] min-[900px]:max-h-[calc(100dvh-var(--app-header-height,57px))]">
      <HiveSidebarCard
        hive={hive}
        currentUserId={currentUserId}
        firm={firm}
        assigneeLabel={assigneeLabel}
        assigneeTitle={assigneeTitle}
        assistantName={assistantName}
      />
      <nav aria-label="Hive sections" data-testid="hive-sidebar">
        <p className="mb-1 mt-0 px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-quiet">Hive</p>
        <ul className="m-0 flex flex-col gap-0.5 p-0">
          {HIVE_GROUP.map((section) => (
            <NavItem
              key={section}
              hiveId={hive.id}
              section={section}
              active={active}
              count={countFor(section)}
              countLabel={countLabelFor(section)}
            />
          ))}
        </ul>
        <p className="mb-1 mt-4 px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-quiet">More</p>
        <ul className="m-0 flex flex-col gap-0.5 p-0">
          {moreSections.map((section) => (
            <NavItem
              key={section}
              hiveId={hive.id}
              section={section}
              active={active}
              count={countFor(section)}
              countLabel={countLabelFor(section)}
            />
          ))}
        </ul>
      </nav>
    </aside>
  );
}