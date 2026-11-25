"use client";

import type { HiveMessagePage } from "@hiveforyou/contracts";
import { Suspense, useEffect, useRef, type ReactNode } from "react";

import type { AppShellAccount } from "@/components/app-header";
import { HivePageChrome } from "@/components/workspace/HivePageChrome";
import { buildHiveChatConfig } from "@/lib/build-hive-chat-config";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
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
  peoplePage,
  people,
  workspaceWidth,
  hiveName,
  hiveDescription,
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
  peoplePage?: HiveMessagePage;
  people?: unknown;
  workspaceWidth?: "board";
  hiveName?: string;
  hiveDescription?: string;
}) {
  useGalleryTitle(titleSlug);

  const fetchRestore = useRef<(() => void) | null>(null);
  if (typeof window !== "undefined") {
    fetchRestore.current?.();
    fetchRestore.current = installGalleryBoardFetch(GALLERY_HIVE_ID, assistantPage, { peoplePage, people });
  }
  useEffect(
    () => () => {
      fetchRestore.current?.();
      fetchRestore.current = null;
    },
    [],
  );

  const hive = {
    ...(firmless
      ? { ...GALLERY_HIVE, firmId: null, membershipRole: "owner" as const, kind: "own" as const }
      : clientViewer
        ? { ...GALLERY_HIVE, membershipRole: "client" as const, isOwner: false }
        : GALLERY_HIVE),
    ...(hiveName ? { name: hiveName } : {}),
    ...(hiveDescription !== undefined ? { description: hiveDescription } : {}),
  };
  const initialAssistant: ConversationLoad = {
    ok: true,
    page: { ...assistantPage, assistantRepliesOn },
  };
  const staffView = showsFirmThreePane(hive);
  const chatConfig = buildHiveChatConfig({
    hive,
    staffView,
    assigneeLabel: "Priya Shah",
    currentUserId: GALLERY_STAFF_ID,
    assistantName: GALLERY_ASSISTANT_NAME,
    initialAssistant,
    initialClientAssistant,
    documentCount,
    viewerDisplayName: account.displayName,
  });

  return (
    <GalleryFrame>
      <HivePageChrome
        account={account}
        chatConfig={chatConfig}
        shellProps={{
          hive,
          startingView: account.startingView ?? "clients",
          counts: {
            toReviewCount: 8,
            documents: documentCount,
            reports: 2,
            teamNotes: 1,
            unreadMessages,
          },
          firm: firmless
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
              },
          currentUserId: GALLERY_STAFF_ID,
          assigneeLabel: "Priya Shah",
          assigneeTitle: "Onboarding associate",
          assistantName: GALLERY_ASSISTANT_NAME,
          studyRevision: { revisionNumber: 3, acceptedAt: "2026-10-20T00:00:00.000Z" },
          summaryLoaded: true,
          documentCount,
          initialAssistant,
          initialClientAssistant,
          ...(workspaceWidth ? { workspaceWidth } : {}),
        }}
      >
        <Suspense fallback={null}>{children}</Suspense>
      </HivePageChrome>
    </GalleryFrame>
  );
}