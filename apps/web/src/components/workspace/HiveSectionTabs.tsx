"use client";

import Link from "next/link";

import { hiveMenuNavForHive, hiveMenuTabForSection, type HiveMenuTab } from "@/lib/hive-menu-tabs";
import { hiveSectionPath, type HiveWorkspaceSection } from "@/lib/hive-routes";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import type { Hive } from "@hiveforyou/contracts";

import { NavIconLock } from "./workspace-nav-icons";
import type { HiveSidebarCounts } from "./sidebar-counts";
import { countAccessibleLabel } from "./sidebar-counts";

type HiveSectionTabsProps = {
  hive: Hive;
  active: HiveWorkspaceSection;
  counts: HiveSidebarCounts;
};

function tabCount(section: HiveWorkspaceSection, counts: HiveSidebarCounts): number | null {
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

export function HiveSectionTabs({ hive, active, counts }: HiveSectionTabsProps) {
  const staffClientHive = showsFirmThreePane(hive);
  const items = hiveMenuNavForHive(staffClientHive);
  const activeTab: HiveMenuTab = hiveMenuTabForSection(active);

  return (
    <nav aria-label="Hive pages" className="border-b border-line" data-testid="hive-tabs">
      <div role="tablist" className="flex gap-5 overflow-x-auto scrollbar-none">
        {items.map((item) => {
          const selected = item.tab === activeTab;
          const count = tabCount(item.section, counts);
          const ariaCount =
            count !== null && countLabel(item.section)
              ? countAccessibleLabel(count, countLabel(item.section)!)
              : undefined;
          return (
            <Link
              key={item.tab}
              href={hiveSectionPath(hive.id, item.section)}
              role="tab"
              data-tab={item.tab}
              aria-selected={selected}
              className={`flex h-[42px] shrink-0 items-center gap-1.5 border-b-2 bg-transparent px-0 text-small no-underline ${
                selected ? "border-ink font-semibold text-ink" : "border-transparent font-medium text-ink-3 hover:text-ink"
              }`}
            >
              <span>{item.label}</span>
              {item.tab === "notes" ? <NavIconLock className="h-3.5 w-3.5 text-ink-3" /> : null}
              {count !== null ? (
                <span
                  className="rounded-[9px] bg-mist px-1.5 py-px text-[11.5px] font-semibold text-ink-3"
                  aria-label={ariaCount}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
