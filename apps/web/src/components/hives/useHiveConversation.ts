"use client";

import {
  normalizeHiveMessagePage,
  normalizePostHiveMessageResponse,
  type HiveMessage,
  type HiveMessageCursor,
  type HiveMessagePage,
  type PublicErrorBody,
} from "@hiveforyou/contracts";

import {
  ASSISTANT_TYPING_TIMEOUT_MS,
  messageWouldTriggerAssistant,
  viewerAuthorRole,
} from "@/components/hives/assistant-conversation-ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BOARD_POLL_FAILURES_BEFORE_NOTICE,
  conversationPollIntervalMs,
} from "@/components/hives/hive-board-poll";
import { firstUnreadMessageId, mergeMessages } from "@/components/hives/hive-conversation-view";
import { useWorkspaceAction, type WorkspaceActionFailure } from "@/components/workspace/useWorkspaceAction";
import { hiveHomePath } from "@/lib/hive-routes";
import { CORRELATION_HEADER_NAME } from "@/lib/hives-client";

export const CONVERSATION_LOAD_FAILED = "Could not load the conversation. Try again.";
export const CONVERSATION_SEND_FAILED = "Could not send right now. Try again.";
export const CONVERSATION_EARLIER_FAILED = "Could not load earlier messages. Try again.";
export const MARK_READ_DEBOUNCE_MS = 800;

export type ConversationLoad =
  | { ok: true; page: HiveMessagePage }
  | { ok: false; message: string; correlationId: string | null; retryable: boolean };

export type PendingHiveMessage = {
  clientRequestId: string;
  body: string;
  status: "sending" | "failed";
  failure: WorkspaceActionFailure | null;
};

/** What last changed the thread, so the view can decide how to scroll. */
export type ConversationChange = { kind: "initial" | "poll" | "earlier" | "sent" | "failed"; seq: number };

type LoadError = { message: string; correlationId: string | null; retryable: boolean };

type FetchResult = { ok: true; page: HiveMessagePage } | { ok: false; status: number; error: LoadError };

function publicErrorOf(value: unknown): PublicErrorBody["error"] | null {
  if (!value || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const candidate = error as Partial<PublicErrorBody["error"]>;
  return typeof candidate.message === "string" ? (error as PublicErrorBody["error"]) : null;
}

function messagesUrl(
  hiveId: string,
  channel: "people" | "assistant",
  threadOwnerUserId: string | null,
): string {
  const base = `/api/v1/hives/${encodeURIComponent(hiveId)}/messages`;
  const params = new URLSearchParams({ channel });
  if (channel === "assistant" && threadOwnerUserId) params.set("threadOwner", threadOwnerUserId);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export type HiveConversationTriggerContext = {
  staffView: boolean;
  viewerIsClient: boolean;
  hiveFirmId: string | null;
};

function resolveAssistantName(pageName: string | null | undefined, propName: string): string {
  const fromPage = pageName?.trim();
  if (fromPage) return fromPage;
  const fromProp = propName.trim();
  if (fromProp) return fromProp;
  return "HiveForYou";
}

export function useHiveConversation({
  hiveId,
  initial,
  assistantTrigger,
  channel = "people",
  threadOwnerUserId = null,
  assistantName: assistantNameProp = "HiveForYou",
}: {
  hiveId: string;
  initial: ConversationLoad;
  assistantTrigger?: HiveConversationTriggerContext;
  channel?: "people" | "assistant";
  threadOwnerUserId?: string | null;
  assistantName?: string;
}) {
  const router = useRouter();
  const boardPath = hiveHomePath(hiveId);
  const action = useWorkspaceAction(boardPath);
  const initialPage = initial.ok ? initial.page : null;
  const initialMessages = initialPage ? mergeMessages([], initialPage.messages) : [];

  const [messages, setMessages] = useState<HiveMessage[]>(initialMessages);
  const messagesRef = useRef<HiveMessage[]>(initialMessages);
  const [nextCursor, setNextCursor] = useState<HiveMessageCursor | null>(initialPage?.nextCursor ?? null);
  const [participantLabels, setParticipantLabels] = useState<readonly string[]>(initialPage?.participantRoleLabels ?? []);
  const [participantCount, setParticipantCount] = useState(initialPage?.participantCount ?? 0);
  const [newDividerId, setNewDividerId] = useState<string | null>(() =>
    initialPage ? firstUnreadMessageId(initialMessages, initialPage.viewerLastReadAt) : null,
  );
  const [loadError, setLoadError] = useState<LoadError | null>(
    initial.ok ? null : { message: initial.message, correlationId: initial.correlationId, retryable: initial.retryable },
  );
  const [retryingLoad, setRetryingLoad] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState<PendingHiveMessage[]>([]);
  const [pollFailures, setPollFailures] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);
  const [change, setChange] = useState<ConversationChange>({ kind: "initial", seq: 0 });
  const [pendingAssistant, setPendingAssistant] = useState(initialPage?.pendingAssistant ?? false);
  const [assistantRepliesOn, setAssistantRepliesOn] = useState(initialPage?.assistantRepliesOn ?? true);
  const [assistantAvailable, setAssistantAvailable] = useState(initialPage?.assistantAvailable ?? false);
  const [assistantName, setAssistantName] = useState(() =>
    resolveAssistantName(initialPage?.assistantName, assistantNameProp),
  );
  const [failedAssistantForMessageIds, setFailedAssistantForMessageIds] = useState<readonly string[]>(
    initialPage?.failedAssistantForMessageIds ?? [],
  );
  const [localAssistantWait, setLocalAssistantWait] = useState<{ startedAt: number; triggerMessageId: string } | null>(
    null,
  );
  const effectivePendingAssistant = pendingAssistant || localAssistantWait !== null;
  const pendingAssistantRef = useRef(effectivePendingAssistant);
  pendingAssistantRef.current = effectivePendingAssistant;
  const [assistantSwitchPending, setAssistantSwitchPending] = useState(false);
  const [assistantSwitchError, setAssistantSwitchError] = useState<WorkspaceActionFailure | null>(null);
  const [localFailedAssistantIds, setLocalFailedAssistantIds] = useState<string[]>([]);
  const [assistantRevealIds, setAssistantRevealIds] = useState<Set<string>>(() => new Set());
  const [assistantThreads, setAssistantThreads] = useState(initialPage?.assistantThreads ?? []);

  const markedUpToRef = useRef<string | null>(initialPage?.viewerLastReadAt ?? null);
  const markTimerRef = useRef<number | null>(null);

  const bump = useCallback((kind: ConversationChange["kind"]) => {
    setChange((current) => ({ kind, seq: current.seq + 1 }));
  }, []);

  const replaceMessages = useCallback((next: HiveMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const fetchPage = useCallback(
    async (cursor: HiveMessageCursor | null): Promise<FetchResult> => {
      const base = messagesUrl(hiveId, channel, threadOwnerUserId);
      const query = cursor
        ? `&before=${encodeURIComponent(cursor.beforeCreatedAt)}&beforeId=${encodeURIComponent(cursor.beforeId)}`
        : "";
      let response: Response;
      try {
        response = await fetch(`${base}${query}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { [CORRELATION_HEADER_NAME]: crypto.randomUUID() },
        });
      } catch {
        return { ok: false, status: 0, error: { message: CONVERSATION_LOAD_FAILED, correlationId: null, retryable: true } };
      }
      if (response.status === 401) {
        window.location.assign(`/sign-in?next=${encodeURIComponent(boardPath)}`);
        return { ok: false, status: 401, error: { message: CONVERSATION_LOAD_FAILED, correlationId: null, retryable: false } };
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const page = response.ok ? normalizeHiveMessagePage(body) : null;
      if (page) return { ok: true, page };
      const publicError = publicErrorOf(body);
      return {
        ok: false,
        status: response.status,
        error: {
          message: publicError?.message ?? CONVERSATION_LOAD_FAILED,
          correlationId: publicError?.correlationId ?? response.headers.get(CORRELATION_HEADER_NAME),
          retryable: publicError?.retryable ?? true,
        },
      };
    },
    [boardPath, channel, hiveId, threadOwnerUserId],
  );

  const applyLatest = useCallback(
    (page: HiveMessagePage) => {
      const previous = messagesRef.current;
      const merged = mergeMessages(previous, page.messages);
      const grew = merged.length > 0 && merged[merged.length - 1]!.id !== previous[previous.length - 1]?.id;
      replaceMessages(merged);
      setParticipantLabels(page.participantRoleLabels);
      setParticipantCount(page.participantCount);
      setPendingAssistant(page.pendingAssistant ?? false);
      setAssistantRepliesOn(page.assistantRepliesOn ?? true);
      setAssistantAvailable(page.assistantAvailable ?? false);
      setAssistantName(resolveAssistantName(page.assistantName, assistantNameProp));
      if (page.failedAssistantForMessageIds) setFailedAssistantForMessageIds(page.failedAssistantForMessageIds);
      if (page.assistantThreads) setAssistantThreads(page.assistantThreads);
      if (!page.pendingAssistant) {
        setLocalAssistantWait((wait) => {
          if (!wait) return null;
          const hasReply = merged.some(
            (message) =>
              message.authorKind === "assistant" && Date.parse(message.createdAt) >= wait.startedAt - 5000,
          );
          return hasReply ? null : wait;
        });
      }
      if (grew) {
        const newest = merged[merged.length - 1];
        if (newest?.authorKind === "assistant") {
          setAssistantRevealIds((current) => new Set(current).add(newest.id));
          setLocalAssistantWait(null);
        }
        bump("poll");
      }
    },
    [assistantNameProp, bump, replaceMessages],
  );

  useEffect(() => {
    if (!localAssistantWait) return;
    const elapsed = Date.now() - localAssistantWait.startedAt;
    const remaining = Math.max(0, ASSISTANT_TYPING_TIMEOUT_MS - elapsed);
    const timer = window.setTimeout(() => {
      if (!pendingAssistantRef.current) {
        setLocalAssistantWait(null);
        setLocalFailedAssistantIds((ids) =>
          ids.includes(localAssistantWait.triggerMessageId) ? ids : [...ids, localAssistantWait.triggerMessageId],
        );
      }
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [localAssistantWait]);

  const scheduleMarkRead = useCallback(() => {
    if (channel !== "people") return;
    const newest = messagesRef.current[messagesRef.current.length - 1];
    if (!newest || newest.isMine) return;
    const marked = markedUpToRef.current;
    if (marked && Date.parse(newest.createdAt) <= Date.parse(marked)) return;
    if (markTimerRef.current !== null) window.clearTimeout(markTimerRef.current);
    markTimerRef.current = window.setTimeout(() => {
      markTimerRef.current = null;
      const target = messagesRef.current[messagesRef.current.length - 1];
      if (!target) return;
      void fetch(`/api/v1/hives/${encodeURIComponent(hiveId)}/messages/read`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", [CORRELATION_HEADER_NAME]: crypto.randomUUID() },
        body: JSON.stringify({ upTo: target.createdAt }),
      })
        .then((response) => {
          if (!response.ok) return;
          markedUpToRef.current = target.createdAt;
          router.refresh();
        })
        .catch(() => undefined);
    }, MARK_READ_DEBOUNCE_MS);
  }, [channel, hiveId, router]);

  useEffect(
    () => () => {
      if (markTimerRef.current !== null) window.clearTimeout(markTimerRef.current);
    },
    [],
  );

  const loaded = loadError === null;

  useEffect(() => {
    if (!loaded || unavailable) return;
    let timer: number | null = null;
    let cancelled = false;
    const pollOnce = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await fetchPage(null);
      if (cancelled) return;
      if (result.ok) {
        applyLatest(result.page);
        setPollFailures(0);
      } else if (result.status === 404) {
        setUnavailable(true);
      } else if (result.status !== 401) {
        setPollFailures((count) => count + 1);
      }
    };
    const start = () => {
      if (timer === null) {
        timer = window.setInterval(
          () => void pollOnce(),
          conversationPollIntervalMs(pendingAssistantRef.current),
        );
      }
    };
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void pollOnce();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applyLatest, fetchPage, loaded, effectivePendingAssistant, unavailable]);

  const retryLoad = useCallback(async () => {
    setRetryingLoad(true);
    const result = await fetchPage(null);
    setRetryingLoad(false);
    if (!result.ok) {
      if (result.status === 404) setUnavailable(true);
      else if (result.status !== 401) setLoadError(result.error);
      return;
    }
    const sorted = mergeMessages([], result.page.messages);
    replaceMessages(sorted);
    setNextCursor(result.page.nextCursor);
    setParticipantLabels(result.page.participantRoleLabels);
    setParticipantCount(result.page.participantCount);
    setNewDividerId(firstUnreadMessageId(sorted, result.page.viewerLastReadAt));
    markedUpToRef.current = result.page.viewerLastReadAt;
    setLoadError(null);
    bump("initial");
  }, [bump, fetchPage, replaceMessages]);

  const threadOwnerRef = useRef(threadOwnerUserId);
  useEffect(() => {
    if (threadOwnerRef.current === threadOwnerUserId) return;
    threadOwnerRef.current = threadOwnerUserId;
    void retryLoad();
  }, [retryLoad, threadOwnerUserId]);

  const loadEarlier = useCallback(async () => {
    if (!nextCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    setEarlierError(null);
    const result = await fetchPage(nextCursor);
    setLoadingEarlier(false);
    if (!result.ok) {
      if (result.status === 404) setUnavailable(true);
      else if (result.status !== 401) setEarlierError(CONVERSATION_EARLIER_FAILED);
      return;
    }
    replaceMessages(mergeMessages(messagesRef.current, result.page.messages));
    setNextCursor(result.page.nextCursor);
    bump("earlier");
  }, [bump, fetchPage, loadingEarlier, nextCursor, replaceMessages]);

  const submit = useCallback(
    async (clientRequestId: string, body: string, handoffFrom: string | null = null) => {
      const captured: { failure: WorkspaceActionFailure | null } = { failure: null };
      const result = await action.run({
        url: messagesUrl(hiveId, channel, threadOwnerUserId).split("?")[0]!,
        method: "POST",
        body: { body, channel, ...(handoffFrom ? { handoffFrom } : {}) },
        idempotencyKey: clientRequestId,
        failureMessage: CONVERSATION_SEND_FAILED,
        refreshOnSuccess: false,
        onFailure: (failure) => {
          captured.failure = failure;
        },
      });
      const sent = normalizePostHiveMessageResponse(result);
      if (sent) {
        replaceMessages(mergeMessages(messagesRef.current, [sent.message]));
        markedUpToRef.current = sent.message.createdAt;
        setPending((items) => items.filter((item) => item.clientRequestId !== clientRequestId));
        if (channel === "assistant" && assistantTrigger) {
          const authorRole = viewerAuthorRole(assistantTrigger.staffView, assistantTrigger.viewerIsClient);
          if (
            messageWouldTriggerAssistant({
              body: sent.message.body,
              assistantAvailable,
              assistantRepliesOn,
              assistantName,
              authorRole,
              hiveFirmId: assistantTrigger.hiveFirmId,
            })
          ) {
            setLocalAssistantWait({ startedAt: Date.now(), triggerMessageId: sent.message.id });
          }
        }
        bump("sent");
        return;
      }
      if (result === null && captured.failure === null) return;
      const failure = captured.failure ?? { message: CONVERSATION_SEND_FAILED, reference: null, retryable: true };
      setPending((items) =>
        items.map((item) =>
          item.clientRequestId === clientRequestId ? { ...item, status: "failed", failure } : item,
        ),
      );
      bump("failed");
    },
    [action, assistantAvailable, assistantName, assistantRepliesOn, assistantTrigger, bump, channel, hiveId, replaceMessages, threadOwnerUserId],
  );

  const clearAssistantReveal = useCallback((messageId: string) => {
    setAssistantRevealIds((current) => {
      if (!current.has(messageId)) return current;
      const next = new Set(current);
      next.delete(messageId);
      return next;
    });
  }, []);

  const send = useCallback(
    (raw: string, handoffFrom: string | null = null): boolean => {
      const body = raw.trim();
      if (!body || action.pending) return false;
      const clientRequestId = crypto.randomUUID();
      setPending((items) => [...items, { clientRequestId, body, status: "sending", failure: null }]);
      bump("sent");
      void submit(clientRequestId, body, handoffFrom);
      return true;
    },
    [action.pending, bump, submit],
  );

  const retry = useCallback(
    (clientRequestId: string) => {
      const item = pending.find((candidate) => candidate.clientRequestId === clientRequestId);
      if (!item || action.pending) return;
      setPending((items) =>
        items.map((candidate) =>
          candidate.clientRequestId === clientRequestId ? { ...candidate, status: "sending", failure: null } : candidate,
        ),
      );
      void submit(clientRequestId, item.body);
    },
    [action.pending, pending, submit],
  );

  const remove = useCallback((clientRequestId: string) => {
    setPending((items) => items.filter((item) => item.clientRequestId !== clientRequestId));
  }, []);

  const handoffToPeople = useCallback(
    async (body: string, handoffFrom: string): Promise<boolean> => {
      const clientRequestId = crypto.randomUUID();
      const captured: { failure: WorkspaceActionFailure | null } = { failure: null };
      const result = await action.run({
        url: messagesUrl(hiveId, "people", null).split("?")[0]!,
        method: "POST",
        body: { body, channel: "people", handoffFrom },
        idempotencyKey: clientRequestId,
        failureMessage: CONVERSATION_SEND_FAILED,
        refreshOnSuccess: false,
        onFailure: (failure) => {
          captured.failure = failure;
        },
      });
      return normalizePostHiveMessageResponse(result) !== null;
    },
    [action, hiveId],
  );

  const setAssistantReplies = useCallback(
    (on: boolean) => {
      if (assistantSwitchPending) return;
      setAssistantSwitchPending(true);
      setAssistantSwitchError(null);
      void fetch(`/api/v1/hives/${encodeURIComponent(hiveId)}/messages/assistant`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", [CORRELATION_HEADER_NAME]: crypto.randomUUID() },
        body: JSON.stringify({ on }),
      })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          const publicError = publicErrorOf(body);
          if (!response.ok || !body || typeof body.assistantRepliesOn !== "boolean") {
            setAssistantSwitchError(
              publicError
                ? {
                    message: publicError.message,
                    retryable: publicError.retryable,
                    reference: publicError.correlationId ?? null,
                  }
                : { message: CONVERSATION_LOAD_FAILED, retryable: true, reference: null },
            );
            return;
          }
          setAssistantRepliesOn(body.assistantRepliesOn);
        })
        .catch(() => {
          setAssistantSwitchError({
            message: CONVERSATION_LOAD_FAILED,
            retryable: true,
            reference: null,
          });
        })
        .finally(() => setAssistantSwitchPending(false));
    },
    [assistantSwitchPending, hiveId],
  );

  return {
    messages,
    pending,
    nextCursor,
    participantLabels,
    participantCount,
    newDividerId,
    loadError,
    retryingLoad,
    unavailable,
    reconnecting: pollFailures >= BOARD_POLL_FAILURES_BEFORE_NOTICE,
    loadingEarlier,
    earlierError,
    change,
    sending: action.pending,
    send,
    retry,
    remove,
    retryLoad,
    loadEarlier,
    scheduleMarkRead,
    pendingAssistant: effectivePendingAssistant,
    assistantRepliesOn,
    assistantAvailable,
    assistantName,
    failedAssistantForMessageIds: [...new Set([...failedAssistantForMessageIds, ...localFailedAssistantIds])],
    assistantTypingStartedAt: localAssistantWait?.startedAt ?? null,
    assistantRevealIds,
    clearAssistantReveal,
    assistantSwitchPending,
    assistantSwitchError,
    setAssistantReplies,
    assistantThreads,
    channel,
    threadOwnerUserId,
    handoffToPeople,
  };
}
