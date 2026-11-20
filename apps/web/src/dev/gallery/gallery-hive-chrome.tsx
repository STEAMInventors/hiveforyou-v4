"use client";

import type { HiveMessagePage } from "@hiveforyou/contracts";
import { Suspense, useEffect, type ReactNode } from "react";

import { AppShell, type AppShellAccount } from "@/components/app-header";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import type { ConversationLoad } from "@/components/hives/useHiveConversation";

import { installGalleryBoardFetch } from "./gallery-board-fetch";
import {
  GALLERY_ASSISTANT_NAME,
  GALLERY_HIVE,
  GALLERY_HIVE_ID,
  GALLERY_PEOPLE_PAGE,
  GALLERY_STAFF_ID,
} from "./fixtures/board-messages";
import { GalleryFrame } from "./views/GalleryFrame";

const DEFAULT_ACCOUNT: AppShellAccount = {
  initials: "PS",
  displayName: "Priya Shah",
  email: "priya@example.com",
  startingView: "clients",
};

export function useGalleryTitle(slug: string) {
  useEffect(() => {
    document.title = `Development gallery — ${slug}`;
  }, [slug]);
}

export function GalleryHiveChrome({
  titleSlug,
  children,
  firmless = false,
  clientViewer = false,
  assistantPage = GALLERY_PEOPLE_PAGE,
  account = DEFAULT_ACCOUNT,
  unreadMessages = 2,
  documentCount = 9,
  assistantRepliesOn = true,
  initialClientAssistant = null,
}: {
  titleSlug: string;
  children: ReactNode;
  firmless?: boolean;
  clientViewer?: boolean;
  assistantPage?: HiveMessagePage;
  account?: AppShellAccount;
  unreadMessages?: number;
  documentCount?: number;
  assistantRepliesOn?: boolean;
  initialClientAssistant?: ConversationLoad | null;
}) {
  useGalleryTitle(titleSlug);

  useEffect(() => installGalleryBoardFetch(GALLERY_HIVE_ID, assistantPage), [assistantPage]);

  const hive = firmless
    ? { ...GALLERY_HIVE, firmId: null, membershipRole: "owner" as const, kind: "own" as const }
    : clientViewer
      ? { ...GALLERY_HIVE, membershipRole: "client" as const, isOwner: false }
      : GALLERY_HIVE;
  const initialAssistant: ConversationLoad = {
    ok: true,
    page: { ...assistantPage, assistantRepliesOn },
  };

  return (
    <GalleryFrame>
      <AppShell account={account}>
        <WorkspaceShell
          hive={hive}
          startingView={account.startingView ?? "clients"}
          counts={{
            toReviewCount: 8,
            documents: documentCount,
            reports: 2,
            teamNotes: 1,
            unreadMessages,
          }}
          firm={
            firmless
              ? null
              : {
                  firm: {
                    firmId: GALLERY_HIVE.firmId!,
                    name: "Example firm",
                    assistantName: GALLERY_ASSISTANT_NAME,
                    callerRole: "owner",
                  },
                  members: [],
                  pendingInvitations: [],
                }
          }
          currentUserId={GALLERY_STAFF_ID}
          assigneeLabel="Priya Shah"
          assigneeTitle="Onboarding associate"
          assistantName={GALLERY_ASSISTANT_NAME}
          studyRevision={{ revisionNumber: 3, acceptedAt: "2026-10-20T00:00:00.000Z" }}
          summaryLoaded
          documentCount={documentCount}
          initialAssistant={initialAssistant}
          initialClientAssistant={initialClientAssistant}
        >
          <Suspense fallback={null}>{children}</Suspense>
        </WorkspaceShell>
      </AppShell>
    </GalleryFrame>
  );
}