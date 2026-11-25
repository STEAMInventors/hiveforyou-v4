"use client";

import { PersonalHiveBoard } from "@/components/hives/PersonalHiveBoard";
import {
  GALLERY_ASK_CLIENT_PAGE,
  GALLERY_CLIENT_ID,
  GALLERY_HIVE,
  GALLERY_PEOPLE_CLIENT_PAGE,
} from "@/dev/gallery/fixtures/board-messages";

import { GalleryHiveChrome } from "../gallery-hive-chrome";

const PEOPLE = {
  people: [
    { userId: GALLERY_CLIENT_ID, role: "owner", displayName: "Maya Chen", state: "active", joined: true },
    {
      userId: "33333333-3333-4333-8333-333333333333",
      role: "professional",
      displayName: "Pat Pro",
      state: "active",
      joined: true,
    },
  ],
  pendingInvitations: [],
};

/** Owner whose hive card omits the owner role, with an active Pro. Layout review only. */
export function GalleryPersonalBoard() {
  return (
    <GalleryHiveChrome
      titleSlug="personal-board"
      firmless
      hiveName="Maya"
      hiveDescription="Personal file"
      workspaceWidth="board"
      assistantPage={GALLERY_ASK_CLIENT_PAGE}
      peoplePage={GALLERY_PEOPLE_CLIENT_PAGE}
      people={PEOPLE}
      account={{ initials: "MC", displayName: "Maya Chen", email: "maya@example.test", startingView: "own" }}
    >
      <PersonalHiveBoard
        hive={{
          ...GALLERY_HIVE,
          name: "Maya",
          description: "Personal file",
          kind: "own",
          firmId: null,
          isOwner: false,
          membershipRole: "firm",
        }}
        assistantName="HiveForYou"
        summary={{
          hasStudy: true,
          documentsIn: 2,
          checklistSize: 3,
          toReview: 1,
          stillToCome: 1,
          study: { revisionNumber: 4, acceptedLabel: "Nov 2" },
        }}
        requests={[]}
        uploadedDocuments={[{ id: "doc-1", fileName: "maya-lease.pdf", createdAt: "2026-11-02T00:00:00.000Z" }]}
        initialPeople={{ ok: true, page: GALLERY_PEOPLE_CLIENT_PAGE }}
        initialAsk={{ ok: true, page: GALLERY_ASK_CLIENT_PAGE }}
        currentUserId={GALLERY_CLIENT_ID}
        roster={{
          professionalJoined: true,
          professionalName: "Pat Pro",
          ownerName: "Maya Chen",
          pendingEmail: null,
          viewerRole: "owner",
          viewerJoined: true,
        }}
        loadError={null}
        studyLoadError={null}
        view={null}
        sources={null}
        canonicalStudy={null}
        coverageGaps={[]}
      />
    </GalleryHiveChrome>
  );
}
