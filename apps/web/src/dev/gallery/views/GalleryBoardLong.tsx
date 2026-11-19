"use client";

import { GALLERY_PEOPLE_PAGE, GALLERY_STAFF_ID, longMessagePage } from "../fixtures/board-messages";
import { GalleryBoardLayout } from "./GalleryBoardLayout";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardLong() {
  return (
    <GalleryFrame>
      <GalleryBoardLayout
        titleSlug="board-long"
        view="conversation"
        staffView
        viewerIsClient={false}
        currentUserId={GALLERY_STAFF_ID}
        progress={{ in: 9, total: 12 }}
        initialPeople={longMessagePage(40)}
        initialAsk={{ ok: true, page: { messages: [], participantRoleLabels: [], participantCount: 0, viewerLastReadAt: null, nextCursor: null } }}
      />
    </GalleryFrame>
  );
}