"use client";

import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import type { StartingView } from "@/lib/auth/profile";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { hiveSectionFromPathname, type HiveWorkspaceSection } from "@/lib/hive-routes";
import { useHiveHeaderWorkspace } from "@/components/app-header";

import type { ConversationLoad } from "@/components/hives/useHiveConversation";

import { HiveHead } from "./HiveHead";
import { WorkspaceChromeProvider } from "./workspace-context";
import type { HiveSidebarCounts, StudyRailRevision } from "./sidebar-counts";

export type WorkspaceShellProps = {
  hive: Hive;
  startingView: StartingView;
  summaryFailedCorrelationId?: string | null;
  counts: HiveSidebarCounts;
  firm: ListFirmResponse | null;
  currentUserId: string | null;
  assigneeLabel: string | null;
  assigneeTitle?: string | null;
  assistantName: string;
  studyRevision?: StudyRailRevision | null;
  summaryLoaded?: boolean;
  documentCount?: number | null;
  initialAssistant: ConversationLoad;
  initialClientAssistant?: ConversationLoad | null;
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
  initialAssistant,
  initialClientAssistant = null,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const section: HiveWorkspaceSection = hiveSectionFromPathname(pathname, hive.id) ?? "board";
  const setWorkspace = useHiveHeaderWorkspace()?.setWorkspace;
  const staffView = showsFirmThreePane(hive);
  const clientFirmHive =
    hive.kind === "client" && Boolean(hive.firmId) && hive.membershipRole === "client";

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
      staffFirstName: assigneeLabel ?? hive.assigneeDisplayName ?? null,
      clientName: hive.kind === "client" ? hive.name : null,
      currentUserId,
      firmId: hive.firmId ?? null,
      firmless: hive.firmId == null,
      initialAssistant,
      initialClientAssistant,
      documentCount,
    });
    return () => setWorkspace(null);
  }, [
    assistantName,
    assigneeLabel,
    currentUserId,
    documentCount,
    hive.firmId,
    hive.id,
    hive.kind,
    hive.name,
    initialAssistant,
    initialClientAssistant,
    section,
    setWorkspace,
    staffView,
    startingView,
  ]);

  useEffect(() => {
    if (summaryFailedCorrelationId) {
      console.error("hive.summary.failed", { correlationId: summaryFailedCorrelationId, hiveId: hive.id });
    }
  }, [hive.id, summaryFailedCorrelationId]);

  return (
    <WorkspaceChromeProvider>
      <div className="flex min-h-full flex-1 flex-col bg-paper">
        <div
          className={
            clientFirmHive
              ? "mx-auto flex w-full max-w-[460px] flex-1 flex-col px-5 pb-[120px] pt-[22px]"
              : "mx-auto flex w-full max-w-content flex-1 flex-col px-4 min-[760px]:px-8"
          }
        >
          {!clientFirmHive ? (
            <HiveHead
              hive={hive}
              assistantName={assistantName}
              documentCount={documentCount}
              unreadMessages={counts.unreadMessages}
            />
          ) : null}
          {children}
        </div>
      </div>
    </WorkspaceChromeProvider>
  );
}