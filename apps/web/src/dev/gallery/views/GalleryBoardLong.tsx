"use client";

import { HiveConversation } from "@/components/hives/HiveConversation";
import { HiveStillToCome } from "@/components/hives/HiveStillToCome";
import { PageHead } from "@/components/ui/PageHead";

import { GALLERY_HIVE_ID, longMessagePage } from "../fixtures/board-messages";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardLong() {
  return (
    <GalleryFrame title="board-long">
      <div className="mx-auto max-w-col-read">
        <PageHead title="Hive board" description="Forty messages and twelve source chips." />
        <HiveStillToCome hiveId={GALLERY_HIVE_ID} progress={{ in: 9, total: 12 }} />
        <HiveConversation
          hiveId={GALLERY_HIVE_ID}
          initial={{ ok: true, page: longMessagePage(40) }}
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