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

const RAIL: readonly HiveWorkspaceSection[] = ["board", "documents", "findings", "reports", "audit", "notes"];

export type StudyRailRevision = {
  revisionNumber: number;
  acceptedAt: string;
};

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
  /** Null when the hive has no accepted Study. */
  studyRevision?: StudyRailRevision | null;
  /** False when the summary failed to load. The footer stays hidden so it cannot show a wrong state. */
  summaryLoaded?: boolean;
};

function formatAcceptedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function NavCount({
  count,
  ariaLabel,
  tone = "neutral",
}: {
  count: number | null;
  ariaLabel: string;
  tone?: "neutral" | "coral";
}) {
  if (count === null) return null;
  const toneClass =
    tone === "coral" ? "bg-coral-wash text-coral-deep" : "bg-mist px-1.5 py-0.5 text-[11px] font-semibold text-graphite";
  return (
    <span className={`ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-pill px-1.5 ${toneClass}`} aria-label={ariaLabel}>
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
  countTone = "neutral",
  compact,
}: {
  hiveId: string;
  section: HiveWorkspaceSection;
  active: HiveWorkspaceSection;
  count: number | null;
  countLabel?: string;
  countTone?: "neutral" | "coral";
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
        className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-small no-underline ${
          isActive
            ? "border-cell-blue-wash bg-cell-blue-wash font-semibold text-cell-blue-deep"
            : "border-line bg-paper font-medium text-ink-muted hover:bg-mist"
        }`}
      >
        {Icon ? <Icon /> : null}
        {label}
        {count !== null ? (
          <span className="font-semibold" aria-label={ariaCount}>
            {count}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <li className="list-none">
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={`flex min-h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-small no-underline ${
          isActive
            ? "bg-cell-blue-wash font-semibold text-cell-blue-deep"
            : "font-medium text-ink-muted hover:bg-mist hover:text-ink"
        }`}
      >
        {Icon ? <Icon /> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <NavCount count={count} ariaLabel={ariaCount ?? label} tone={countTone} />
      </Link>
    </li>
  );
}

function StudyRailFooter({
  studyRevision,
  summaryLoaded,
}: {
  studyRevision: StudyRailRevision | null;
  summaryLoaded: boolean;
}) {
  if (!summaryLoaded) return null;
  const accepted = studyRevision ? formatAcceptedDate(studyRevision.acceptedAt) : "";
  return (
    <div className="mt-auto px-2.5 pt-4 text-caption text-graphite" data-testid="study-rail-footer">
      {studyRevision ? (
        <>
          <p className="m-0">Study revision</p>
          <p className="m-0">v{studyRevision.revisionNumber}</p>
          {accepted ? <p className="m-0">Accepted {accepted}</p> : null}
          <p className="m-0 pt-2">Every finding links to its source page.</p>
        </>
      ) : (
        <>
          <p className="m-0">No Study yet</p>
          <p className="m-0">Builds once documents are read</p>
        </>
      )}
    </div>
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
  studyRevision = null,
  summaryLoaded = false,
}: HiveSidebarProps) {
  const back = hiveListBackLink(startingView, hive.kind);
  const firmClient = showsFirmThreePane(hive);
  const sections = RAIL.filter((section) => (section === "notes" ? firmClient : true));

  const countFor = (section: HiveWorkspaceSection): number | null => {
    switch (section) {
      case "board":
        return counts.unreadMessages;
      case "documents":
        return counts.documents;
      case "findings":
        return counts.toReviewCount;
      case "reports":
        return counts.reports;
      case "notes":
        return firmClient ? counts.teamNotes : null;
      default:
        return null;
    }
  };

  const countLabelFor = (section: HiveWorkspaceSection): string | undefined => {
    if (section === "board") return "unread messages";
    if (section === "findings") return "to review";
    if (section === "documents") return "documents";
    if (section === "reports") return "reports";
    if (section === "notes") return "team notes";
    return undefined;
  };

  if (compact) {
    return (
      <nav aria-label="Hive sections" className="flex gap-2 overflow-x-auto pb-1" data-testid="hive-sidebar-compact">
        <Link
          href={back.href}
          className="inline-flex min-h-11 shrink-0 items-center rounded-control border border-line bg-paper px-3 text-small font-medium text-cell-blue-deep no-underline hover:bg-mist"
        >
          {back.label}
        </Link>
        {sections.map((section) => (
          <NavItem
            key={section}
            hiveId={hive.id}
            section={section}
            active={active}
            count={countFor(section)}
            countLabel={countLabelFor(section)}
            countTone={section === "findings" ? "coral" : "neutral"}
            compact
          />
        ))}
      </nav>
    );
  }

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-hidden bg-paper px-3 py-4 min-[900px]:sticky min-[900px]:top-[var(--app-header-height,57px)] min-[900px]:h-[calc(100dvh-var(--app-header-height,57px))] min-[900px]:max-h-[calc(100dvh-var(--app-header-height,57px))]">
      <HiveSidebarCard
        hive={hive}
        currentUserId={currentUserId}
        firm={firm}
        assigneeLabel={assigneeLabel}
        assigneeTitle={assigneeTitle}
        assistantName={assistantName}
      />
      <nav aria-label="Hive sections" className="min-h-0 flex-1 overflow-y-auto" data-testid="hive-sidebar">
        <p className="mb-1 mt-0 px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-quiet">Your hive</p>
        <ul className="m-0 flex flex-col gap-0.5 p-0">
          {sections.map((section) => (
            <NavItem
              key={section}
              hiveId={hive.id}
              section={section}
              active={active}
              count={countFor(section)}
              countLabel={countLabelFor(section)}
              countTone={section === "findings" ? "coral" : "neutral"}
            />
          ))}
        </ul>
      </nav>
      <StudyRailFooter studyRevision={studyRevision} summaryLoaded={summaryLoaded} />
    </aside>
  );
}
