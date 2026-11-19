"use client";

import { useEffect } from "react";

import { HivePageHead } from "@/components/workspace/HivePageHead";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { AppShell } from "@/components/app-header";

import { GALLERY_ASSISTANT_NAME, GALLERY_HIVE } from "../fixtures/board-messages";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryShell() {
  useEffect(() => {
    document.title = "Development gallery — shell";
  }, []);

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
          counts={{
            toReviewCount: 3,
            documents: 12,
            reports: 2,
            teamNotes: 1,
            unreadMessages: 2,
          }}
          firm={{
            firm: {
              firmId: GALLERY_HIVE.firmId!,
              name: "Example firm",
              assistantName: GALLERY_ASSISTANT_NAME,
            },
            members: [],
            pendingInvitations: [],
          }}
          currentUserId="d0000000-0000-4000-8000-000000000002"
          assigneeLabel="Priya Shah"
          assigneeTitle="Onboarding associate"
          assistantName={GALLERY_ASSISTANT_NAME}
          studyRevision={{ revisionNumber: 2, acceptedAt: "2026-10-20T00:00:00.000Z" }}
          summaryLoaded
        >
          <HivePageHead
            title="Hive board"
            subtitle={`Ask ${GALLERY_ASSISTANT_NAME}, the AI assistant, about the documents. Answers cite their pages.`}
          />
          <p className="m-0 text-body text-ink-2" data-testid="gallery-shell-placeholder">
            Board column uses the live workspace shell — open a board-* page for the full thread.
          </p>
        </WorkspaceShell>
      </AppShell>
    </GalleryFrame>
  );
}