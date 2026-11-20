"use client";

import {
  GALLERY_ASK_CLIENT_PAGE,
  GALLERY_CLIENT_ID,
  GALLERY_PEOPLE_PAGE,
} from "../fixtures/board-messages";
import { GalleryBoardLayout } from "./GalleryBoardLayout";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardAskClient() {
  return (
    <GalleryFrame>
      <GalleryBoardLayout
        titleSlug="board-ask-client"
        view="ask"
        staffView={false}
        viewerIsClient
        currentUserId={GALLERY_CLIENT_ID}
        initialPeople={GALLERY_PEOPLE_PAGE}
        initialAsk={{ ok: true, page: GALLERY_ASK_CLIENT_PAGE }}
      />
    </GalleryFrame>
  );
}