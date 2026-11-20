"use client";

import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import type { StartingView } from "@/lib/auth/profile";
import { hiveSectionFromPathname, type HiveWorkspaceSection } from "@/lib/hive-routes";
import { useHiveHeaderWorkspace } from "@/components/app-header";

import { HiveSidebar, type StudyRailRevision } from "./HiveSidebar";
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
  firm,
  currentUserId,
  assigneeLabel,
  assigneeTitle,
  assistantName,
  studyRevision = null,
  summaryLoaded = false,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const section: HiveWorkspaceSection = hiveSectionFromPathname(pathname, hive.id) ?? "board";
  const setWorkspace = useHiveHeaderWorkspace()?.setWorkspace;
  const [compactNav, setCompactNav] = useState(false);

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
  }, [hive.id, hive.name, section, setWorkspace, startingView]);

  useEffect(() => {
    if (summaryFailedCorrelationId) {
      console.error("hive.summary.failed", { correlationId: summaryFailedCorrelationId, hiveId: hive.id });
    }
  }, [hive.id, summaryFailedCorrelationId]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 899px)");
    const apply = () => setCompactNav(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return (
    <WorkspaceChromeProvider>
      <div className="flex min-h-full flex-1 flex-col bg-canvas min-[900px]:grid min-[900px]:grid-cols-[240px_minmax(0,1fr)]">
        {compactNav ? (
          <div className="border-b border-line bg-paper px-3 py-2 min-[900px]:hidden">
            <HiveSidebar
              hive={hive}
              startingView={startingView}
              active={section}
              counts={counts}
              compact
              firm={firm}
              currentUserId={currentUserId}
              assigneeLabel={assigneeLabel}
              assigneeTitle={assigneeTitle}
              assistantName={assistantName}
              studyRevision={studyRevision}
              summaryLoaded={summaryLoaded}
            />
          </div>
        ) : (
          <div className="hidden min-[900px]:block min-[900px]:border-r min-[900px]:border-line">
            <HiveSidebar
              hive={hive}
              startingView={startingView}
              active={section}
              counts={counts}
              firm={firm}
              currentUserId={currentUserId}
              assigneeLabel={assigneeLabel}
              assigneeTitle={assigneeTitle}
              assistantName={assistantName}
              studyRevision={studyRevision}
              summaryLoaded={summaryLoaded}
            />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col bg-paper">
          <div className="mx-auto flex w-full max-w-col-wide flex-1 flex-col gap-4 px-4 py-5 min-[900px]:px-10 min-[900px]:py-7 min-[900px]:pb-16">
            {children}
          </div>
        </div>
      </div>
    </WorkspaceChromeProvider>
  );
}