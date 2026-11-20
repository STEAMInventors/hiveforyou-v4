import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import type { ReactNode } from "react";

import { showsFirmThreePane } from "@/lib/hives/firm-board";
import type { StartingView } from "@/lib/auth/profile";
import { loadFirm } from "@/server/firm/load-firm";
import { loadTeamNotes } from "@/server/firm/load-firm-board";
import { loadUnreadMessageCount } from "@/server/hives/hive-conversation";
import { loadHiveOverview, type HiveSummary } from "@/server/hives/hive-summary";
import type { AuthenticatedSession } from "@/server/supabase/server-client";

import { sidebarCounts } from "./sidebar-counts";
import { WorkspaceShell } from "./WorkspaceShell";

export async function HiveWorkspaceFrame({
  hive,
  auth,
  startingView,
  correlationId,
  children,
}: {
  hive: Hive;
  auth: Extract<AuthenticatedSession, { ok: true }>;
  startingView: StartingView;
  correlationId: string;
  children: ReactNode;
}) {
  let summary: HiveSummary | null = null;
  let summaryFailedCorrelationId: string | null = null;
  let reportCount: number | null = null;
  let teamNotesCount: number | null = null;
  let firm: ListFirmResponse | null = null;
  let assigneeLabel: string | null = null;
  let assigneeTitle: string | null = null;
  let assistantName = "HiveForYou";

  try {
    const overview = await loadHiveOverview(auth.client, { hiveId: hive.id, correlationId });
    summary = overview.summary;
    reportCount = overview.reports?.latest?.length ?? null;
  } catch {
    summaryFailedCorrelationId = correlationId;
  }

  if (showsFirmThreePane(hive)) {
    const loadedFirm = await loadFirm(auth.client);
    firm = loadedFirm;
    const notes = await loadTeamNotes(auth.client, hive.id).catch(() => []);
    teamNotesCount = notes.length;
    if (loadedFirm) {
      const assistant = loadedFirm.firm?.assistantName?.trim();
      if (assistant) assistantName = assistant;
      const members = loadedFirm.members.filter((m) => m.joined && m.state === "active" && m.userId);
      const assignee = members.find(
        (m) => m.userId && hive.assigneeUserId && m.userId.toLowerCase() === hive.assigneeUserId.toLowerCase(),
      );
      if (assignee) {
        assigneeLabel =
          auth.userId && assignee.userId?.toLowerCase() === auth.userId.toLowerCase()
            ? "You"
            : assignee.displayName?.trim() || assignee.title;
        assigneeTitle = assignee.title;
      }
    }
  }

  const unreadMessageCount = await loadUnreadMessageCount(auth.client, hive.id);
  const counts = sidebarCounts(summary, { reportCount, teamNotesCount, unreadMessageCount });

  return (
    <WorkspaceShell
      hive={hive}
      startingView={startingView}
      summaryFailedCorrelationId={summaryFailedCorrelationId}
      counts={counts}
      firm={firm}
      currentUserId={auth.userId}
      assigneeLabel={assigneeLabel}
      assigneeTitle={assigneeTitle}
      assistantName={assistantName}
      studyRevision={
        summary?.study
          ? { revisionNumber: summary.study.revisionNumber, acceptedAt: summary.study.acceptedAt }
          : null
      }
      summaryLoaded={summaryFailedCorrelationId == null}
      documentCount={summary ? summary.documentCount : null}
    >
      {children}
    </WorkspaceShell>
  );
}