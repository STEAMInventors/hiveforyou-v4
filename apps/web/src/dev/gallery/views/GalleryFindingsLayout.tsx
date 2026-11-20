"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

import { AppShell } from "@/components/app-header";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

import {
  GALLERY_ASSISTANT_NAME,
  GALLERY_CLIENT_ID,
  GALLERY_HIVE,
  GALLERY_HIVE_ID,
  GALLERY_STAFF_ID,
} from "../fixtures/board-messages";

import { GalleryFrame } from "./GalleryFrame";

const PAGE_SUBTITLE =
  "What the documents show, organized by topic. Every statement opens the page it comes from.";

export function GalleryFindingsLayout({
  titleSlug,
  toReviewCount,
  documentCount,
  hiveName,
  children,
}: {
  titleSlug: string;
  toReviewCount: number;
  documentCount: number;
  hiveName?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `Development gallery — ${titleSlug}`;
  }, [titleSlug]);

  const hive = hiveName ? { ...GALLERY_HIVE, name: hiveName } : GALLERY_HIVE;

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
          hive={hive}
          startingView="clients"
          sectionOverride="findings"
          counts={{
            toReviewCount,
            documents: documentCount,
            reports: 2,
            teamNotes: 1,
            unreadMessages: 1,
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
          currentUserId={GALLERY_STAFF_ID}
          assigneeLabel="Priya Shah"
          assigneeTitle="Onboarding associate"
          assistantName={GALLERY_ASSISTANT_NAME}
          studyRevision={{ revisionNumber: 3, acceptedAt: "2026-10-28T00:00:00.000Z" }}
          summaryLoaded
        >
          <div className="mx-auto flex w-full flex-col gap-3">
            <div className="w-full max-w-col-read">
              <HivePageHead title="Findings" subtitle={PAGE_SUBTITLE} />
            </div>
            {children}
          </div>
        </WorkspaceShell>
      </AppShell>
    </GalleryFrame>
  );
}

export const GALLERY_FINDINGS_IDS = {
  hiveId: GALLERY_HIVE_ID,
  staffId: GALLERY_STAFF_ID,
  clientId: GALLERY_CLIENT_ID,
};