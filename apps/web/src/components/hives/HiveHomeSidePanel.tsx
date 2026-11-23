"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ConnectedAskChat } from "@/components/hives/AskChat";
import { Avatar, type AvatarKind } from "@/components/ui/AvatarStack";
import { SEGMENTED_ON } from "@/components/ui/selection";
import { HIVE_CHAT_PANEL_MIN_WIDTH, useHiveChat, useMinWidth } from "@/lib/hive-chat-context";

export const SIDE_PARAM = "side";
export type SideTab = "ask" | "people";

export type HiveHomeSidePanelProps = {
  /** The people conversation, already built by Home. Null on an own hive (the panel is the chat only). */
  people: ReactNode | null;
  other: { first: string; full: string; kind: Exclude<AvatarKind, "assistant"> } | null;
  /** Home asked to write to the other person: show their tab. */
  peopleDraftNonce?: number | null;
};

const PEOPLE_ONLY_ASIDE =
  "flex min-h-0 flex-col border-t border-line py-6 min-[1100px]:sticky min-[1100px]:top-16 min-[1100px]:self-start min-[1100px]:h-[calc(100dvh-13rem)] min-[1100px]:min-h-[360px] min-[1100px]:max-h-[calc(100dvh-4.5rem)] min-[1100px]:overflow-hidden min-[1100px]:border-l min-[1100px]:border-t-0 min-[1100px]:py-6 min-[1100px]:pl-7";
const CHAT_ASIDE =
  "flex min-h-0 flex-col border-line min-[1100px]:sticky min-[1100px]:top-16 min-[1100px]:self-start min-[1100px]:h-[calc(100dvh-13rem)] min-[1100px]:min-h-[360px] min-[1100px]:max-h-[calc(100dvh-4.5rem)] min-[1100px]:overflow-hidden min-[1100px]:border-l";

function tabFromSearch(value: string | null): SideTab {
  return value === "people" ? "people" : "ask";
}

function TabButton({
  selected,
  onClick,
  testId,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid={testId}
      onClick={onClick}
      className={`flex h-[38px] min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] border-0 px-2.5 text-[13.5px] font-medium ${
        selected ? SEGMENTED_ON : "bg-transparent text-ink-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Home's right column. From 1100px: segmented tabs "Ask <assistant>" (default) and the other person's
 * conversation, the selected tab kept in the URL (?side=people). An own hive shows only the chat.
 * Under 1100px, or when the assistant is off: only the people conversation (the chat is the sheet).
 */
export function HiveHomeSidePanel({ people, other, peopleDraftNonce = null }: HiveHomeSidePanelProps) {
  const chat = useHiveChat();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const wide = useMinWidth(HIVE_CHAT_PANEL_MIN_WIDTH);

  const showChat = Boolean(chat?.assistantOn) && wide;
  const urlTab = tabFromSearch(searchParams?.get(SIDE_PARAM) ?? null);
  const [tab, setTab] = useState<SideTab>(urlTab);
  useEffect(() => setTab(urlTab), [urlTab]);

  const registerPanel = chat?.registerPanel;
  useEffect(() => {
    if (!showChat || !registerPanel) return;
    return registerPanel();
  }, [registerPanel, showChat]);

  const select = useCallback(
    (next: SideTab) => {
      setTab(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "people") params.set(SIDE_PARAM, "people");
      else params.delete(SIDE_PARAM);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const hasPeople = people != null;
  const shown: SideTab = showChat ? (hasPeople ? tab : "ask") : "people";

  // Something asked the chat to open while the people tab is showing: bring the chat forward.
  const wantsChat = chat?.request != null && chat.panelVisible && !chat.sheetOpen;
  useEffect(() => {
    if (showChat && hasPeople && wantsChat && tab === "people") select("ask");
  }, [hasPeople, select, showChat, tab, wantsChat]);

  // Home asked to write to the other person: show their composer.
  const draftHandledRef = useRef<number | null>(null);
  useEffect(() => {
    if (peopleDraftNonce == null || draftHandledRef.current === peopleDraftNonce) return;
    draftHandledRef.current = peopleDraftNonce;
    if (showChat && hasPeople && tab !== "people") select("people");
  }, [hasPeople, peopleDraftNonce, select, showChat, tab]);

  if (!showChat) {
    if (!hasPeople) return null;
    return (
      <aside aria-label="Conversation" data-testid="hive-home-conversation" className={PEOPLE_ONLY_ASIDE}>
        {people}
      </aside>
    );
  }

  const assistantName = chat!.config.assistantName;
  return (
    <aside aria-label="Side panel" data-testid="hive-home-side-panel" className={CHAT_ASIDE}>
      {hasPeople && other ? (
        <div className="shrink-0 px-4 pb-1 pt-3.5">
          <div role="group" aria-label="Choose a conversation" className="flex gap-1 rounded-[11px] bg-mist p-1" data-testid="side-tabs">
            <TabButton selected={shown === "ask"} onClick={() => select("ask")} testId="side-tab-ask">
              <Avatar person={{ id: "ai", name: assistantName, kind: "assistant" }} size="xs" />
              <span className="truncate">Ask {assistantName}</span>
            </TabButton>
            <TabButton selected={shown === "people"} onClick={() => select("people")} testId="side-tab-people">
              <Avatar person={{ id: "other", name: other.full, kind: other.kind }} size="xs" />
              <span className="truncate">{other.first}</span>
            </TabButton>
          </div>
        </div>
      ) : null}
      {shown === "ask" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="side-panel-chat">
          <ConnectedAskChat variant="panel" active />
        </div>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-4 pt-2"
          data-testid="hive-home-conversation"
          role="region"
          aria-label="Conversation"
        >
          {people}
        </div>
      )}
    </aside>
  );
}
