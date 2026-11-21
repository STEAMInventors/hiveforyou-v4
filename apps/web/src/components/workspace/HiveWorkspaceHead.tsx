"use client";

import type { Hive } from "@hiveforyou/contracts";

import { useLeftMenuWide } from "@/lib/use-left-menu-wide";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import type { HiveWorkspaceSection } from "@/lib/hive-routes";

import { HivePeopleLine } from "./HivePeopleLine";
import { HiveSectionTabs } from "./HiveSectionTabs";
import type { HiveSidebarCounts } from "./sidebar-counts";

type HiveWorkspaceHeadProps = {
  hive: Hive;
  active: HiveWorkspaceSection;
  counts: HiveSidebarCounts;
  assigneeLabel: string | null;
  assistantName: string;
};

export function HiveWorkspaceHead({ hive, active, counts, assigneeLabel, assistantName }: HiveWorkspaceHeadProps) {
  const wide = useLeftMenuWide();
  const ownHive = hive.kind === "own" || !hive.firmId;
  const purpose = hive.description?.trim();
  const subLine = ownHive
    ? purpose
      ? `${purpose} · your hive`
      : "your hive"
    : purpose
      ? `${purpose} · for ${hive.name}`
      : `for ${hive.name}`;

  return (
    <header className="hivehead flex flex-col gap-3 pb-1" data-testid="hive-workspace-head">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 font-brand text-[26px] font-semibold leading-tight text-ink">{hive.name}</h1>
          <p className="m-0 mt-1 text-small text-ink-3">{subLine}</p>
        </div>
        {!wide && !showsFirmThreePane(hive) && ownHive ? (
          <HivePeopleLine
            ownHive
            clientName={null}
            staffLabel={null}
            assistantName={assistantName}
            className="people shrink-0"
          />
        ) : null}
        {!wide && showsFirmThreePane(hive) ? (
          <HivePeopleLine
            ownHive={false}
            clientName={hive.name}
            staffLabel={assigneeLabel}
            assistantName={assistantName}
            className="people shrink-0"
          />
        ) : null}
      </div>
      {!wide ? <HiveSectionTabs hive={hive} active={active} counts={counts} /> : null}
    </header>
  );
}
