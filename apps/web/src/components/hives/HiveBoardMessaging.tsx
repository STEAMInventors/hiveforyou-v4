"use client";

import { WORKSPACE_PRIMARY } from "@/components/button-classes";
import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import type { HiveBoardConversationProps } from "@/components/hives/HiveBoardConversation";
import { HiveBoardConversation } from "@/components/hives/HiveBoardConversation";
import { ConversationPreviewSelect, type HiveConversationProps } from "@/components/hives/HiveConversation";
import type { ConversationViewer } from "@/components/hives/hive-conversation-view";
import { Tabs } from "@/components/ui/Tabs";
import { personFirstName } from "@/lib/hives/firm-board";
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
  /** Pending professional: Join sits in place of the shared composer. */
  readonly joinRequired?: boolean;
  /** Dev gallery: open on another member's Ask thread without waiting for a click. */
  readonly defaultAskThreadOwnerId?: string | null;
  /** Dev gallery: Ask tab before searchParams hydrate (does not change production URLs). */
  readonly initialBoardView?: BoardView;
};

type BoardView = "conversation" | "ask";

const PANEL_CLASS =
  "h-[min(70dvh,520px)] min-h-[320px] w-full min-w-0 flex-col overflow-hidden min-[760px]:h-[calc(100dvh-26rem)] min-[760px]:max-h-[640px] min-[760px]:min-h-[360px]";

function panelVisibility(selected: boolean): string {
  return selected ? "flex" : "hidden min-[1480px]:flex";
}

function JoinHiveControl({ hiveId }: { hiveId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/hives/${hiveId}/membership`, { method: "POST" });
      if (!response.ok) {
        setError("Could not join this hive. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not join this hive. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="personal-hive-join">
      <button type="button" className={WORKSPACE_PRIMARY} disabled={busy} onClick={() => void join()}>
        {busy ? "Joining…" : "Join this hive"}
      </button>
      {error ? (
        <p className="m-0 mt-2 text-meta text-coral-deep" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

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
  joinRequired = false,
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
      className={`mb-2 flex flex-wrap items-center justify-between gap-3 ${personal ? "min-[1480px]:hidden" : ""}`}
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

  const peopleConversation = (
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
      closedAction={personal && joinRequired ? <JoinHiveControl hiveId={hiveId} /> : null}
      peopleHint={peopleHint}
      fillPanel={personal}
      onSwitchToConversation={() => setView("conversation")}
      {...conversationPreviewProps}
      {...study}
    />
  );

  const askConversation = (
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
      fillPanel={personal}
      onSwitchToConversation={() => setView("conversation")}
      {...study}
    />
  );

  if (personal) {
    const sharedDetail = joinRequired
      ? "You haven't joined yet."
      : sharedClosed
        ? "Waiting for a Pro to join."
        : viewerIsClient
          ? teamMemberFirstName
            ? `With ${teamMemberFirstName}.`
            : "Shared once a Pro joins."
          : `With ${personFirstName(clientName ?? "the owner")}.`;
    return (
      <div className="contents" data-testid="personal-hive-channels">
        <div className="min-w-0 border-t border-line pt-4 min-[760px]:border-l min-[760px]:border-t-0 min-[760px]:pl-5 min-[760px]:pt-0 min-[1480px]:contents">
          {tabs}
          <section
            aria-label="Ask AI — Private"
            data-testid="personal-ask-panel"
            className={`${panelVisibility(view === "ask")} ${PANEL_CLASS} min-[1480px]:border-l min-[1480px]:border-line min-[1480px]:pl-5`}
          >
            <header className="shrink-0 pb-2">
              <h2 className="m-0 text-[16px] font-semibold text-ink">Ask AI — Private</h2>
              <p className="m-0 mt-0.5 text-meta text-ink-3">Only you can see this.</p>
            </header>
            <div className="min-h-0 flex-1">{askConversation}</div>
          </section>
          <section
            aria-label="Pro Conversation — Shared"
            data-testid="personal-pro-panel"
            className={`${panelVisibility(view === "conversation")} ${PANEL_CLASS} min-[1480px]:border-l min-[1480px]:border-line min-[1480px]:pl-5`}
          >
            <header className="shrink-0 pb-2">
              <h2 className="m-0 text-[16px] font-semibold text-ink">Pro Conversation — Shared</h2>
              <p className="m-0 mt-0.5 text-meta text-ink-3">{sharedDetail}</p>
            </header>
            <div className="min-h-0 flex-1">{peopleConversation}</div>
          </section>
        </div>
      </div>
    );
  }

  if (view === "conversation") {
    return (
      <div className="flex flex-col">
        {tabs}
        {peopleConversation}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {tabs}
      {askConversation}
    </div>
  );
}