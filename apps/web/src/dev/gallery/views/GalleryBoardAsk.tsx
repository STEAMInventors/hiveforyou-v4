"use client";

import { HiveConversation } from "@/components/hives/HiveConversation";
import { PageHead } from "@/components/ui/PageHead";

import { GALLERY_HIVE_ID, GALLERY_PEOPLE_PAGE } from "../fixtures/board-messages";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardAsk() {
  return (
    <GalleryFrame title="board-ask">
      <div className="mx-auto max-w-col-read">
        <PageHead title="Hive board" description="Staff viewing the client assistant thread." />
        <HiveConversation
          hiveId={GALLERY_HIVE_ID}
          initial={{ ok: true, page: GALLERY_PEOPLE_PAGE }}
          staffView
          clientName="Elena Vasquez"
          viewerIsClient={false}
          mode="assistant"
          assistantName="Sarah"
          readOnly
          clientThreadFirstName="Elena"
          clientThreadUserId="c0000000-0000-4000-8000-000000000001"
          currentUserId="d0000000-0000-4000-8000-000000000002"
          threadOwnerUserId="c0000000-0000-4000-8000-000000000001"
          onThreadOwnerChange={() => undefined}
        />
      </div>
    </GalleryFrame>
  );
}