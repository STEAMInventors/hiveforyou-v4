"use client";

import { HiveConversation } from "@/components/hives/HiveConversation";
import { HiveStillToCome } from "@/components/hives/HiveStillToCome";
import { PageHead } from "@/components/ui/PageHead";
import { Tabs } from "@/components/ui/Tabs";
import { useState } from "react";

import { GALLERY_HIVE_ID, GALLERY_PEOPLE_PAGE } from "../fixtures/board-messages";
import { GalleryFrame } from "./GalleryFrame";

export function GalleryBoardPeople() {
  const [tab, setTab] = useState<"conversation" | "ask">("conversation");
  return (
    <GalleryFrame title="board-people">
      <div className="mx-auto max-w-col-read">
        <PageHead
          title="Hive board"
          description="Conversation with Elena, Jordan and Sarah, the AI assistant. Everyone here sees every message."
        />
        <Tabs
          ariaLabel="Hive board"
          options={[
            { id: "conversation", label: "Conversation" },
            { id: "ask", label: "Ask Sarah" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <HiveStillToCome hiveId={GALLERY_HIVE_ID} progress={{ in: 6, total: 9 }} />
        <HiveConversation
          hiveId={GALLERY_HIVE_ID}
          initial={{ ok: true, page: GALLERY_PEOPLE_PAGE }}
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