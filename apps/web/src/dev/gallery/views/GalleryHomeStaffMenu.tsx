"use client";

import { useEffect } from "react";

import { AppShell } from "@/components/app-header";
import { HiveSidebar } from "@/components/workspace/HiveSidebar";
import { HiveWorkspaceHead } from "@/components/workspace/HiveWorkspaceHead";

import { GALLERY_ASSISTANT_NAME, GALLERY_HIVE } from "../fixtures/board-messages";
import { GalleryFrame } from "./GalleryFrame";

/** Concept v5 staff hive — `.side-nav [data-tab=documents]` at 1280px. */
export function GalleryHomeStaffMenu() {
  useEffect(() => {
    document.title = "Development gallery — home-staff-menu";
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
        <div className="hv flex min-h-full flex-1 flex-col bg-canvas min-[1100px]:grid min-[1100px]:grid-cols-[232px_minmax(0,1fr)]">
          <HiveSidebar
            hive={GALLERY_HIVE}
            startingView="clients"
            active="documents"
            counts={{ toReviewCount: 2, documents: 9, reports: 1, teamNotes: 2, unreadMessages: null }}
            assigneeLabel="Priya"
            assistantName={GALLERY_ASSISTANT_NAME}
          />
          <div className="hv-main flex min-w-0 flex-1 flex-col bg-paper">
            <div className="mx-auto flex w-full max-w-col-wide flex-1 flex-col gap-4 px-8 py-7">
              <HiveWorkspaceHead
                hive={GALLERY_HIVE}
                active="documents"
                counts={{ toReviewCount: 2, documents: 9, reports: 1, teamNotes: 2, unreadMessages: null }}
                assigneeLabel="Priya"
                assistantName={GALLERY_ASSISTANT_NAME}
              />
              <p className="m-0 text-body text-ink-2">Home brief (fixture). Open a board-* page for the full thread.</p>
            </div>
          </div>
        </div>
      </AppShell>
    </GalleryFrame>
  );
}
