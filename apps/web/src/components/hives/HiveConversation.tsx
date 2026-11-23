"use client";

import { HIVE_MESSAGE_BODY_MAX, HIVE_MESSAGE_COUNTER_FROM, hiveMessageInitials, type HiveMessage } from "@hiveforyou/contracts";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { HiveMark } from "@/components/study/HiveMark";
import { Avatar as PersonAvatar } from "@/components/ui/AvatarStack";
import { Button } from "@/components/ui/Button";
import { Composer } from "@/components/ui/Composer";
import { Segmented } from "@/components/ui/Segmented";
import {
  avatarClassFor,
  bylineRole,
  messageDayKey,
  messageDayLabel,
  messageTimeLabel,
  showsAsMine,
  type ConversationViewer,
} from "@/components/hives/hive-conversation-view";
import { AssistantReplyBody } from "@/components/hives/assistant-reply-body";
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
import { SourceChipsCapped } from "@/components/study/SourceChip";
import { assistantComposerHint, conversationComposerPlaceholder } from "@/components/hives/board-composer-copy";
import { personFirstName } from "@/lib/hives/firm-board";
import { hiveDocumentsPath, hiveNotesPath } from "@/lib/hive-routes";

export const CONVERSATION_EMPTY = "No messages yet. Start the conversation — everyone in this hive will see it.";
export const CONVERSATION_STAFF_NOTE_LEAD = "For staff-only notes use";
const BOTTOM_SLACK_PX = 48;
const COMPOSER_MAX_PX = 154;

/** Allowed exception to the “no Ask anything” rule (DESIGN.md empty Ask state). */
export const ASSISTANT_EMPTY_HEADING = "Ask anything about these documents";

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
  mode?: "people" | "assistant";
  assistantName?: string;
  teamMemberFirstName?: string | null;
  firmless?: boolean;
  previewViewer?: ConversationViewer;
  onPreviewViewerChange?: (viewer: ConversationViewer) => void;
  previewOnTabs?: boolean;
  readOnly?: boolean;
  threadOwnerUserId?: string | null;
  onThreadOwnerChange?: (userId: string | null) => void;
  clientThreadUserId?: string | null;
  clientThreadFirstName?: string | null;
  currentUserId?: string | null;
  onSwitchToConversation?: () => void;
  /** Home column: people-only header, no preview switch, page scroll under 1100px. */
  column?: {
    otherFirstName: string;
    otherFullName: string;
    otherKind: "client" | "staff";
    assistantName: string;
    header?: "default" | "hidden";
    peopleLockHint?: string;
  } | null;
  /** Replaces the composer text. `nonce` changes when Home asks again. */
  fillDraft?: { nonce: number; text: string } | null;
  /** When set, the shared composer stays closed until membership is accepted. */
  sharedClosed?: string | null;
  peopleHint?: string | null;
};

const noopSubscribe = () => () => undefined;

function teamHandoffLabel(teamMemberFirstName: string | null | undefined): string {
  const trimmed = teamMemberFirstName?.trim();
  return trimmed ? personFirstName(trimmed) : "the team";
}

type ConversationPreviewSelectProps = {
  id: string;
  value: ConversationViewer;
  onChange: (viewer: ConversationViewer) => void;
};

export function ConversationPreviewSelect({ id, value, onChange }: ConversationPreviewSelectProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="text-[13px] text-ink-3">
        Preview as
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value === "client" ? "client" : "self")}
        className="min-h-10 rounded-control border border-line bg-paper px-2.5 text-[13px] text-ink"
      >
        <option value="self">You</option>
        <option value="client">Client</option>
      </select>
    </div>
  );
}

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

function Avatar({
  name,
  className,
  assistant,
}: {
  name: string;
  className: string;
  assistant?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-8 w-8 flex-none place-items-center rounded-pill text-label font-semibold ${className}`}
    >
      {assistant ? <HiveMark className="h-[15px] w-[15px]" /> : hiveMessageInitials(name)}
    </span>
  );
}

const BODY_CLASS =
  "m-0 mt-0.5 whitespace-pre-wrap break-words text-body text-ink [overflow-wrap:anywhere]";

function MessageRow({
  hiveId,
  message,
  mine,
  mounted,
  revealActive,
  onRevealComplete,
  fromAskAssistantName,
}: {
  hiveId: string;
  message: HiveMessage;
  mine: boolean;
  mounted: boolean;
  revealActive: boolean;
  onRevealComplete: (messageId: string) => void;
  fromAskAssistantName?: string | null;
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
    <article
      className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 py-3"
      data-testid="hive-message"
      data-mine={mine ? "true" : "false"}
    >
      <Avatar
        name={message.authorDisplayName}
        className={avatarClassFor(message.authorRole)}
        assistant={assistant}
      />
      <div className="min-w-0">
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-meta text-ink-3">
          <strong className="text-small font-semibold text-ink">
            {message.authorDisplayName}
            {mine ? <span className="font-normal text-ink-3"> · you</span> : null}
          </strong>
          {role ? (
            <>
              <span aria-hidden="true">·</span>
              {assistant ? (
                <span className="rounded-[5px] border border-line-strong px-1.5 text-[11.5px] font-semibold text-ink-2">
                  AI assistant
                </span>
              ) : (
                <span>{role}</span>
              )}
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <time dateTime={message.createdAt}>{mounted ? messageTimeLabel(message.createdAt) : ""}</time>
        </p>
        {fromAskAssistantName && message.handoffFromMessageId ? (
          <p className="m-0 text-meta text-ink-3" data-testid="hive-message-handoff-line">
            Passed on from Ask {fromAskAssistantName}
          </p>
        ) : null}
        <p
          className={BODY_CLASS}
          {...(assistant && revealActive && !revealComplete ? { "aria-hidden": true } : {})}
          {...(assistant && revealComplete ? { "aria-live": "polite" as const } : {})}
        >
          {assistant && revealComplete ? <AssistantReplyBody text={message.body} /> : bodyText}
        </p>
        {showChips ? <CardChips refs={chipRefs} /> : null}
        {itemKey ? (
          <p className="m-0 mt-2 text-label">
            <Link href={`${hiveDocumentsPath(hiveId)}#requested`} className="font-medium text-blue-deep no-underline hover:underline">
              Documents → What we asked for
            </Link>
          </p>
        ) : null}
      </div>
    </article>
  );
}

function CardChips({
  refs,
}: {
  refs: { sourceDocumentId: string; pageNumber: number; shortLabel?: string; factIds?: string[] }[];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <SourceChipsCapped refs={refs} />
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
    <article className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 py-3" data-testid="hive-message-pending" data-status={item.status}>
      <Avatar name={ownName} className={ownAvatarClass} />
      <div className="min-w-0">
        <p className="m-0 flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-ink-3">
          <strong className="text-[13px] font-semibold text-ink">{ownName}</strong>
          <span aria-hidden="true">·</span>
          <span>{failed ? "Not sent" : "Sending…"}</span>
        </p>
        <p className={BODY_CLASS}>{item.body}</p>
        {failed && item.failure ? (
          <div className="mt-2.5 border-t border-blue-tint pt-2.5">
            <p role="alert" className="m-0 text-caption text-ink">
              {item.failure.message}
              {item.failure.reference ? (
                <>
                  {" "}
                  Reference <span className="tabular-nums">{item.failure.reference}</span>.
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
  mode = "people",
  assistantName: assistantNameProp = "HiveForYou",
  teamMemberFirstName = null,
  firmless = false,
  previewViewer,
  onPreviewViewerChange,
  previewOnTabs = false,
  readOnly = false,
  threadOwnerUserId = null,
  onThreadOwnerChange,
  clientThreadUserId = null,
  clientThreadFirstName = null,
  currentUserId = null,
  onSwitchToConversation,
  column = null,
  fillDraft = null,
  sharedClosed = null,
  peopleHint = null,
}: HiveConversationProps) {
  const conversation = useHiveConversation({
    hiveId,
    initial,
    channel: mode,
    threadOwnerUserId: mode === "assistant" ? threadOwnerUserId : null,
    assistantTrigger: mode === "assistant" ? { staffView, viewerIsClient, hiveFirmId } : undefined,
    assistantName: assistantNameProp,
  });
  const assistantTypingLongWait = useAssistantTypingPhase(
    conversation.pendingAssistant,
    conversation.assistantTypingStartedAt,
  );
  const mounted = useMounted();
  const [internalViewer, setInternalViewer] = useState<ConversationViewer>("self");
  const viewer = previewViewer ?? internalViewer;
  const setViewer = onPreviewViewerChange ?? setInternalViewer;
  const [draft, setDraft] = useState("");
  const [showNewPill, setShowNewPill] = useState(false);
  const [handedOffAssistantIds, setHandedOffAssistantIds] = useState<ReadonlySet<string>>(() => new Set());
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

  const displayAssistantName = conversation.assistantName || assistantNameProp;
  const assistantMode = mode === "assistant";

  const handoffAskTeam = useCallback(
    (assistantMessageId: string, questionBody: string) => {
      if (firmless) return;
      void conversation.handoffToPeople(questionBody, assistantMessageId).then((ok) => {
        if (ok) {
          setHandedOffAssistantIds((ids) => new Set([...ids, assistantMessageId]));
          onSwitchToConversation?.();
        }
      });
    },
    [conversation, firmless, onSwitchToConversation],
  );

  const clientThreadQuestionCount = useMemo(() => {
    if (!clientThreadUserId) return null;
    const match = conversation.assistantThreads.find(
      (thread) => thread.userId.toLowerCase() === clientThreadUserId.toLowerCase(),
    );
    if (!match || match.messageCount < 1) return null;
    return match.messageCount;
  }, [clientThreadUserId, conversation.assistantThreads]);

  const filledNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!fillDraft || filledNonceRef.current === fillDraft.nonce) return;
    filledNonceRef.current = fillDraft.nonce;
    setDraft(fillDraft.text);
    textareaRef.current?.focus();
  }, [fillDraft]);

  const showConversationHead = !column && (assistantMode || !previewOnTabs);

  const head =
    column && column.header !== "hidden" ? (
      <header className="flex shrink-0 items-center justify-between gap-2.5 border-b border-line pb-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[16px] font-semibold text-ink">Conversation with {column.otherFirstName}</h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">
            People only. {column.assistantName} doesn&apos;t take part here.
          </p>
        </div>
        <PersonAvatar person={{ id: "other", name: column.otherFullName, kind: column.otherKind }} />
      </header>
    ) : showConversationHead ? (
    <header className="mb-2 flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        {assistantMode && readOnly && clientThreadFirstName ? (
          <p className="m-0 text-meta text-ink-2" data-testid="hive-assistant-readonly-note">
            {personFirstName(clientThreadFirstName)} asked these. Only your team can see them.
          </p>
        ) : null}
      </div>
      {assistantMode && staffView && !firmless && clientThreadUserId && onThreadOwnerChange && currentUserId ? (
        <Segmented
          ariaLabel="Assistant thread"
          testId="hive-assistant-thread-select"
          options={[
            { id: "self", label: "Your questions" },
            {
              id: "client",
              label: `${personFirstName(clientThreadFirstName ?? clientName ?? "Client")}'s questions`,
              count: clientThreadQuestionCount,
            },
          ]}
          value={
            threadOwnerUserId?.toLowerCase() === clientThreadUserId.toLowerCase() ? "client" : "self"
          }
          onChange={(next) => {
            if (next === "client") onThreadOwnerChange(clientThreadUserId);
            else onThreadOwnerChange(currentUserId);
          }}
        />
      ) : null}
      {assistantMode && staffView ? (
        <div className="flex flex-wrap items-center gap-3">
          {conversation.assistantAvailable ? (
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <span>AI assistant:</span>
              <button
                type="button"
                role="switch"
                aria-checked={conversation.assistantRepliesOn}
                data-testid="hive-assistant-switch"
                disabled={conversation.assistantSwitchPending || readOnly}
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
            <p className="m-0 max-w-xs text-[12px] text-ink-3" data-testid="hive-assistant-unavailable-note">
              The AI assistant answers only on hives with test documents for now.
            </p>
          )}
        </div>
      ) : staffView && !assistantMode && !previewOnTabs ? (
        <ConversationPreviewSelect id={previewSelectId} value={viewer} onChange={setViewer} />
      ) : null}
    </header>
  ) : null;

  if (conversation.unavailable) {
    return (
      <section aria-label="Conversation" className="flex flex-col">
        {head}
        <div className="flex flex-col gap-3 py-4">
          <p className="m-0 text-body text-ink">This hive is no longer available to you.</p>
          <Link href="/hives" className="text-small font-semibold text-blue-deep no-underline hover:underline">
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
      className={`flex min-w-0 flex-col ${column ? "h-full min-h-0" : ""}`}
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
          <div className={column ? "relative flex min-h-0 flex-1 flex-col" : "relative"}>
            <div
              ref={listRef}
              onScroll={onScroll}
              aria-live="polite"
              data-testid="hive-conversation-messages"
              className={`thread relative flex flex-col gap-0 py-2 ${
                column ? "min-h-0 flex-1 overflow-visible min-[1100px]:overflow-y-auto" : "max-h-[570px] min-h-[280px] overflow-y-auto"
              }`}
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
                assistantMode ? (
                  <div className="m-auto max-w-[420px] px-2 py-10 text-center" data-testid="hive-assistant-empty">
                    <h3 className="m-0 font-brand text-section font-semibold text-ink">{ASSISTANT_EMPTY_HEADING}</h3>
                    <p className="m-0 mt-1.5 text-meta text-ink-3">
                      Answers come only from the documents, with the page they&apos;re on.
                      {viewerIsClient && !firmless && !staffView ? (
                        <>
                          {" "}
                          If {displayAssistantName} can&apos;t answer, you can pass the question to{" "}
                          {teamHandoffLabel(teamMemberFirstName)}.
                        </>
                      ) : null}
                    </p>
                  </div>
                ) : sharedClosed ? (
                  <p className="m-auto max-w-[420px] text-center text-small text-ink-2" data-testid="hive-pro-conversation-closed">
                    {sharedClosed}
                  </p>
                ) : (
                  <p className="m-auto max-w-[420px] text-center text-small text-ink-2">{CONVERSATION_EMPTY}</p>
                )
              ) : null}
              {messages.map((message) => {
                const day = mounted ? messageDayKey(message.createdAt) : null;
                const dayChanged = day !== null && day !== previousDay;
                previousDay = day;
                return (
                  <Fragment key={message.id}>
                    {dayChanged && now ? (
                      <p
                        className={
                          column
                            ? "my-4 text-center text-[11.5px] text-ink-3"
                            : "my-5 flex items-center gap-3 text-label text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line"
                        }
                        data-testid="hive-conversation-day"
                      >
                        {messageDayLabel(message.createdAt, now)}
                      </p>
                    ) : null}
                    {showDivider && conversation.newDividerId === message.id ? (
                      <div
                        role="separator"
                        aria-label="New messages"
                        data-new-divider=""
                        className="flex items-center gap-3 text-caption font-semibold text-blue-deep"
                      >
                        <span className="h-px flex-1 bg-blue-wash" aria-hidden="true" />
                        New
                        <span className="h-px flex-1 bg-blue-wash" aria-hidden="true" />
                      </div>
                    ) : null}
                    <MessageRow
                      hiveId={hiveId}
                      message={message}
                      mine={showsAsMine(message, preview ? "client" : "self")}
                      mounted={mounted}
                      revealActive={assistantMode && conversation.assistantRevealIds.has(message.id)}
                      onRevealComplete={conversation.clearAssistantReveal}
                      fromAskAssistantName={!assistantMode ? displayAssistantName : null}
                    />
                    {assistantMode && !preview && !readOnly && !firmless && message.authorKind === "assistant" ? (
                      (() => {
                        const status = message.assistantRunStatus;
                        const routed = status === "routed" || status === "failed";
                        const trigger = message.triggerMessageId
                          ? messages.find((row) => row.id === message.triggerMessageId)
                          : null;
                        const handedOff = handedOffAssistantIds.has(message.id);
                        if (handedOff) {
                          return (
                            <p className="m-0 ms-11 text-meta text-ink-3" data-testid="hive-assistant-handoff-sent">
                              Sent to {teamHandoffLabel(teamMemberFirstName)} in the Conversation.
                            </p>
                          );
                        }
                        if (!routed || !trigger || !viewerIsClient) return null;
                        return (
                          <Button
                            type="button"
                            variant="secondary"
                            size="small"
                            className="ms-11 mt-2.5 self-start"
                            data-testid="hive-assistant-handoff"
                            onClick={() => handoffAskTeam(message.id, trigger.body)}
                          >
                            Ask {teamHandoffLabel(teamMemberFirstName)}
                          </Button>
                        );
                      })()
                    ) : null}
                    {assistantMode &&
                    !preview &&
                    !viewerIsClient &&
                    message.authorKind === "person" &&
                    conversation.failedAssistantForMessageIds.includes(message.id) ? (
                      <p className="m-0 ms-11 text-[12px] text-ink-3" data-testid="hive-assistant-failed-line">
                        {displayAssistantName} couldn&apos;t answer this one.
                      </p>
                    ) : null}
                  </Fragment>
                );
              })}
              {assistantMode && !preview && !readOnly && conversation.pendingAssistant ? (
                <AssistantTypingRow assistantName={displayAssistantName} longWait={assistantTypingLongWait} />
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
            <p className="m-0 border-t border-line px-5 py-4 text-small text-ink-2 max-[649px]:p-[15px]">
              Preview — this is what {clientFirst} sees.
            </p>
          ) : readOnly || sharedClosed ? null : (
            <Composer
              textareaId={composerId}
              textareaLabel={assistantMode ? "Question" : "Message"}
              primaryLabel={assistantMode ? "Ask" : "Send"}
              primaryTrailIcon
              primaryDisabled={!draft.trim() || conversation.sending}
              onPrimary={submitDraft}
              lock={Boolean(column)}
              hint={
                assistantMode ? (
                  assistantComposerHint({
                    staffView,
                    viewerIsClient,
                    firmless,
                    assistantName: displayAssistantName,
                    teamMemberFirstName,
                  })
                ) : column ? (
                  <span data-testid="hive-conversation-people-hint">
                    {column.peopleLockHint ?? "Everyone in this hive sees this"}
                  </span>
                ) : (
                  <span data-testid="hive-conversation-people-hint">
                    {peopleHint ?? "Everyone in this hive sees this conversation."}
                    {!peopleHint && staffView ? (
                      <>
                        {" "}
                        {CONVERSATION_STAFF_NOTE_LEAD}{" "}
                        <Link href={hiveNotesPath(hiveId)} className="font-medium text-blue-deep hover:underline">
                          Team notes
                        </Link>
                        .
                      </>
                    ) : null}
                  </span>
                )
              }
              footer={
                draft.length > HIVE_MESSAGE_COUNTER_FROM ? (
                  <p className="m-0 border-t border-line px-4 py-1 text-end text-caption text-ink-2" data-testid="hive-conversation-counter">
                    {draft.length.toLocaleString("en-US")} / {HIVE_MESSAGE_BODY_MAX.toLocaleString("en-US")}
                  </p>
                ) : null
              }
              textareaRef={textareaRef}
              textareaProps={{
                value: draft,
                maxLength: HIVE_MESSAGE_BODY_MAX,
                rows: 2,
                placeholder: assistantMode
                  ? `Ask ${displayAssistantName} about the documents…`
                  : column
                    ? `Write to ${column.otherFirstName}…`
                    : conversationComposerPlaceholder({
                        viewerIsClient,
                        clientName,
                        clientAuthorName: clientAuthor ?? null,
                        teamMemberFirstName,
                      }),
                onChange: (event) => {
                  setDraft(event.target.value);
                  resizeComposer();
                },
                onKeyDown: onComposerKeyDown,
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
