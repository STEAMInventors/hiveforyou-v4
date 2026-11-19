"use client";

import {
  GALLERY_PEOPLE_PAGE,
  GALLERY_STAFF_ID,
} from "../fixtures/board-messages";
import { GalleryBoardLayout } from "./GalleryBoardLayout";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardPeople() {
  return (
    <GalleryFrame>
      <GalleryBoardLayout
        titleSlug="board-people"
        view="conversation"
        staffView
        viewerIsClient={false}
        currentUserId={GALLERY_STAFF_ID}
        initialPeople={GALLERY_PEOPLE_PAGE}
        initialAsk={{ ok: true, page: { messages: [], participantRoleLabels: [], participantCount: 0, viewerLastReadAt: null, nextCursor: null } }}
      />
    </GalleryFrame>
  );
}