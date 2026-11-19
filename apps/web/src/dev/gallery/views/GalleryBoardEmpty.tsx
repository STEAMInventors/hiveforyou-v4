"use client";

import { HiveConversation } from "@/components/hives/HiveConversation";
import { PageHead } from "@/components/ui/PageHead";

import { GALLERY_HIVE_ID } from "../fixtures/board-messages";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardEmpty() {
  return (
    <GalleryFrame title="board-empty">
      <div className="mx-auto max-w-col-read">
        <PageHead title="Hive board" />
        <HiveConversation
          hiveId={GALLERY_HIVE_ID}
          initial={{
            ok: true,
            page: {
              messages: [],
              participantRoleLabels: [],
              participantCount: 0,
              viewerLastReadAt: null,
              nextCursor: null,
            },
          }}
          staffView
          clientName="Elena Vasquez"
          viewerIsClient={false}
          mode="people"
          assistantName="Sarah"
        />
      </div>
    </GalleryFrame>
  );
}