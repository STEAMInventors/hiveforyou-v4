"use client";

import {
  GALLERY_ASK_STAFF_READONLY_PAGE,
  GALLERY_CLIENT_ID,
  GALLERY_PEOPLE_PAGE,
  GALLERY_STAFF_ID,
} from "../fixtures/board-messages";
import { GalleryBoardLayout } from "./GalleryBoardLayout";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardAsk() {
  return (
    <GalleryFrame>
      <GalleryBoardLayout
        titleSlug="board-ask"
        view="ask"
        staffView
        viewerIsClient={false}
        currentUserId={GALLERY_STAFF_ID}
        defaultAskThreadOwnerId={GALLERY_CLIENT_ID}
        mockAssistantFetch={GALLERY_ASK_STAFF_READONLY_PAGE}
        initialPeople={GALLERY_PEOPLE_PAGE}
        initialAsk={{ ok: true, page: GALLERY_ASK_STAFF_READONLY_PAGE }}
        clientThreadUserId={GALLERY_CLIENT_ID}
      />
    </GalleryFrame>
  );
}