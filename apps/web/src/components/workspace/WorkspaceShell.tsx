"use client";

import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import type { StartingView } from "@/lib/auth/profile";
import { hiveSectionFromPathname, type HiveWorkspaceSection } from "@/lib/hive-routes";
import { useHiveHeaderWorkspace } from "@/components/app-header";

import { HiveSidebar, type StudyRailRevision } from "./HiveSidebar";
import { HiveWorkspaceHead } from "./HiveWorkspaceHead";
import { WorkspaceChromeProvider } from "./workspace-context";
import type { HiveSidebarCounts } from "./sidebar-counts";

export type WorkspaceShellProps = {
  hive: Hive;
  startingView: StartingView;
  summaryFailedCorrelationId?: string | null;
  counts: HiveSidebarCounts;
  firm: ListFirmResponse | null;
  currentUserId: string | null;
  assigneeLabel: string | null;
  assigneeTitle: string | null;
  assistantName: string;
  studyRevision?: StudyRailRevision | null;
  summaryLoaded?: boolean;
  children: ReactNode;
};

export function WorkspaceShell({
  hive,
  startingView,
  summaryFailedCorrelationId = null,
  counts,
  firm: _firm,
  currentUserId: _currentUserId,
  assigneeLabel,
  assigneeTitle: _assigneeTitle,
  assistantName,
  studyRevision: _studyRevision = null,
  summaryLoaded: _summaryLoaded = false,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const section: HiveWorkspaceSection = hiveSectionFromPathname(pathname, hive.id) ?? "board";
  const setWorkspace = useHiveHeaderWorkspace()?.setWorkspace;

  useEffect(() => {
    if (!setWorkspace) return;
    setWorkspace({
      hiveId: hive.id,
      hiveName: hive.name,
      hiveKind: hive.kind,
      section,
      startingView,
    });
    return () => setWorkspace(null);
  }, [hive.id, hive.name, hive.kind, section, setWorkspace, startingView]);

  useEffect(() => {
    if (summaryFailedCorrelationId) {
      console.error("hive.summary.failed", { correlationId: summaryFailedCorrelationId, hiveId: hive.id });
    }
  }, [hive.id, summaryFailedCorrelationId]);

  return (
    <WorkspaceChromeProvider>
      <div className="hv flex min-h-full flex-1 flex-col bg-canvas min-[1100px]:grid min-[1100px]:grid-cols-[232px_minmax(0,1fr)]">
        <HiveSidebar
          hive={hive}
          startingView={startingView}
          active={section}
          counts={counts}
          assigneeLabel={assigneeLabel}
          assistantName={assistantName}
        />
        <div className="hv-main flex min-w-0 flex-1 flex-col bg-paper">
          <div className="mx-auto flex w-full max-w-col-wide flex-1 flex-col gap-4 px-4 py-5 min-[1100px]:px-8 min-[1100px]:py-7 min-[1100px]:pb-16">
            <HiveWorkspaceHead
              hive={hive}
              active={section}
              counts={counts}
              assigneeLabel={assigneeLabel}
              assistantName={assistantName}
            />
            {children}
          </div>
        </div>
      </div>
    </WorkspaceChromeProvider>
  );
}