"use client";

import { GALLERY_ASK_EMPTY_PAGE, GALLERY_CLIENT_ID, GALLERY_PEOPLE_PAGE } from "../fixtures/board-messages";
import { GalleryBoardLayout } from "./GalleryBoardLayout";
import { GalleryFrame } from "./GalleryFrame";

/** Client on a firm hive: Ask tab, empty state with hand-off meta. */
export function GalleryBoardEmpty() {
  return (
    <GalleryFrame>
      <GalleryBoardLayout
        titleSlug="board-empty"
        view="ask"
        staffView={false}
        viewerIsClient
        currentUserId={GALLERY_CLIENT_ID}
        initialPeople={GALLERY_PEOPLE_PAGE}
        initialAsk={{ ok: true, page: GALLERY_ASK_EMPTY_PAGE }}
        account={{ initials: "DE", displayName: "Dana Ellis", email: "dana@example.com", startingView: "own" }}
      />
    </GalleryFrame>
  );
}