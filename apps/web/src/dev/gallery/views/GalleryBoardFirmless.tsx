"use client";

import { HiveConversation } from "@/components/hives/HiveConversation";
import { PageHead } from "@/components/ui/PageHead";

import { GALLERY_HIVE_ID, GALLERY_PEOPLE_PAGE } from "../fixtures/board-messages";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardFirmless() {
  return (
    <GalleryFrame title="board-firmless">
      <div className="mx-auto max-w-col-read">
        <PageHead title="Hive board" description="Ask-only board without a firm." />
        <HiveConversation
          hiveId={GALLERY_HIVE_ID}
          initial={{ ok: true, page: GALLERY_PEOPLE_PAGE }}
          staffView={false}
          clientName={null}
          viewerIsClient
          firmless
          mode="assistant"
          assistantName="HiveForYou"
        />
      </div>
    </GalleryFrame>
  );
}