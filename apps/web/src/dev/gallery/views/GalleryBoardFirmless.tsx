"use client";

import { GALLERY_ASK_EMPTY_PAGE, GALLERY_CLIENT_ID, GALLERY_PEOPLE_PAGE } from "../fixtures/board-messages";
import { GalleryBoardLayout } from "./GalleryBoardLayout";
import { GalleryFrame } from "./GalleryFrame";

/** Personal hive with no Pro yet: Ask AI and Pro Conversation, no Still to come. */
export function GalleryBoardFirmless() {
  return (
    <GalleryFrame>
      <GalleryBoardLayout
        titleSlug="board-firmless"
        view="ask"
        firmless
        staffView={false}
        viewerIsClient
        currentUserId={GALLERY_CLIENT_ID}
        progress={null}
        initialPeople={{ ...GALLERY_PEOPLE_PAGE, messages: [], participantCount: 1, participantRoleLabels: ["Owner"] }}
        initialAsk={{ ok: true, page: GALLERY_ASK_EMPTY_PAGE }}
        account={{ initials: "DE", displayName: "Dana Ellis", email: "dana@example.com", startingView: "own" }}
      />
    </GalleryFrame>
  );
}