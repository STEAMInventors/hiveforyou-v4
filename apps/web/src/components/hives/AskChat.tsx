"use client";

import { HIVE_MESSAGE_BODY_MAX, type HiveMessage } from "@hiveforyou/contracts";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { AssistantReplyBody } from "@/components/hives/assistant-reply-body";
import { useAssistantTypingPhase } from "@/components/hives/assistant-conversation-ui";
import { assistantComposerHint } from "@/components/hives/board-composer-copy";
import {
  useHiveConversation,
  type ConversationLoad,
  type PendingHiveMessage,
} from "@/components/hives/useHiveConversation";
import type { ChipRef } from "@/components/study/SourceChip";
import { Avatar } from "@/components/ui/AvatarStack";
import { Button } from "@/components/ui/Button";
import { LockIcon } from "@/components/ui/LockIcon";
import { SendIcon } from "@/components/ui/SendIcon";
import { useOmniCatalog } from "@/components/ui/omni-catalog";
import { SourceRefs } from "@/components/ui/SourceRefs";
import { personFirstName } from "@/lib/hives/firm-board";
import {
  useHiveChat,
  type HiveChatConfig,
  type HiveChatRequest,
} from "@/lib/hive-chat-context";

const COMPOSER_MAX_PX = 154;
const LOAD_FAILED: ConversationLoad = {
  ok: false,
  message: "Could not load the conversation. Try again.",
  correlationId: null,
  retryable: true,
};

function chipsOf(message: HiveMessage): ChipRef[] {
  return message.sourceRefs
    .filter((ref) => ref.pageNumber >= 1 && ref.sourceDocumentId)
    .map((ref) => ({
      sourceDocumentId: ref.sourceDocumentId,
      pageNumber: ref.pageNumber,
      ...(ref.shortLabel ? { shortLabel: ref.shortLabel } : {}),
      ...(ref.factId ? { factIds: [ref.factId] } : {}),
    }));
}

function referenceSnippet(correlationId: string | null): string | null {
  return correlationId ? correlationId.slice(0, 8) : null;
}

function questionCountLabel(count: number): string {
  return count === 1 ? "1 question" : `${count} questions`;
}

/** The greeting is always the first message. Counts and names come from data; a missing part is left out. */
export function askGreeting(input: {
  audience: "staff" | "client";
  firmless: boolean;
  viewerFirstName: string | null;
  clientName: string | null;
  staffFirstName: string | null;
  documentCount: number | null;
}): string {
  const hi = input.viewerFirstName ? `Hi ${input.viewerFirstName}.` : "Hello.";
  const outro = "Ask me anything about them and I'll show you the page each answer comes from.";
  if (input.audience === "client" && !input.firmless) {
    const staff = input.staffFirstName?.trim() ? personFirstName(input.staffFirstName) : "your team";
    return `${hi} I've read the documents you sent. ${outro} If I can't help, I'll pass your question to ${staff}.`;
  }
  const count =
    input.documentCount != null && input.documentCount > 0
      ? input.documentCount === 1
        ? "the document"
        : `the ${input.documentCount} documents`
      : "the documents";
  if (input.firmless) return `${hi} I've read ${count} in your hive. ${outro}`;
  const client = input.clientName?.trim() ? `${personFirstName(input.clientName)}'s hive` : "this hive";
  return `${hi} I've read ${count} in ${client}. ${outro}`;
}

function TypingDots() {
  return (
    <span className="hive-assistant-typing-dots inline-flex gap-[3px]" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/** Indent for content under the greeting so chips line up with the bubble (28px avatar + 8px gap). */
const ASK_GREETING_FOLLOW_INDENT = "pl-9";

function AssistantRow({ assistantName, children }: { assistantName: string; children: ReactNode }) {
  return (
    <div className="flex max-w-[92%] items-end gap-2" data-testid="ask-assistant-row">
      <Avatar person={{ id: "ai", name: assistantName, kind: "assistant" }} size="chat" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const ASSISTANT_BUBBLE =
  "rounded-[16px] rounded-bl-[5px] bg-mist px-3.5 py-2.5 text-[14px] leading-[1.55] text-ink [overflow-wrap:anywhere]";
const OWN_BUBBLE =
  "max-w-[86%] self-end rounded-[16px] rounded-br-[5px] bg-blue-wash px-3.5 py-2.5 text-[14px] leading-[1.55] text-ink [overflow-wrap:anywhere] whitespace-pre-wrap";

function ChatHeader({
  assistantName,
  onClose,
}: {
  assistantName: string;
  onClose?: (() => void) | undefined;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3.5" data-testid="ask-chat-header">
      <span className="relative inline-flex shrink-0">
        <Avatar person={{ id: "ai", name: assistantName, kind: "assistant" }} size="head" />
        <span
          aria-hidden
          data-testid="ask-ready-dot"
          className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full bg-leaf shadow-[0_0_0_2px_var(--color-paper)]"
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-center gap-2">
          <span className="truncate font-brand text-[16px] font-semibold leading-tight text-ink">{assistantName}</span>
          <span className="shrink-0 rounded-tag border border-line-strong px-[5px] text-[11px] font-semibold leading-[17px] text-ink-2">
            AI assistant
          </span>
        </p>
        <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">Answers only from the documents in this hive</p>
      </div>
      {onClose ? (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-button border-0 bg-transparent text-ink-2 hover:bg-hover"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : null}
    </header>
  );
}

function PendingBubble({
  item,
  onRetry,
  onRemove,
}: {
  item: PendingHiveMessage;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const failed = item.status === "failed";
  return (
    <div className="flex flex-col items-end gap-1.5" data-testid="ask-pending" data-status={item.status}>
      <div className={`${OWN_BUBBLE} ${failed ? "" : "opacity-70"}`}>{item.body}</div>
      {failed && item.failure ? (
        <div className="max-w-[86%] text-right text-[12.5px] text-ink" data-testid="ask-send-error">
          <p role="alert" className="m-0">
            {item.failure.message}
            {item.failure.reference ? (
              <>
                {" "}
                Reference <span className="tabular-nums">{item.failure.reference}</span>.
              </>
            ) : null}
          </p>
          <span className="mt-1 inline-flex gap-1">
            {item.failure.retryable ? (
              <Button variant="secondary" size="small" type="button" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            <Button variant="quiet" size="small" type="button" onClick={onRemove}>
              Remove
            </Button>
          </span>
        </div>
      ) : (
        <span className="text-[11.5px] text-ink-3">Sending…</span>
      )}
    </div>
  );
}

function LoadError({
  message,
  correlationId,
  retryable,
  retrying,
  onRetry,
}: {
  message: string;
  correlationId: string | null;
  retryable: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const reference = referenceSnippet(correlationId);
  return (
    <div className="px-4 py-4" data-testid="ask-load-error">
      <p role="alert" className="m-0 text-[14px] text-ink">
        {message}
        {reference ? (
          <>
            {" "}
            Reference <span className="tabular-nums">{reference}</span>.
          </>
        ) : null}
      </p>
      {retryable ? (
        <Button variant="secondary" type="button" className="mt-2" disabled={retrying} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** The staff member's read-only view of the client's thread. Never has a composer. */
function ClientThreadView({
  config,
  clientThreadUserId,
  clientFirst,
  onBack,
}: {
  config: HiveChatConfig;
  clientThreadUserId: string;
  clientFirst: string;
  onBack: () => void;
}) {
  const conversation = useHiveConversation({
    hiveId: config.hiveId,
    initial: config.initialClientAssistant ?? LOAD_FAILED,
    channel: "assistant",
    threadOwnerUserId: clientThreadUserId,
    assistantName: config.assistantName,
    enablePolling: false,
  });
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [conversation.messages.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ask-client-thread">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-mist px-4 py-2.5">
        <p className="m-0 text-[12.5px] text-ink-2" data-testid="ask-readonly-note">
          {clientFirst} asked these. Only your team can see them.
        </p>
        <Button variant="text" size="small" type="button" onClick={onBack}>
          Back to your chat
        </Button>
      </div>
      {conversation.loadError ? (
        <LoadError
          message={`Couldn't load ${clientFirst}'s questions.`}
          correlationId={conversation.loadError.correlationId}
          retryable={conversation.loadError.retryable}
          retrying={conversation.retryingLoad}
          onRetry={() => void conversation.retryLoad()}
        />
      ) : (
        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label={`${clientFirst}'s questions`}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
        >
          {conversation.messages.map((message) =>
            message.authorKind === "assistant" ? (
              <AssistantRow key={message.id} assistantName={conversation.assistantName}>
                <div className={ASSISTANT_BUBBLE}>
                  <AssistantReplyBody text={message.body} />
                  <SourceRefs refs={chipsOf(message)} />
                </div>
              </AssistantRow>
            ) : (
              <div key={message.id} className={OWN_BUBBLE}>
                {message.body}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export type AskChatProps = {
  config: HiveChatConfig;
  variant: "panel" | "sheet";
  /** True while the chat is on screen: it polls, takes requests and focuses its composer. */
  active?: boolean;
  request?: HiveChatRequest | null;
  onRequestConsumed?: (nonce: number) => void;
  suggestions?: readonly string[];
  handedOffIds?: ReadonlySet<string>;
  onHandedOff?: (assistantMessageId: string) => void;
  onClose?: () => void;
  /** Reload the thread once on mount (another chat posted into it since the page loaded). */
  refreshOnMount?: boolean;
  onSent?: () => void;
};

const NO_SUGGESTIONS: readonly string[] = [];
const NO_HANDOFFS: ReadonlySet<string> = new Set();

export function AskChat({
  config,
  variant,
  active = true,
  request = null,
  onRequestConsumed,
  suggestions = NO_SUGGESTIONS,
  handedOffIds = NO_HANDOFFS,
  onHandedOff,
  onClose,
  refreshOnMount = false,
  onSent,
}: AskChatProps) {
  const { hiveId, assistantName: assistantNameProp, audience, firmless, firmId, currentUserId } = config;
  const viewerIsClient = audience === "client" && !firmless;
  const staffView = audience === "staff" && !firmless;
  const staffFirst = config.staffFirstName?.trim() ? personFirstName(config.staffFirstName) : null;
  const clientFirst = config.clientName?.trim() ? personFirstName(config.clientName) : "the client";

  const assistantInitial = config.initialAssistant;
  const [awaiting, setAwaiting] = useState(false);
  const conversation = useHiveConversation({
    hiveId,
    initial: assistantInitial,
    channel: "assistant",
    threadOwnerUserId: currentUserId,
    assistantName: assistantNameProp,
    assistantTrigger: { staffView: audience === "staff" && !firmless, viewerIsClient, hiveFirmId: firmId },
    enablePolling: active || awaiting,
  });
  const assistantName = conversation.assistantName || assistantNameProp;
  const { messages, pending, pendingAssistant } = conversation;
  useEffect(() => setAwaiting(pendingAssistant), [pendingAssistant]);

  const longWait = useAssistantTypingPhase(pendingAssistant, conversation.assistantTypingStartedAt);

  const [draft, setDraft] = useState("");
  const [reading, setReading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const caretAtEndRef = useRef(false);
  const handledNonceRef = useRef<number | null>(null);
  const handingOffRef = useRef<Set<string>>(new Set());
  const composerId = useId();

  const clientThread = useMemo(() => {
    if (!staffView || !assistantInitial.ok || !currentUserId) return null;
    const match = assistantInitial.page.assistantThreads?.find(
      (thread) => thread.userId.toLowerCase() !== currentUserId.toLowerCase(),
    );
    return match && match.messageCount > 0 ? match : null;
  }, [assistantInitial, currentUserId, staffView]);

  const refreshedRef = useRef(false);
  useEffect(() => {
    if (!refreshOnMount || refreshedRef.current) return;
    refreshedRef.current = true;
    void conversation.retryLoad();
  }, [conversation, refreshOnMount]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, pending.length, pendingAssistant, active, reading, conversation.loadError]);

  const focusComposer = useCallback(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.focus();
    const end = area.value.length;
    area.setSelectionRange(end, end);
  }, []);

  useEffect(() => {
    if (caretAtEndRef.current) {
      caretAtEndRef.current = false;
      focusComposer();
    }
  }, [draft, focusComposer]);

  const send = useCallback(
    (text: string): boolean => {
      const sent = conversation.send(text);
      if (sent) onSent?.();
      return sent !== false;
    },
    [conversation, onSent],
  );

  useEffect(() => {
    if (!active || !request || handledNonceRef.current === request.nonce) return;
    handledNonceRef.current = request.nonce;
    setReading(false);
    if (request.kind === "send") {
      send(request.text);
    } else if (request.kind === "prefill") {
      caretAtEndRef.current = true;
      setDraft(request.text);
    }
    window.setTimeout(focusComposer, 0);
    onRequestConsumed?.(request.nonce);
  }, [active, focusComposer, onRequestConsumed, request, send]);

  const resizeComposer = () => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, COMPOSER_MAX_PX)}px`;
  };

  const submitDraft = () => {
    if (send(draft)) {
      setDraft("");
      const area = textareaRef.current;
      if (area) area.style.height = "";
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submitDraft();
  };

  const handoff = (assistantMessageId: string, questionBody: string) => {
    if (handedOffIds.has(assistantMessageId) || handingOffRef.current.has(assistantMessageId)) return;
    handingOffRef.current.add(assistantMessageId);
    setHandoffError(null);
    void conversation.handoffToPeople(questionBody, assistantMessageId).then((ok) => {
      handingOffRef.current.delete(assistantMessageId);
      if (ok) {
        onHandedOff?.(assistantMessageId);
      } else {
        setHandoffError(`Couldn't send that to ${staffFirst ?? "your team"}. Try again.`);
      }
    });
  };

  const greeting = askGreeting({
    audience,
    firmless,
    viewerFirstName: config.viewerFirstName,
    clientName: config.clientName,
    staffFirstName: config.staffFirstName,
    documentCount: config.documentCount,
  });
  const empty = messages.length === 0 && pending.length === 0;
  const chips = empty ? suggestions.slice(0, 3) : [];
  const hint = assistantComposerHint({
    staffView: audience === "staff",
    viewerIsClient,
    firmless,
    assistantName,
    teamMemberFirstName: config.staffFirstName,
  });

  let thread: ReactNode;
  if (conversation.unavailable) {
    thread = (
      <div className="px-4 py-4">
        <p className="m-0 text-[14px] text-ink">This hive is no longer available to you.</p>
      </div>
    );
  } else if (conversation.loadError) {
    thread = (
      <LoadError
        message={conversation.loadError.message}
        correlationId={conversation.loadError.correlationId}
        retryable={conversation.loadError.retryable}
        retrying={conversation.retryingLoad}
        onRetry={() => void conversation.retryLoad()}
      />
    );
  } else {
    thread = (
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${assistantName}`}
        data-testid="ask-thread"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {conversation.nextCursor ? (
          <Button
            variant="secondary"
            size="small"
            type="button"
            className="self-center"
            disabled={conversation.loadingEarlier}
            onClick={() => void conversation.loadEarlier()}
          >
            {conversation.loadingEarlier ? "Loading…" : "Load earlier messages"}
          </Button>
        ) : null}
        {conversation.earlierError ? (
          <p role="alert" className="m-0 self-center text-[12.5px] text-ink">
            {conversation.earlierError}
          </p>
        ) : null}
        <div className="max-w-[92%]">
          <AssistantRow assistantName={assistantName}>
            <div className={ASSISTANT_BUBBLE} data-testid="ask-greeting">
              {greeting}
            </div>
          </AssistantRow>
          {chips.length > 0 ? (
            <div
              className={`mt-2.5 flex flex-wrap gap-2 ${ASK_GREETING_FOLLOW_INDENT}`}
              data-testid="ask-chips"
            >
              {chips.map((text) => (
                <button
                  key={text}
                  type="button"
                  className="inline-flex h-10 items-center rounded-[9px] border border-line bg-paper px-3 text-left text-[13px] text-ink hover:bg-blue-wash min-[760px]:h-8"
                  onClick={() => send(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {messages.map((message) => {
          if (message.authorKind === "person") {
            return (
              <div key={message.id} className="flex flex-col gap-1.5">
                <div className={OWN_BUBBLE} data-testid="ask-own-message">
                  {message.body}
                </div>
                {staffView && conversation.failedAssistantForMessageIds.includes(message.id) ? (
                  <p className="m-0 self-end text-[12px] text-ink-3" data-testid="ask-failed-line">
                    {assistantName} couldn&apos;t answer this one.
                  </p>
                ) : null}
              </div>
            );
          }
          const status = message.assistantRunStatus;
          const routed = status === "routed" || status === "failed";
          const trigger = message.triggerMessageId
            ? messages.find((row) => row.id === message.triggerMessageId)
            : undefined;
          const handedOff = handedOffIds.has(message.id);
          const refs = chipsOf(message);
          return (
            <AssistantRow key={message.id} assistantName={assistantName}>
              <div className={ASSISTANT_BUBBLE} data-testid="ask-assistant-message">
                <AssistantReplyBody text={message.body} />
                {refs.length > 0 ? <SourceRefs refs={refs} /> : null}
                {viewerIsClient && routed && trigger ? (
                  handedOff ? (
                    <p
                      className="m-0 mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-leaf-deep"
                      data-testid="ask-handoff-sent"
                    >
                      <span aria-hidden className="h-2 w-2 rounded-full bg-leaf" />
                      Sent to {staffFirst ?? "your team"}
                    </p>
                  ) : (
                    <Button
                      variant="secondary"
                      size="small"
                      type="button"
                      className="mt-2.5"
                      data-testid="ask-handoff"
                      onClick={() => handoff(message.id, trigger.body)}
                    >
                      Ask {staffFirst ?? "your team"}
                    </Button>
                  )
                ) : null}
              </div>
            </AssistantRow>
          );
        })}
        {handoffError ? (
          <p role="alert" className="m-0 text-[12.5px] text-ink">
            {handoffError}
          </p>
        ) : null}
        {pending.map((item) => (
          <PendingBubble
            key={item.clientRequestId}
            item={item}
            onRetry={() => conversation.retry(item.clientRequestId)}
            onRemove={() => conversation.remove(item.clientRequestId)}
          />
        ))}
        {pendingAssistant ? (
          <AssistantRow assistantName={assistantName}>
            <div className={ASSISTANT_BUBBLE} role="status" data-testid="ask-typing">
              {longWait ? (
                "…still working on it…"
              ) : (
                <>
                  <span className="sr-only">{assistantName} is looking through the documents</span>
                  <TypingDots />
                </>
              )}
            </div>
          </AssistantRow>
        ) : null}
      </div>
    );
  }

  return (
    <section
      aria-label={`Ask ${assistantName}`}
      data-testid="ask-chat"
      data-variant={variant}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-paper"
    >
      <ChatHeader assistantName={assistantName} onClose={variant === "sheet" ? onClose : undefined} />
      {clientThread && !reading ? (
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-mist px-4 py-2"
          data-testid="ask-client-questions-row"
        >
          <p className="m-0 text-[12.5px] text-ink-2">
            {clientFirst} has asked {assistantName} {questionCountLabel(clientThread.messageCount)}
          </p>
          <Button variant="text" size="small" type="button" onClick={() => setReading(true)}>
            Read them
          </Button>
        </div>
      ) : null}
      {reading && clientThread ? (
        <ClientThreadView
          config={config}
          clientThreadUserId={clientThread.userId}
          clientFirst={clientFirst}
          onBack={() => setReading(false)}
        />
      ) : (
        <>
          {thread}
          {!conversation.unavailable && !conversation.loadError ? (
            <div
              className={`shrink-0 border-t border-line px-3 pt-2.5 ${
                variant === "sheet" ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "pb-3"
              }`}
              data-testid="ask-composer"
            >
              <div className="rounded-input border border-line-strong bg-paper shadow-rest transition-[border-color,box-shadow] focus-within:border-blue focus-within:shadow-focus">
                <label htmlFor={composerId} className="sr-only">
                  Question for {assistantName}
                </label>
                <div className="flex items-end gap-2 p-2 pl-3.5">
                  <textarea
                    id={composerId}
                    ref={textareaRef}
                    rows={1}
                    value={draft}
                    maxLength={HIVE_MESSAGE_BODY_MAX}
                    placeholder={`Ask ${assistantName} about the documents…`}
                    className="block max-h-40 min-h-[38px] w-full resize-none border-0 bg-transparent py-2 text-[14px] leading-[1.55] text-ink outline-none focus:outline-none focus:ring-0 focus-visible:outline-none placeholder:text-ink-3"
                    onChange={(event) => {
                      setDraft(event.target.value);
                      resizeComposer();
                    }}
                    onKeyDown={onComposerKeyDown}
                  />
                  <button
                    type="button"
                    aria-label={`Send to ${assistantName}`}
                    disabled={!draft.trim() || conversation.sending}
                    onClick={submitDraft}
                    className="grid h-[38px] w-[38px] shrink-0 cursor-pointer place-items-center rounded-button border border-blue-deep bg-blue-deep text-paper hover:bg-blue-press disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <SendIcon />
                  </button>
                </div>
              </div>
              <p className="m-0 mt-2 inline-flex items-center gap-1.5 px-1 text-[12px] text-ink-3" data-testid="ask-hint">
                <LockIcon />
                {hint}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** The chat wired to the hive's shared state: requests, hand-offs and the suggestions the page published. */
export function ConnectedAskChat({
  variant,
  active = true,
  suggestions,
}: {
  variant: "panel" | "sheet";
  active?: boolean;
  suggestions?: readonly string[];
}) {
  const chat = useHiveChat();
  const published = useOmniCatalog().suggestions;
  const refreshOnMountRef = useRef<boolean | null>(null);
  if (chat && refreshOnMountRef.current === null) refreshOnMountRef.current = chat.isThreadDirty();
  if (!chat) return null;
  return (
    <AskChat
      config={chat.config}
      variant={variant}
      // The panel is the one on screen only while it is visible and the sheet is not covering it.
      active={variant === "panel" ? active && chat.panelVisible && !chat.sheetOpen : active}
      request={chat.request}
      onRequestConsumed={chat.consumeRequest}
      suggestions={suggestions ?? published}
      handedOffIds={chat.handedOffIds}
      onHandedOff={chat.markHandedOff}
      onClose={chat.closeSheet}
      refreshOnMount={refreshOnMountRef.current === true}
      onSent={chat.markThreadDirty}
    />
  );
}
