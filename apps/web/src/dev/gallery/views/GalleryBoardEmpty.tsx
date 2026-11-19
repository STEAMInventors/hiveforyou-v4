"use client";

import { GALLERY_ASK_EMPTY_PAGE, GALLERY_PEOPLE_PAGE, GALLERY_STAFF_ID } from "../fixtures/board-messages";
import { GalleryBoardLayout } from "./GalleryBoardLayout";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardEmpty() {
  return (
    <GalleryFrame>
      <GalleryBoardLayout
        titleSlug="board-empty"
        view="ask"
        staffView
        viewerIsClient={false}
        currentUserId={GALLERY_STAFF_ID}
        initialPeople={{ ...GALLERY_PEOPLE_PAGE, messages: [] }}
        initialAsk={{ ok: true, page: GALLERY_ASK_EMPTY_PAGE }}
      />
    </GalleryFrame>
  );
}