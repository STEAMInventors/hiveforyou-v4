"use client";

import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import type { HiveBoardConversationProps } from "@/components/hives/HiveBoardConversation";
import { HiveBoardConversation } from "@/components/hives/HiveBoardConversation";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

export type HiveBoardMessagingProps = Omit<HiveBoardConversationProps, "initial"> & {
  readonly firmless: boolean;
  readonly assistantName: string;
  readonly currentUserId: string | null;
  readonly initialPeople: ConversationLoad;
  readonly initialAsk: ConversationLoad;
  readonly teamMemberFirstName: string;
};

type BoardView = "conversation" | "ask";

function activeView(searchParams: URLSearchParams | null, firmless: boolean): BoardView {
  if (firmless) return "ask";
  return searchParams?.get("view") === "ask" ? "ask" : "conversation";
}

export function HiveBoardMessaging({
  firmless,
  assistantName,
  currentUserId,
  initialPeople,
  initialAsk,
  teamMemberFirstName,
  hiveId,
  staffView,
  clientName,
  viewerIsClient,
  hiveFirmId,
  ...study
}: HiveBoardMessagingProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = activeView(searchParams, firmless);
  const [askThreadOwner, setAskThreadOwner] = useState<string | null>(currentUserId);

  const setView = useCallback(
    (next: BoardView) => {
      if (firmless) return;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "ask") params.set("view", "ask");
      else params.delete("view");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [firmless, pathname, router, searchParams],
  );

  const askReadOnly =
    staffView && askThreadOwner != null && currentUserId != null && askThreadOwner !== currentUserId.toLowerCase();

  const clientThread = useMemo(
    () => initialAsk.ok ? initialAsk.page.assistantThreads?.[0] : null,
    [initialAsk],
  );

  const tabs = !firmless ? (
    <div
      role="tablist"
      aria-label="Hive board"
      className="flex gap-2 border-b border-line px-[22px] pt-4 max-[649px]:px-4"
      data-testid="hive-board-view-tabs"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === "conversation"}
        className={`rounded-t-control border px-4 py-2 text-[13px] font-semibold ${
          view === "conversation"
            ? "border-line border-b-paper bg-paper text-ink"
            : "border-transparent bg-mist text-graphite"
        }`}
        onClick={() => setView("conversation")}
      >
        Conversation
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "ask"}
        className={`rounded-t-control border px-4 py-2 text-[13px] font-semibold ${
          view === "ask"
            ? "border-line border-b-paper bg-paper text-ink"
            : "border-transparent bg-mist text-graphite"
        }`}
        onClick={() => setView("ask")}
      >
        Ask {assistantName}
      </button>
    </div>
  ) : null;

  if (view === "conversation") {
    return (
      <div className="flex flex-col">
        {tabs}
        <HiveBoardConversation
          hiveId={hiveId}
          initial={initialPeople}
          staffView={staffView}
          clientName={clientName}
          viewerIsClient={viewerIsClient}
          hiveFirmId={hiveFirmId}
          mode="people"
          assistantName={assistantName}
          teamMemberFirstName={teamMemberFirstName}
          firmless={firmless}
          onSwitchToConversation={() => setView("conversation")}
          {...study}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {tabs}
      <HiveBoardConversation
        key={askThreadOwner ?? "self"}
        hiveId={hiveId}
        initial={
          askThreadOwner && currentUserId && askThreadOwner !== currentUserId.toLowerCase()
            ? { ok: true, page: { messages: [], participantRoleLabels: [], participantCount: 0, viewerLastReadAt: null, nextCursor: null } }
            : initialAsk
        }
        staffView={staffView}
        clientName={clientName}
        viewerIsClient={viewerIsClient}
        hiveFirmId={hiveFirmId}
        mode="assistant"
        assistantName={assistantName}
        teamMemberFirstName={teamMemberFirstName}
        firmless={firmless}
        readOnly={askReadOnly}
        threadOwnerUserId={askThreadOwner}
        onThreadOwnerChange={setAskThreadOwner}
        clientThreadUserId={clientThread?.userId ?? null}
        clientThreadFirstName={clientThread?.displayName ?? clientName}
        currentUserId={currentUserId}
        onSwitchToConversation={() => setView("conversation")}
        {...study}
      />
    </div>
  );
}