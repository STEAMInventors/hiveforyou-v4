"use client";

import type { Hive } from "@hiveforyou/contracts";
import Link from "next/link";

import { hiveListBackLink } from "@/lib/hives/hive-list-back";
import { hiveBadgeInitials } from "@/lib/hives/hive-badge-initials";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { hiveMenuNavForHive, hiveMenuTabForSection } from "@/lib/hive-menu-tabs";
import { hiveSectionPath, type HiveWorkspaceSection } from "@/lib/hive-routes";
import type { StartingView } from "@/lib/auth/profile";

import { TEXT_LINK_CLASS } from "@/components/button-classes";

import { HivePeopleLine } from "./HivePeopleLine";
import { countAccessibleLabel, type HiveSidebarCounts } from "./sidebar-counts";
import {
  NavIconAudit,
  NavIconFile,
  NavIconFindings,
  NavIconHome,
  NavIconLock,
  NavIconNote,
} from "./workspace-nav-icons";

const MENU_ICONS = {
  home: NavIconHome,
  documents: NavIconFile,
  report: NavIconFindings,
  audit: NavIconAudit,
  notes: NavIconNote,
} as const;

export type StudyRailRevision = {
  revisionNumber: number;
  acceptedAt: string;
};

type HiveSidebarProps = {
  hive: Hive;
  startingView: StartingView;
  active: HiveWorkspaceSection;
  counts: HiveSidebarCounts;
  assigneeLabel: string | null;
  assistantName: string;
};

function menuCount(section: HiveWorkspaceSection, counts: HiveSidebarCounts): number | null {
  switch (section) {
    case "documents":
      return counts.documents;
    case "findings":
      return counts.toReviewCount;
    default:
      return null;
  }
}

function countLabel(section: HiveWorkspaceSection): string | undefined {
  if (section === "documents") return "documents";
  if (section === "findings") return "to review";
  return undefined;
}

function identityLines(hive: Hive, ownHive: boolean): { primary: string; secondary: string } {
  if (ownHive) {
    return { primary: hive.name, secondary: "Your hive" };
  }
  const title = hive.description?.trim() || hive.name;
  return { primary: hive.name, secondary: title };
}

function MenuCount({ count, ariaLabel, active }: { count: number; ariaLabel: string; active: boolean }) {
  return (
    <span
      className={`ms-auto rounded-[9px] px-[7px] py-px text-[11.5px] font-semibold tabular-nums text-ink-3 ${
        active ? "bg-paper" : "bg-mist"
      }`}
      aria-label={ariaLabel}
    >
      {count}
    </span>
  );
}

function SideNavItem({
  hiveId,
  tab,
  section,
  label,
  active,
  count,
  countLabelText,
  showLock,
}: {
  hiveId: string;
  tab: string;
  section: HiveWorkspaceSection;
  label: string;
  active: boolean;
  count: number | null;
  countLabelText?: string;
  showLock?: boolean;
}) {
  const href = hiveSectionPath(hiveId, section);
  const Icon = MENU_ICONS[tab as keyof typeof MENU_ICONS];
  const ariaCount = count !== null && countLabelText ? countAccessibleLabel(count, countLabelText) : undefined;

  return (
    <Link
      href={href}
      data-tab={tab}
      aria-current={active ? "page" : undefined}
      className="hive-side-link flex h-[38px] items-center gap-2.5 rounded-[9px] px-2.5 text-small font-medium text-ink-2 no-underline hover:bg-hover hover:text-ink aria-[current=page]:bg-mist aria-[current=page]:font-semibold aria-[current=page]:text-ink"
    >
      <span className="text-ink-3 aria-[current=page]:text-ink">{Icon ? <Icon /> : null}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {showLock ? <NavIconLock className="h-3.5 w-3.5 shrink-0 text-ink-3" /> : null}
      {count !== null ? <MenuCount active={active} count={count} ariaLabel={ariaCount ?? label} /> : null}
    </Link>
  );
}

export function HiveSidebar({
  hive,
  startingView,
  active,
  counts,
  assigneeLabel,
  assistantName,
}: HiveSidebarProps) {
  const ownHive = hive.kind === "own" || !hive.firmId;
  const staffClientHive = showsFirmThreePane(hive);
  const items = hiveMenuNavForHive(staffClientHive);
  const activeTab = hiveMenuTabForSection(active);
  const back = hiveListBackLink(startingView, hive.kind);
  const showStaffBack = startingView === "clients" && hive.kind === "client";
  const { primary, secondary } = identityLines(hive, ownHive);

  return (
    <aside
      className="side hidden w-[232px] shrink-0 flex-col bg-paper px-3 pb-[18px] pt-4 min-[1100px]:sticky min-[1100px]:top-[var(--app-header-height,64px)] min-[1100px]:flex min-[1100px]:max-h-[calc(100dvh-var(--app-header-height,64px))] min-[1100px]:overflow-y-auto min-[1100px]:border-r min-[1100px]:border-line"
      aria-label="Hive menu"
      data-testid="hive-left-menu"
    >
      {showStaffBack ? (
        <Link
          href={back.href}
          className={`${TEXT_LINK_CLASS} mb-1.5 inline-flex h-8 items-center gap-2 self-start rounded-control px-2 text-[13px] font-medium text-ink-3 no-underline hover:bg-hover hover:text-ink`}
        >
          <span aria-hidden>←</span>
          All hives
        </Link>
      ) : null}

      <div className="mb-2 flex items-center gap-2.5 border-b border-line px-2 pb-3.5 pt-1.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-mist text-caption font-bold text-ink"
          aria-hidden
        >
          {hiveBadgeInitials(primary)}
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate text-small font-semibold text-ink">{primary}</p>
          <p className="m-0 truncate text-caption text-ink-3">{secondary}</p>
        </div>
      </div>

      <nav className="side-nav flex min-h-0 flex-1 flex-col gap-0.5" aria-label="Hive pages">
        {items.map((item) => (
          <SideNavItem
            key={item.tab}
            hiveId={hive.id}
            tab={item.tab}
            section={item.section}
            label={item.label}
            active={item.tab === activeTab}
            count={menuCount(item.section, counts)}
            countLabelText={countLabel(item.section)}
            showLock={item.tab === "notes"}
          />
        ))}
      </nav>

      <div className="side-foot mt-auto border-t border-line px-2 pt-3.5">
        <HivePeopleLine
          ownHive={ownHive}
          clientName={ownHive ? null : hive.name}
          staffLabel={ownHive ? null : assigneeLabel}
          assistantName={assistantName}
        />
      </div>
    </aside>
  );
}