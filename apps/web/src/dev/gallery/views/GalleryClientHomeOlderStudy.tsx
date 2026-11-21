"use client";

import { useEffect } from "react";

import { ClientHome } from "@/components/home/ClientHome";
import { AppShell } from "@/components/app-header";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

import { galleryClientOlderStudyHome, GALLERY_STUDY_PREPARATION } from "../gallery-home-props";
import { GALLERY_ASSISTANT_NAME, GALLERY_HIVE, GALLERY_HIVE_ID } from "../fixtures/board-messages";

import { GalleryFrame } from "./GalleryFrame";

export function GalleryClientHomeOlderStudy() {
  const props = galleryClientOlderStudyHome();

  useEffect(() => {
    document.title = "Development gallery — client-home-older-study";
  }, []);

  return (
    <GalleryFrame>
      <AppShell
        account={{
          initials: "DE",
          displayName: "Dana Ellis",
          email: "dana@example.com",
          startingView: "clients",
        }}
      >
        <WorkspaceShell
          hive={{ ...GALLERY_HIVE, membershipRole: "client" }}
          startingView="clients"
          counts={{ toReviewCount: null, documents: 9, reports: 1, teamNotes: null, unreadMessages: null }}
          firm={null}
          currentUserId={props.currentUserId}
          assigneeLabel={null}
          assigneeTitle={null}
          assistantName={GALLERY_ASSISTANT_NAME}
          studyRevision={{ revisionNumber: 6, acceptedAt: "2026-10-20T00:00:00.000Z" }}
        >
          <ClientHome
            hiveId={GALLERY_HIVE_ID}
            hiveTitle="Dana Ellis"
            staffDisplayName="Priya Shah"
            staffTitle="Onboarding associate"
            assistantName={GALLERY_ASSISTANT_NAME}
            checklist={[]}
            progress={{ in: 6, total: 9 }}
            openItems={[]}
            initialDocuments={[]}
            acceptedStudyRevisionId="rev"
            initialPeople={{
              ok: true,
              page: {
                messages: [],
                nextCursor: null,
                participantCount: 1,
                participantRoleLabels: [],
                viewerLastReadAt: null,
                pendingAssistant: false,
                assistantRepliesOn: true,
                assistantAvailable: true,
                assistantName: GALLERY_ASSISTANT_NAME,
                failedAssistantForMessageIds: [],
                assistantThreads: [],
              },
            }}
            currentUserId={props.currentUserId}
            hiveFirmId={GALLERY_HIVE.firmId ?? null}
            loadError={null}
            initialPreparation={GALLERY_STUDY_PREPARATION}
            studyAvailability={{ kind: "older", revisionNumber: 6 }}
            view={null}
            sources={null}
            canonicalStudy={null}
            coverageGaps={[]}
            topics={[]}
            conversationLiveRefresh={false}
          />
        </WorkspaceShell>
      </AppShell>
    </GalleryFrame>
  );
}