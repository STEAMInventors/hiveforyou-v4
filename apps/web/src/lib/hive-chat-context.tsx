"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { ConversationLoad } from "@/components/hives/useHiveConversation";

/** Home shows the chat as a side panel from this width; below it the chat is a sheet. */
export const HIVE_CHAT_PANEL_MIN_WIDTH = 1100;

/** Everything the chat needs to read and write one person's ask thread. No new data. */
export type HiveChatConfig = {
  hiveId: string;
  assistantName: string;
  audience: "staff" | "client";
  viewerFirstName: string | null;
  staffFirstName: string | null;
  clientName: string | null;
  currentUserId: string | null;
  firmless: boolean;
  firmId: string | null;
  documentCount: number | null;
  initialAssistant: ConversationLoad;
  initialClientAssistant: ConversationLoad | null;
};

/**
 * What an entry point asks the visible chat to do.
 * focus: just open and put the caret in the composer. prefill: fill the composer, caret at the end.
 * send: post the text as a question.
 */
export type HiveChatRequest = { nonce: number; kind: "focus" | "prefill" | "send"; text: string };

export type HiveChatOpenInput = { prefill?: string; send?: string };

export type HiveChatValue = {
  config: HiveChatConfig;
  /** False when the assistant is off for this hive: no Ask tab, bar, chips, page link or box row. */
  assistantOn: boolean;
  sheetOpen: boolean;
  request: HiveChatRequest | null;
  panelVisible: boolean;
  handedOffIds: ReadonlySet<string>;
  /** Opens the chat where it lives right now: the side panel when it is on screen, otherwise the sheet. */
  openChat: (input?: HiveChatOpenInput) => void;
  closeSheet: () => void;
  consumeRequest: (nonce: number) => void;
  /** The Home side panel calls this while it is mounted at a width that shows it. */
  registerPanel: () => () => void;
  /** The evidence view covers the page, side panel included, while it is open. Returns the release. */
  holdPanelHidden: () => () => void;
  markHandedOff: (assistantMessageId: string) => void;
  /** True once this session has posted into the thread, so a freshly mounted chat reloads it. */
  isThreadDirty: () => boolean;
  markThreadDirty: () => void;
  /** The element to give focus back to when the sheet closes. */
  openerRef: { current: HTMLElement | null };
};

const HiveChatContext = createContext<HiveChatValue | null>(null);

/** The chat, or null outside a hive. */
export function useHiveChat(): HiveChatValue | null {
  return useContext(HiveChatContext);
}

export function assistantRepliesOnFor(load: ConversationLoad): boolean {
  return load.ok ? load.page.assistantRepliesOn !== false : true;
}

export function HiveChatProvider({
  config,
  children,
}: {
  config: HiveChatConfig | null;
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [request, setRequest] = useState<HiveChatRequest | null>(null);
  const [panelCount, setPanelCount] = useState(0);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [handedOffIds, setHandedOffIds] = useState<ReadonlySet<string>>(() => new Set());
  const nonceRef = useRef(0);
  const panelCountRef = useRef(0);
  const hiddenCountRef = useRef(0);
  const dirtyRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const hiveId = config?.hiveId ?? null;
  const assistantOn = config ? assistantRepliesOnFor(config.initialAssistant) : false;

  const seenHiveIdRef = useRef(hiveId);
  useEffect(() => {
    // Only a real change of hive resets the chat; children may already have opened it during the first mount.
    if (seenHiveIdRef.current === hiveId) return;
    seenHiveIdRef.current = hiveId;
    setSheetOpen(false);
    setRequest(null);
    setHandedOffIds(new Set());
    dirtyRef.current = false;
  }, [hiveId]);

  useEffect(() => {
    if (!assistantOn) setSheetOpen(false);
  }, [assistantOn]);

  const openChat = useCallback(
    (input?: HiveChatOpenInput) => {
      if (!assistantOn) return;
      const send = input?.send?.trim();
      const prefill = input?.prefill;
      nonceRef.current += 1;
      setRequest(
        send
          ? { nonce: nonceRef.current, kind: "send", text: send }
          : prefill !== undefined
            ? { nonce: nonceRef.current, kind: "prefill", text: prefill }
            : { nonce: nonceRef.current, kind: "focus", text: "" },
      );
      if (panelCountRef.current > 0 && hiddenCountRef.current === 0) return;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      setSheetOpen(true);
    },
    [assistantOn],
  );

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const consumeRequest = useCallback((nonce: number) => {
    setRequest((current) => (current && current.nonce === nonce ? null : current));
  }, []);

  const registerPanel = useCallback(() => {
    panelCountRef.current += 1;
    setPanelCount(panelCountRef.current);
    // A panel taking over from an open sheet means the screen got wide: the sheet has nothing to show.
    setSheetOpen(false);
    return () => {
      panelCountRef.current = Math.max(0, panelCountRef.current - 1);
      setPanelCount(panelCountRef.current);
    };
  }, []);

  const holdPanelHidden = useCallback(() => {
    hiddenCountRef.current += 1;
    setHiddenCount(hiddenCountRef.current);
    return () => {
      hiddenCountRef.current = Math.max(0, hiddenCountRef.current - 1);
      setHiddenCount(hiddenCountRef.current);
    };
  }, []);

  const markHandedOff = useCallback((assistantMessageId: string) => {
    setHandedOffIds((current) => new Set(current).add(assistantMessageId));
  }, []);

  const isThreadDirty = useCallback(() => dirtyRef.current, []);
  const markThreadDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const value = useMemo<HiveChatValue | null>(
    () =>
      config
        ? {
            config,
            assistantOn,
            sheetOpen,
            request,
            panelVisible: panelCount > 0 && hiddenCount === 0,
            handedOffIds,
            openChat,
            closeSheet,
            consumeRequest,
            registerPanel,
            holdPanelHidden,
            markHandedOff,
            isThreadDirty,
            markThreadDirty,
            openerRef,
          }
        : null,
    [
      assistantOn,
      closeSheet,
      config,
      consumeRequest,
      handedOffIds,
      hiddenCount,
      holdPanelHidden,
      isThreadDirty,
      markHandedOff,
      markThreadDirty,
      openChat,
      panelCount,
      registerPanel,
      request,
      sheetOpen,
    ],
  );

  return <HiveChatContext.Provider value={value}>{children}</HiveChatContext.Provider>;
}

function subscribeMinWidth(query: string, onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the viewport is at least `px` wide. False on the server and where matchMedia is missing. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (onChange) => subscribeMinWidth(query, onChange),
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    () => false,
  );
}
