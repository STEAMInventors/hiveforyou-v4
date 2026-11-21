"use client";

import { useEffect } from "react";

import { HiveHome } from "@/components/home/HiveHome";
import { AppShell } from "@/components/app-header";
import { HiveWorkspaceHead } from "@/components/workspace/HiveWorkspaceHead";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

import { GALLERY_ASSISTANT_NAME, GALLERY_HIVE } from "../fixtures/board-messages";
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
        >
          <div className="mx-auto flex w-full max-w-col-wide flex-1 flex-col gap-4 px-8 py-7">
            <HiveWorkspaceHead
              hive={GALLERY_HIVE}
              active="board"
              counts={{ toReviewCount: 2, documents: 9, reports: 1, teamNotes: 2, unreadMessages: null }}
              assigneeLabel="Priya"
              assistantName={GALLERY_ASSISTANT_NAME}
            />
            <HiveHome {...props} />
          </div>
        </WorkspaceShell>
      </AppShell>
    </GalleryFrame>
  );
}