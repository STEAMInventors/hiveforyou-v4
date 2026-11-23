"use client";

import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import type { HiveBoardConversationProps } from "@/components/hives/HiveBoardConversation";
import { HiveBoardConversation } from "@/components/hives/HiveBoardConversation";
import { ConversationPreviewSelect, type HiveConversationProps } from "@/components/hives/HiveConversation";
import type { ConversationViewer } from "@/components/hives/hive-conversation-view";
import { Tabs } from "@/components/ui/Tabs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useMemo, useState } from "react";

export type HiveBoardMessagingProps = Omit<HiveBoardConversationProps, "initial"> & {
  readonly firmless: boolean;
  readonly assistantName: string;
  readonly currentUserId: string | null;
  readonly initialPeople: ConversationLoad;
  readonly initialAsk: ConversationLoad;
  readonly teamMemberFirstName: string | null;
  /** Personal Hive: Ask AI and Pro Conversation, including when no firm is attached. */
  readonly personal?: boolean;
  /** Hides the shared composer until a professional membership is accepted. */
  readonly sharedClosed?: string | null;
  readonly peopleHint?: string | null;
  /** Dev gallery: open on another member's Ask thread without waiting for a click. */
  readonly defaultAskThreadOwnerId?: string | null;
  /** Dev gallery: Ask tab before searchParams hydrate (does not change production URLs). */
  readonly initialBoardView?: BoardView;
};

type BoardView = "conversation" | "ask";

function activeView(
  searchParams: URLSearchParams | null,
  firmless: boolean,
  personal: boolean,
  sharedClosed: boolean,
): BoardView {
  if (firmless && !personal) return "ask";
  const requested = searchParams?.get("view");
  if (requested === "ask" || requested === "conversation") return requested;
  if (personal && sharedClosed) return "ask";
  return "conversation";
}

export function HiveBoardMessaging({
  firmless,
  assistantName,
  currentUserId,
  initialPeople,
  initialAsk,
  teamMemberFirstName,
  personal = false,
  sharedClosed = null,
  peopleHint = null,
  defaultAskThreadOwnerId = null,
  initialBoardView,
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
  const urlView = activeView(searchParams, firmless, personal, Boolean(sharedClosed));
  const requested = searchParams?.get("view");
  const view =
    requested === "ask" || requested === "conversation" ? requested : (initialBoardView ?? urlView);
  const [askThreadOwner, setAskThreadOwner] = useState<string | null>(defaultAskThreadOwnerId ?? currentUserId);
  const [previewViewer, setPreviewViewer] = useState<ConversationViewer>("self");
  const previewSelectId = useId();

  const setView = useCallback(
    (next: BoardView) => {
      if (firmless && !personal) return;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (personal || next === "ask") params.set("view", next);
      else params.delete("view");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [firmless, personal, pathname, router, searchParams],
  );

  const askReadOnly =
    staffView && askThreadOwner != null && currentUserId != null && askThreadOwner !== currentUserId.toLowerCase();

  const clientThread = useMemo(
    () => initialAsk.ok ? initialAsk.page.assistantThreads?.[0] : null,
    [initialAsk],
  );

  const conversationPreviewProps: Pick<HiveConversationProps, "previewViewer" | "onPreviewViewerChange" | "previewOnTabs"> =
    staffView
      ? { previewViewer, onPreviewViewerChange: setPreviewViewer, previewOnTabs: true }
      : {};

  const showTabs = personal || !firmless;
  const tabs = showTabs ? (
    <div
      className="mb-2 flex flex-wrap items-center justify-between gap-3"
      data-testid="hive-board-view-tabs"
    >
      <Tabs
        ariaLabel="Hive board"
        className="mb-0"
        options={
          personal
            ? [
                { id: "ask" as const, label: "Ask AI (private)" },
                { id: "conversation" as const, label: "Pro Conversation (shared)" },
              ]
            : [
                { id: "conversation" as const, label: "Conversation" },
                { id: "ask" as const, label: `Ask ${assistantName}` },
              ]
        }
        value={view}
        onChange={setView}
      />
      {staffView && view === "conversation" ? (
        <ConversationPreviewSelect id={previewSelectId} value={previewViewer} onChange={setPreviewViewer} />
      ) : null}
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
          sharedClosed={sharedClosed}
          peopleHint={peopleHint}
          onSwitchToConversation={() => setView("conversation")}
          {...conversationPreviewProps}
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
        initial={(() => {
          const viewingOtherAsk =
            Boolean(
              askThreadOwner && currentUserId && askThreadOwner.toLowerCase() !== currentUserId.toLowerCase(),
            );
          const gallerySeed =
            Boolean(
              defaultAskThreadOwnerId &&
                askThreadOwner?.toLowerCase() === defaultAskThreadOwnerId.toLowerCase() &&
                initialAsk.ok &&
                initialAsk.page.messages.length > 0,
            );
          if (viewingOtherAsk && !gallerySeed) {
            return {
              ok: true,
              page: {
                messages: [],
                participantRoleLabels: [],
                participantCount: 0,
                viewerLastReadAt: null,
                nextCursor: null,
              },
            } as ConversationLoad;
          }
          return initialAsk;
        })()}
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