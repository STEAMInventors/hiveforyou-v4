"use client";

import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";

import type { StartingView } from "@/lib/auth/profile";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { hiveSectionFromPathname } from "@/lib/hive-routes";
import { useHiveHeaderWorkspace } from "@/components/app-header";
import { HiveChatProvider, type HiveChatConfig } from "@/lib/hive-chat-context";
import { buildHiveChatConfig } from "@/lib/build-hive-chat-config";

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
  const section = hiveSectionFromPathname(pathname, hive.id) ?? "board";
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

  return (
    <HiveChatProvider config={chatConfig}>
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
    </HiveChatProvider>
  );
}