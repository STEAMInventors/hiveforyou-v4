"use client";

import { GALLERY_ASK_EMPTY_PAGE, GALLERY_CLIENT_ID, GALLERY_PEOPLE_PAGE } from "../fixtures/board-messages";
import { GalleryBoardLayout } from "./GalleryBoardLayout";
import { GalleryFrame } from "./GalleryFrame";

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
        initialPeople={GALLERY_PEOPLE_PAGE}
        initialAsk={{ ok: true, page: GALLERY_ASK_EMPTY_PAGE }}
      />
    </GalleryFrame>
  );
}