"use client";

import { HiveConversation } from "@/components/hives/HiveConversation";
import { PageHead } from "@/components/ui/PageHead";

import { GALLERY_HIVE_ID, GALLERY_PEOPLE_PAGE } from "../fixtures/board-messages";
import { GalleryFrame } from "./GalleryFrame";

const HANDOFF_PAGE = {
  ...GALLERY_PEOPLE_PAGE,
  messages: [
    ...GALLERY_PEOPLE_PAGE.messages,
    {
      ...GALLERY_PEOPLE_PAGE.messages[0],
      id: "00000000-0000-4000-8000-000000000099",
      authorKind: "assistant" as const,
      authorRole: "assistant" as const,
      authorDisplayName: "Sarah",
      body: "That's a question for Jordan. I've passed it on.",
      assistantRunStatus: "routed",
      triggerMessageId: "00000000-0000-4000-8000-000000000002",
    },
  ],
};

export function GalleryBoardAskClient() {
  return (
    <GalleryFrame title="board-ask-client">
      <div className="mx-auto max-w-col-read">
        <PageHead title="Hive board" description="Client view with a hand-off reply." />
        <HiveConversation
          hiveId={GALLERY_HIVE_ID}
          initial={{ ok: true, page: HANDOFF_PAGE }}
          staffView={false}
          clientName="Elena Vasquez"
          viewerIsClient
          mode="assistant"
          assistantName="Sarah"
          teamMemberFirstName="Jordan"
        />
      </div>
    </GalleryFrame>
  );
}