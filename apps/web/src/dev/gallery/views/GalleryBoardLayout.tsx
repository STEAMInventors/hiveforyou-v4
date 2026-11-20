"use client";

import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { HiveBoardMessaging } from "@/components/hives/HiveBoardMessaging";
import { HiveStillToCome } from "@/components/hives/HiveStillToCome";
import { AppShell, type AppShellAccount } from "@/components/app-header";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { hiveBoardPageDescription } from "@/lib/hives/board-head-copy";
import { personFirstName } from "@/lib/hives/firm-board";
import type { HiveMessagePage } from "@hiveforyou/contracts";
import { Suspense, useEffect, useLayoutEffect, type ReactNode } from "react";

import { installGalleryBoardFetch } from "../gallery-board-fetch";
import {
  GALLERY_ASSISTANT_NAME,
  GALLERY_CLIENT_ID,
  GALLERY_EVIDENCE_CHIP_LABELS,
  GALLERY_EVIDENCE_LABELS,
  GALLERY_HIVE,
  GALLERY_HIVE_ID,
  GALLERY_STAFF_ID,
} from "../fixtures/board-messages";

export type GalleryBoardLayoutProps = {
  titleSlug: string;
  view: "conversation" | "ask";
  firmless?: boolean;
  staffView: boolean;
  viewerIsClient: boolean;
  initialPeople: HiveMessagePage;
  initialAsk: ConversationLoad | HiveMessagePage;
  progress?: { in: number; total: number } | null;
  currentUserId: string;
  clientThreadUserId?: string | null;
  clientThreadFirstName?: string | null;
  defaultAskThreadOwnerId?: string | null;
  mockAssistantFetch?: HiveMessagePage | null;
  account?: AppShellAccount;
  children?: ReactNode;
};

function toLoad(page: HiveMessagePage): ConversationLoad {
  return { ok: true, page };
}

function syncGalleryView(view: "conversation" | "ask") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (view === "ask") url.searchParams.set("view", "ask");
  else url.searchParams.delete("view");
  const next = `${url.pathname}${url.search}`;
  if (`${window.location.pathname}${window.location.search}` !== next) {
    window.history.replaceState(null, "", next);
  }
}

function GalleryViewSync({ view }: { view: "conversation" | "ask" }) {
  useLayoutEffect(() => {
    syncGalleryView(view);
  }, [view]);
  useEffect(() => {
    syncGalleryView(view);
  }, [view]);
  return null;
}

export function GalleryBoardLayout({
  titleSlug,
  view,
  firmless = false,
  staffView,
  viewerIsClient,
  initialPeople,
  initialAsk,
  progress = { in: 6, total: 9 },
  currentUserId,
  clientThreadUserId = GALLERY_CLIENT_ID,
  clientThreadFirstName = "Dana Ellis",
  defaultAskThreadOwnerId = null,
  mockAssistantFetch = null,
  account = {
    initials: "PS",
    displayName: "Priya Shah",
    email: "priya@example.com",
    startingView: "clients",
  },
}: GalleryBoardLayoutProps) {
  const staffFirst = personFirstName("Priya Shah");
  const askLoad = "ok" in initialAsk ? initialAsk : toLoad(initialAsk);
  const subtitle = hiveBoardPageDescription({
    firmless,
    view,
    assistantName: GALLERY_ASSISTANT_NAME,
    viewerIsClient,
    clientName: "Dana Ellis",
    staffFirstName: staffFirst,
  });

  useEffect(() => {
    document.title = `Development gallery — ${titleSlug}`;
  }, [titleSlug]);

  useEffect(() => {
    if (!mockAssistantFetch) return undefined;
    return installGalleryBoardFetch(GALLERY_HIVE_ID, mockAssistantFetch);
  }, [mockAssistantFetch]);

  return (
    <AppShell account={account}>
      <GalleryViewSync view={view} />
      <WorkspaceShell
        hive={
          firmless
            ? {
                ...GALLERY_HIVE,
                firmId: null,
                membershipRole: "client",
                isOwner: true,
                assigneeUserId: null,
                assigneeDisplayName: null,
              }
            : GALLERY_HIVE
        }
        startingView={account.startingView ?? "clients"}
        counts={{
          toReviewCount: 3,
          documents: 12,
          reports: 2,
          teamNotes: 1,
          unreadMessages: 1,
        }}
        firm={
          firmless
            ? null
            : {
                firm: {
                  firmId: GALLERY_HIVE.firmId!,
                  name: "Example firm",
                  assistantName: GALLERY_ASSISTANT_NAME,
                },
                members: [],
                pendingInvitations: [],
              }
        }
        currentUserId={currentUserId}
        assigneeLabel={firmless ? null : "Priya Shah"}
        assigneeTitle={firmless ? null : "Onboarding associate"}
        assistantName={GALLERY_ASSISTANT_NAME}
        studyRevision={{ revisionNumber: 2, acceptedAt: "2026-10-20T00:00:00.000Z" }}
        summaryLoaded
        initialAssistant={askLoad}
      >
        <BoardColumn className="mx-auto flex w-full max-w-col-read flex-col gap-3">
          <HivePageHead title="Hive board" subtitle={subtitle} />
          <div className="flex flex-col gap-3" data-testid="hive-board">
          {progress ? <HiveStillToCome hiveId={GALLERY_HIVE_ID} progress={progress} /> : null}
          <EvidenceViewerProvider
            hiveId={GALLERY_HIVE_ID}
            labels={GALLERY_EVIDENCE_LABELS}
            chipLabels={GALLERY_EVIDENCE_CHIP_LABELS}
            pageCountFor={() => 12}
            citationContexts={new Map()}
          >
            <Suspense fallback={null}>
              <HiveBoardMessaging
                hiveId={GALLERY_HIVE_ID}
                firmless={firmless}
                assistantName={GALLERY_ASSISTANT_NAME}
                currentUserId={currentUserId}
                initialPeople={toLoad(initialPeople)}
                initialAsk={askLoad}
                teamMemberFirstName={staffFirst}
                staffView={staffView}
                clientName="Dana Ellis"
                viewerIsClient={viewerIsClient}
                hiveFirmId={firmless ? null : GALLERY_HIVE.firmId ?? null}
                studyView={null}
                studySources={null}
                canonicalStudy={null}
                coverageGaps={[]}
                documentPages={undefined}
                defaultAskThreadOwnerId={defaultAskThreadOwnerId}
                initialBoardView={view}
                clientThreadUserId={clientThreadUserId}
                clientThreadFirstName={clientThreadFirstName}
              />
            </Suspense>
          </EvidenceViewerProvider>
          </div>
        </BoardColumn>
      </WorkspaceShell>
    </AppShell>
  );
}

function BoardColumn({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}