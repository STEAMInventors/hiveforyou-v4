"use client";

import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";

import type { StartingView } from "@/lib/auth/profile";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { hiveSectionFromPathname, type HiveWorkspaceSection } from "@/lib/hive-routes";
import { useHiveHeaderWorkspace } from "@/components/app-header";
import { HiveChatProvider, type HiveChatConfig } from "@/lib/hive-chat-context";
import { buildHiveChatConfig } from "@/lib/build-hive-chat-config";

import type { ConversationLoad } from "@/components/hives/useHiveConversation";

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
  assigneeTitle?: string | null;
  assistantName: string;
  studyRevision?: StudyRailRevision | null;
  summaryLoaded?: boolean;
  documentCount?: number | null;
  initialAssistant: ConversationLoad;
  initialClientAssistant?: ConversationLoad | null;
  chatConfig?: HiveChatConfig;
  viewerDisplayName?: string | null;
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
  chatConfig: chatConfigProp,
  viewerDisplayName = null,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const section: HiveWorkspaceSection = hiveSectionFromPathname(pathname, hive.id) ?? "board";
  const setWorkspace = useHiveHeaderWorkspace()?.setWorkspace;
  const staffView = showsFirmThreePane(hive);
  const clientFirmHive =
    hive.kind === "client" && Boolean(hive.firmId) && hive.membershipRole === "client";

  const chatConfig = useMemo(
    () =>
      chatConfigProp ??
      buildHiveChatConfig({
        hive,
        staffView,
        assigneeLabel,
        currentUserId,
        assistantName,
        initialAssistant,
        initialClientAssistant,
        documentCount,
        viewerDisplayName,
      }),
    [
      assistantName,
      assigneeLabel,
      chatConfigProp,
      currentUserId,
      documentCount,
      hive,
      initialAssistant,
      initialClientAssistant,
      staffView,
      viewerDisplayName,
    ],
  );

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
      clientViewer: chatConfig.audience === "client",
    });
    return () => setWorkspace(null);
  }, [
    assistantName,
    chatConfig.audience,
    hive.id,
    hive.kind,
    hive.name,
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

  if (clientFirmHive) {
    return (
      <HiveChatProvider config={chatConfig}>
        <WorkspaceChromeProvider>
          <div className="flex min-h-full flex-1 flex-col bg-paper">
            <div className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-5 pb-[120px] pt-[22px]">
              {children}
            </div>
          </div>
        </WorkspaceChromeProvider>
      </HiveChatProvider>
    );
  }

  return (
    <HiveChatProvider config={chatConfig}>
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
    </HiveChatProvider>
  );
}