"use client";

import { HIVE_MESSAGE_BODY_MAX, HIVE_MESSAGE_COUNTER_FROM, hiveMessageInitials, type HiveMessage } from "@hiveforyou/contracts";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import { WORKSPACE_PRIMARY, WORKSPACE_SECONDARY } from "@/components/button-classes";
import {
  avatarClassFor,
  bylineRole,
  messageDayKey,
  messageDayLabel,
  messageTimeLabel,
  participantLine,
  showsAsMine,
  type ConversationViewer,
} from "@/components/hives/hive-conversation-view";
import {
  AssistantTypingRow,
  useAssistantMessageReveal,
  useAssistantTypingPhase,
} from "@/components/hives/assistant-conversation-ui";
import {
  useHiveConversation,
  type ConversationLoad,
  type PendingHiveMessage,
} from "@/components/hives/useHiveConversation";
import { WorkspaceError } from "@/components/workspace/WorkspaceError";
import { SourceChips } from "@/components/study/SourceChip";
import { personFirstName } from "@/lib/hives/firm-board";
import { hiveDocumentsPath, hiveNotesPath } from "@/lib/hive-routes";

export const CONVERSATION_EMPTY = "No messages yet. Start the conversation — everyone in this hive will see it.";
export const CONVERSATION_STAFF_NOTE_LEAD = "Everyone in this hive sees this, including the client. For staff-only notes use";
const BOTTOM_SLACK_PX = 48;
const COMPOSER_MAX_PX = 154;

export type HiveConversationProps = {
  hiveId: string;
  initial: ConversationLoad;
  /** Firm staff on a client hive: Preview as and the staff note. */
  staffView: boolean;
  /** Fallback for the preview line when the client has not written yet. */
  clientName: string | null;
  /** Avatar colour for the viewer's own unsent messages. */
  viewerIsClient: boolean;
  hiveFirmId?: string | null;
};

const noopSubscribe = () => () => undefined;

function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX;
}

function Avatar({ name, className }: { name: string; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-[35px] w-[35px] flex-none place-items-center rounded-[11px] text-[12px] font-bold ${className}`}
    >
      {hiveMessageInitials(name)}
    </span>
  );
}

function bubbleClass(mine: boolean): string {
  return `min-w-0 max-w-[650px] rounded-[13px] border px-[15px] py-3 max-[649px]:max-w-none max-[649px]:flex-1 ${
    mine ? "border-cell-blue-tint bg-cell-blue-wash" : "border-line bg-paper"
  }`;
}

function rowClass(mine: boolean): string {
  return `flex items-start gap-[11px] ${mine ? "flex-row-reverse self-end" : "self-start"} max-w-full max-[649px]:w-full`;
}

const BODY_CLASS =
  "m-0 mt-[5px] whitespace-pre-wrap break-words text-[14px] leading-[1.55] text-ink [overflow-wrap:anywhere]";

function MessageRow({
  hiveId,
  message,
  mine,
  mounted,
  revealActive,
  onRevealComplete,
}: {
  hiveId: string;
  message: HiveMessage;
  mine: boolean;
  mounted: boolean;
  revealActive: boolean;
  onRevealComplete: (messageId: string) => void;
}) {
  const assistant = message.authorKind === "assistant";
  const role = assistant ? "AI assistant" : bylineRole(message);
  const { displayBody, revealComplete } = useAssistantMessageReveal(message, assistant && revealActive);
  useEffect(() => {
    if (assistant && revealActive && revealComplete) onRevealComplete(message.id);
  }, [assistant, message.id, onRevealComplete, revealActive, revealComplete]);
  const chipRefs = message.sourceRefs
    .filter((ref) => ref.sourceDocumentId && ref.pageNumber > 0)
    .map((ref) => ({
      sourceDocumentId: ref.sourceDocumentId,
      pageNumber: ref.pageNumber,
      ...(ref.shortLabel ? { shortLabel: ref.shortLabel } : {}),
      ...(ref.factId ? { factIds: [ref.factId] } : {}),
    }));
  const bodyText = assistant && revealActive ? displayBody : message.body;
  const showChips = chipRefs.length > 0 && (!assistant || !revealActive || revealComplete);
  const itemKey = message.sourceRefs.find((ref) => ref.itemKey)?.itemKey;
  return (
    <article className={rowClass(mine)} data-testid="hive-message" data-mine={mine ? "true" : "false"}>
      <Avatar name={message.authorDisplayName} className={avatarClassFor(message.authorRole)} />
      <div className={bubbleClass(mine)}>
        <p className="m-0 flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-quiet">
          <strong className="text-[13px] font-semibold text-ink">{message.authorDisplayName}</strong>
          {role ? (
            <>
              <span aria-hidden="true">·</span>
              {assistant ? (
                <span className="rounded-pill bg-cell-blue-wash px-1.5 py-px text-[11px] font-medium text-ink">{role}</span>
              ) : (
                <span>{role}</span>
              )}
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <time dateTime={message.createdAt}>{mounted ? messageTimeLabel(message.createdAt) : ""}</time>
        </p>
        <p
          className={BODY_CLASS}
          {...(assistant && revealActive && !revealComplete ? { "aria-hidden": true } : {})}
          {...(assistant && revealComplete ? { "aria-live": "polite" as const } : {})}
        >
          {bodyText}
        </p>
        {showChips ? <CardChips refs={chipRefs} /> : null}
        {itemKey ? (
          <p className="m-0 mt-2 text-[12px]">
            <Link href={`${hiveDocumentsPath(hiveId)}#requested`} className="font-medium text-cell-blue-deep no-underline">
              Documents → What we asked for
            </Link>
          </p>
        ) : null}
      </div>
    </article>
  );
}

function CardChips({ refs }: { refs: { sourceDocumentId: string; pageNumber: number; factIds?: string[] }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <SourceChips refs={refs} />
    </div>
  );
}

function PendingRow({
  item,
  ownName,
  ownAvatarClass,
  canRetry,
  onRetry,
  onRemove,
}: {
  item: PendingHiveMessage;
  ownName: string;
  ownAvatarClass: string;
  canRetry: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const failed = item.status === "failed";
  return (
    <article className={rowClass(true)} data-testid="hive-message-pending" data-status={item.status}>
      <Avatar name={ownName} className={ownAvatarClass} />
      <div className={bubbleClass(true)}>
        <p className="m-0 flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-quiet">
          <strong className="text-[13px] font-semibold text-ink">{ownName}</strong>
          <span aria-hidden="true">·</span>
          <span>{failed ? "Not sent" : "Sending…"}</span>
        </p>
        <p className={BODY_CLASS}>{item.body}</p>
        {failed && item.failure ? (
          <div className="mt-2.5 border-t border-cell-blue-tint pt-2.5">
            <p role="alert" className="m-0 text-caption text-ink">
              {item.failure.message}
              {item.failure.reference ? (
                <>
                  {" "}
                  Reference <span className="font-mono">{item.failure.reference}</span>.
                </>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.failure.retryable ? (
                <button type="button" className={WORKSPACE_SECONDARY} disabled={!canRetry} onClick={onRetry}>
                  Try again
                </button>
              ) : null}
              <button type="button" className={WORKSPACE_SECONDARY} onClick={onRemove}>
                Remove
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function HiveConversation({
  hiveId,
  initial,
  staffView,
  clientName,
  viewerIsClient,
  hiveFirmId = null,
}: HiveConversationProps) {
  const conversation = useHiveConversation({
    hiveId,
    initial,
    assistantTrigger: { staffView, viewerIsClient, hiveFirmId },
  });
  const assistantTypingLongWait = useAssistantTypingPhase(
    conversation.pendingAssistant,
    conversation.assistantTypingStartedAt,
  );
  const mounted = useMounted();
  const [viewer, setViewer] = useState<ConversationViewer>("self");
  const [draft, setDraft] = useState("");
  const [showNewPill, setShowNewPill] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);
  const earlierAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const handledSeqRef = useRef<number | null>(null);
  const composerId = useId();
  const previewSelectId = useId();

  const preview = staffView && viewer === "client";
  const { messages, pending, change } = conversation;

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    atBottomRef.current = true;
    setShowNewPill(false);
  }, []);

  useLayoutEffect(() => {
    if (!mounted || handledSeqRef.current === change.seq) return;
    handledSeqRef.current = change.seq;
    const list = listRef.current;
    if (!list) return;
    if (change.kind === "initial") {
      const divider = list.querySelector<HTMLElement>("[data-new-divider]");
      if (divider) {
        list.scrollTop = Math.max(0, divider.offsetTop - 12);
        atBottomRef.current = isNearBottom(list);
      } else {
        list.scrollTop = list.scrollHeight;
        atBottomRef.current = true;
      }
      conversation.scheduleMarkRead();
      return;
    }
    if (change.kind === "earlier") {
      const anchor = earlierAnchorRef.current;
      earlierAnchorRef.current = null;
      if (anchor) list.scrollTop = list.scrollHeight - anchor.height + anchor.top;
      return;
    }
    if (change.kind === "sent") {
      scrollToBottom();
      return;
    }
    if (change.kind === "failed") {
      if (atBottomRef.current) scrollToBottom();
      return;
    }
    if (atBottomRef.current) {
      scrollToBottom();
      conversation.scheduleMarkRead();
    } else {
      setShowNewPill(true);
    }
  }, [change, conversation, mounted, scrollToBottom]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    atBottomRef.current = isNearBottom(list);
    if (atBottomRef.current && showNewPill) {
      setShowNewPill(false);
      conversation.scheduleMarkRead();
    }
  };

  const resizeComposer = () => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, COMPOSER_MAX_PX)}px`;
  };

  const submitDraft = () => {
    if (conversation.send(draft)) {
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

  const loadEarlier = () => {
    const list = listRef.current;
    earlierAnchorRef.current = list ? { height: list.scrollHeight, top: list.scrollTop } : null;
    void conversation.loadEarlier();
  };

  const ownName = messages.find((message) => message.isMine)?.authorDisplayName ?? "You";
  const clientAuthor = messages.find((message) => message.authorRole === "client")?.authorDisplayName;
  const clientFirst = personFirstName(clientAuthor ?? clientName ?? "") || "the client";
  const now = mounted ? new Date() : null;
  const showDivider = !preview && conversation.newDividerId !== null;

  const head = (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-[22px] py-5 max-[649px]:p-4">
      <div className="min-w-0">
        <h3 className="m-0 font-brand text-[20px] font-semibold leading-tight text-ink">Conversation</h3>
        <p className="m-0 mt-1 text-[13px] text-graphite" data-testid="hive-conversation-participants">
          {participantLine(
            conversation.participantLabels,
            conversation.participantCount,
            conversation.assistantAvailable,
          )}
        </p>
      </div>
      {staffView ? (
        <div className="flex flex-wrap items-center gap-3">
          {conversation.assistantAvailable ? (
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <span>AI assistant:</span>
              <button
                type="button"
                role="switch"
                aria-checked={conversation.assistantRepliesOn}
                data-testid="hive-assistant-switch"
                disabled={conversation.assistantSwitchPending}
                onClick={() => conversation.setAssistantReplies(!conversation.assistantRepliesOn)}
                className={`min-h-8 rounded-pill border px-3 py-1 text-[12px] font-semibold ${
                  conversation.assistantRepliesOn
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-paper text-ink"
                }`}
              >
                {conversation.assistantRepliesOn ? "On" : "Off"}
              </button>
            </label>
          ) : (
            <p className="m-0 max-w-xs text-[12px] text-quiet" data-testid="hive-assistant-unavailable-note">
              The AI assistant replies only on hives with test documents for now.
            </p>
          )}
          {conversation.assistantSwitchError ? (
            <p role="alert" className="m-0 text-caption text-ink">
              {conversation.assistantSwitchError.message}
              {conversation.assistantSwitchError.reference ? (
                <>
                  {" "}
                  Reference <span className="font-mono">{conversation.assistantSwitchError.reference}</span>.
                </>
              ) : null}
            </p>
          ) : null}
          <label htmlFor={previewSelectId} className="text-[13px] text-quiet">
            Preview as
          </label>
          <select
            id={previewSelectId}
            value={viewer}
            onChange={(event) => setViewer(event.target.value === "client" ? "client" : "self")}
            className="min-h-10 rounded-control border border-line bg-paper px-2.5 text-[13px] text-ink"
          >
            <option value="self">You</option>
            <option value="client">Client</option>
          </select>
        </div>
      ) : null}
    </header>
  );

  if (conversation.unavailable) {
    return (
      <section aria-label="Conversation" className="overflow-hidden rounded-[14px] border border-line bg-paper">
        {head}
        <div className="flex flex-col gap-3 p-[21px]">
          <p className="m-0 text-body text-ink">This hive is no longer available to you.</p>
          <Link href="/hives" className="text-small font-semibold text-cell-blue-deep no-underline">
            Back to your hives
          </Link>
        </div>
      </section>
    );
  }

  let previousDay: string | null = null;

  return (
    <section
      aria-label="Conversation"
      data-testid="hive-conversation"
      className="overflow-hidden rounded-[14px] border border-line bg-paper"
    >
      {head}
      {conversation.reconnecting ? (
        <p role="status" className="m-0 border-b border-line bg-honey-wash px-[22px] py-2 text-caption text-ink">
          Reconnecting… Your messages are saved.
        </p>
      ) : null}
      {conversation.loadError ? (
        <div className="p-[21px] max-[649px]:p-3.5">
          <WorkspaceError
            message={conversation.loadError.message}
            correlationId={conversation.loadError.correlationId}
            retryable={conversation.loadError.retryable && !conversation.retryingLoad}
            onRetry={() => void conversation.retryLoad()}
          />
        </div>
      ) : (
        <>
          <div className="relative">
            <div
              ref={listRef}
              onScroll={onScroll}
              aria-live="polite"
              data-testid="hive-conversation-messages"
              className="relative flex max-h-[570px] min-h-[345px] flex-col gap-[18px] overflow-y-auto p-[21px] max-[649px]:p-3.5"
            >
              {conversation.nextCursor ? (
                <button
                  type="button"
                  className={`${WORKSPACE_SECONDARY} self-center`}
                  disabled={conversation.loadingEarlier}
                  onClick={loadEarlier}
                >
                  {conversation.loadingEarlier ? "Loading…" : "Load earlier messages"}
                </button>
              ) : null}
              {conversation.earlierError ? (
                <p role="alert" className="m-0 self-center text-caption text-ink">
                  {conversation.earlierError}
                </p>
              ) : null}
              {messages.length === 0 && pending.length === 0 ? (
                <p className="m-auto max-w-[420px] text-center text-small text-graphite">{CONVERSATION_EMPTY}</p>
              ) : null}
              {messages.map((message) => {
                const day = mounted ? messageDayKey(message.createdAt) : null;
                const dayChanged = day !== null && day !== previousDay;
                previousDay = day;
                return (
                  <Fragment key={message.id}>
                    {dayChanged && now ? (
                      <p className="m-0 self-center text-caption font-medium text-quiet" data-testid="hive-conversation-day">
                        {messageDayLabel(message.createdAt, now)}
                      </p>
                    ) : null}
                    {showDivider && conversation.newDividerId === message.id ? (
                      <div
                        role="separator"
                        aria-label="New messages"
                        data-new-divider=""
                        className="flex items-center gap-3 text-caption font-semibold text-cell-blue-deep"
                      >
                        <span className="h-px flex-1 bg-cell-blue-tint" aria-hidden="true" />
                        New
                        <span className="h-px flex-1 bg-cell-blue-tint" aria-hidden="true" />
                      </div>
                    ) : null}
                    <MessageRow
                      hiveId={hiveId}
                      message={message}
                      mine={showsAsMine(message, preview ? "client" : "self")}
                      mounted={mounted}
                      revealActive={conversation.assistantRevealIds.has(message.id)}
                      onRevealComplete={conversation.clearAssistantReveal}
                    />
                    {!preview && !viewerIsClient && conversation.failedAssistantForMessageIds.includes(message.id) ? (
                      <p className="m-0 ms-11 text-[12px] text-quiet" data-testid="hive-assistant-failed-line">
                        {conversation.assistantName} couldn&apos;t answer this one.
                      </p>
                    ) : null}
                  </Fragment>
                );
              })}
              {!preview && conversation.pendingAssistant ? (
                <AssistantTypingRow assistantName={conversation.assistantName} longWait={assistantTypingLongWait} />
              ) : null}
              {pending.map((item) => (
                <PendingRow
                  key={item.clientRequestId}
                  item={item}
                  ownName={ownName}
                  ownAvatarClass={avatarClassFor(viewerIsClient ? "client" : "staff")}
                  canRetry={!conversation.sending}
                  onRetry={() => conversation.retry(item.clientRequestId)}
                  onRemove={() => conversation.remove(item.clientRequestId)}
                />
              ))}
            </div>
            {showNewPill ? (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill border-0 bg-ink px-3.5 py-1.5 text-caption font-semibold text-paper shadow-sm"
              >
                New messages ↓
              </button>
            ) : null}
          </div>
          {preview ? (
            <p className="m-0 border-t border-line px-5 py-4 text-small text-graphite max-[649px]:p-[15px]">
              Preview — this is what {clientFirst} sees.
            </p>
          ) : (
            <div className="border-t border-line px-5 pb-5 pt-[17px] max-[649px]:p-[15px]">
              <label htmlFor={composerId} className="mb-1.5 block text-[12px] font-medium text-quiet">
                Message
              </label>
              <textarea
                id={composerId}
                ref={textareaRef}
                value={draft}
                maxLength={HIVE_MESSAGE_BODY_MAX}
                rows={3}
                placeholder="Write a message to the conversation…"
                onChange={(event) => {
                  setDraft(event.target.value);
                  resizeComposer();
                }}
                onKeyDown={onComposerKeyDown}
                className="block min-h-[82px] w-full resize-none rounded-[12px] border border-line-strong bg-paper px-3.5 py-3 text-[14px] leading-[1.55] text-ink placeholder:text-quiet"
              />
              {draft.length > HIVE_MESSAGE_COUNTER_FROM ? (
                <p className="m-0 mt-1 text-end text-caption text-graphite" data-testid="hive-conversation-counter">
                  {draft.length.toLocaleString("en-US")} / {HIVE_MESSAGE_BODY_MAX.toLocaleString("en-US")}
                </p>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5">
                {staffView ? (
                  <p className="m-0 max-w-[520px] text-[12px] leading-[1.55] text-graphite" data-testid="hive-conversation-assistant-hint">
                    Start a message with {conversation.assistantName} to ask the assistant.
                  </p>
                ) : null}
                {staffView ? (
                  <p className="m-0 max-w-[520px] text-[12px] leading-[1.55] text-graphite" data-testid="hive-conversation-staff-note">
                    {CONVERSATION_STAFF_NOTE_LEAD}{" "}
                    <Link href={hiveNotesPath(hiveId)} className="font-medium text-cell-blue-deep">
                      Team notes
                    </Link>
                    .
                  </p>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  className={`${WORKSPACE_PRIMARY} ms-auto`}
                  disabled={!draft.trim() || conversation.sending}
                  onClick={submitDraft}
                >
                  Send message →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
