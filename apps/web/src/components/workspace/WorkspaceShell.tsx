"use client";

import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import type { StartingView } from "@/lib/auth/profile";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { hiveSectionFromPathname, type HiveWorkspaceSection } from "@/lib/hive-routes";
import { useHiveHeaderWorkspace } from "@/components/app-header";

import type { StudyRailRevision } from "./HiveSidebar";
import { HiveHead } from "./HiveHead";
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
  documentCount?: number | null;
  children: ReactNode;
};

export function WorkspaceShell({
  hive,
  startingView,
  summaryFailedCorrelationId = null,
  counts,
  currentUserId,
  assigneeLabel,
  assistantName,
  documentCount = null,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const section: HiveWorkspaceSection = hiveSectionFromPathname(pathname, hive.id) ?? "board";
  const setWorkspace = useHiveHeaderWorkspace()?.setWorkspace;
  const staffView = showsFirmThreePane(hive);

  useEffect(() => {
    if (!setWorkspace) return;
    setWorkspace({
      hiveId: hive.id,
      hiveName: hive.name,
      hiveKind: hive.kind,
      section,
      startingView,
      staffView,
      assistantName,
      staffFirstName: assigneeLabel,
      clientName: hive.kind === "client" ? hive.name : null,
      currentUserId,
      firmId: hive.firmId ?? null,
      firmless: hive.firmId == null,
    });
    return () => setWorkspace(null);
  }, [assistantName, assigneeLabel, currentUserId, hive.firmId, hive.id, hive.kind, hive.name, section, setWorkspace, staffView, startingView]);

  useEffect(() => {
    if (summaryFailedCorrelationId) {
      console.error("hive.summary.failed", { correlationId: summaryFailedCorrelationId, hiveId: hive.id });
    }
  }, [hive.id, summaryFailedCorrelationId]);

  return (
    <WorkspaceChromeProvider>
      <div className="flex min-h-full flex-1 flex-col bg-paper">
        <div className="mx-auto flex w-full max-w-content flex-1 flex-col px-4 min-[760px]:px-8">
          <HiveHead
            hive={hive}
            assistantName={assistantName}
            documentCount={documentCount}
            unreadMessages={counts.unreadMessages}
          />
          {children}
        </div>
      </div>
    </WorkspaceChromeProvider>
  );
}