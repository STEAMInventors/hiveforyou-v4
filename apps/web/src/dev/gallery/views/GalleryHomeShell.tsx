"use client";

import { useEffect } from "react";

import { HiveHome } from "@/components/home/HiveHome";
import { AppShell } from "@/components/app-header";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

import { GALLERY_ASK_EMPTY_PAGE, GALLERY_ASSISTANT_NAME, GALLERY_HIVE } from "../fixtures/board-messages";
import type { HiveHomeProps } from "@/components/home/HiveHome";

import { GalleryFrame } from "./GalleryFrame";

export function GalleryHomeShell({ titleSlug, props }: { titleSlug: string; props: HiveHomeProps }) {
  useEffect(() => {
    document.title = `Development gallery — ${titleSlug}`;
  }, [titleSlug]);

  return (
    <GalleryFrame>
      <AppShell
        account={{
          initials: "PS",
          displayName: "Priya Shah",
          email: "priya@example.com",
          startingView: "clients",
        }}
      >
        <WorkspaceShell
          hive={GALLERY_HIVE}
          startingView="clients"
          counts={{ toReviewCount: 2, documents: 9, reports: 1, teamNotes: 2, unreadMessages: null }}
          firm={{
            firm: { firmId: GALLERY_HIVE.firmId!, name: "Example firm", assistantName: GALLERY_ASSISTANT_NAME },
            members: [],
            pendingInvitations: [],
          }}
          currentUserId={props.currentUserId}
          assigneeLabel="Priya"
          assigneeTitle="Onboarding associate"
          assistantName={GALLERY_ASSISTANT_NAME}
          studyRevision={{ revisionNumber: 6, acceptedAt: "2026-10-20T00:00:00.000Z" }}
          initialAssistant={{ ok: true, page: GALLERY_ASK_EMPTY_PAGE }}
        >
          <HiveHome {...props} />
        </WorkspaceShell>
      </AppShell>
    </GalleryFrame>
  );
}
