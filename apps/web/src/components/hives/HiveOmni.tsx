"use client";

import { type HiveMessage, type HiveMessagePage } from "@hiveforyou/contracts";
import { useEffect, useMemo, useState } from "react";

import { useEvidenceViewer } from "@/components/study/EvidenceViewer";
import type { ChipRef } from "@/components/study/SourceChip";
import { useAssistantTypingPhase } from "@/components/hives/assistant-conversation-ui";
import {
  useHiveConversation,
  type ConversationLoad,
  type PendingHiveMessage,
} from "@/components/hives/useHiveConversation";
import { OmniBox, type OmniAnswer } from "@/components/ui/OmniBox";
import { useOmniCatalog } from "@/components/ui/omni-catalog";
import type { OmniQuestion } from "@/components/ui/omni-catalog";
import { Toast } from "@/components/ui/Toast";
import { personFirstName } from "@/lib/hives/firm-board";

function emptyAssistantPage(assistantName: string): HiveMessagePage {
  return {
    messages: [],
    participantRoleLabels: [],
    participantCount: 0,
    viewerLastReadAt: null,
    nextCursor: null,
    pendingAssistant: false,
    assistantRepliesOn: true,
    assistantAvailable: true,
    assistantThreads: [],
    assistantName,
  };
}

function chipsOf(message: HiveMessage | undefined): ChipRef[] {
  if (!message) return [];
  return message.sourceRefs
    .filter((ref) => ref.pageNumber >= 1 && ref.sourceDocumentId)
    .map((ref) => ({
      sourceDocumentId: ref.sourceDocumentId,
      pageNumber: ref.pageNumber,
      shortLabel: ref.shortLabel,
    }));
}

export function questionsFrom(messages: readonly HiveMessage[]): OmniQuestion[] {
  const rows: OmniQuestion[] = [];
  for (const message of messages) {
    if (message.authorKind !== "person") continue;
    const reply = messages.find((row) => row.authorKind === "assistant" && row.triggerMessageId === message.id);
    rows.push({
      id: message.id,
      question: message.body,
      answer: reply?.body ?? "",
      refs: chipsOf(reply),
    });
  }
  return rows.reverse().slice(0, 5);
}

function referenceSnippet(correlationId: string): string {
  return correlationId.slice(0, 8);
}

function clientQuestionsLoadError(
  load: ConversationLoad | null | undefined,
  clientName: string | null,
): { message: string; reference: string | null } | null {
  if (!load || load.ok) return null;
  const who = clientName ? personFirstName(clientName) : "the client";
  return {
    message: `Couldn't load ${who}'s questions.`,
    reference: load.correlationId ? referenceSnippet(load.correlationId) : null,
  };
}

export function HiveOmni({
  hiveId,
  assistantName,
  audience,
  staffFirstName,
  clientName,
  currentUserId,
  firmless,
  firmId,
  initialAssistant,
  initialClientAssistant = null,
}: {
  hiveId: string;
  assistantName: string;
  audience: "staff" | "client";
  staffFirstName: string | null;
  clientName: string | null;
  currentUserId: string | null;
  firmless: boolean;
  firmId: string | null;
  initialAssistant: ConversationLoad;
  initialClientAssistant?: ConversationLoad | null;
}) {
  const catalog = useOmniCatalog();
  const viewer = useEvidenceViewer();
  const assistantInitial = useMemo((): ConversationLoad => {
    if (initialAssistant.ok) return initialAssistant;
    return {
      ok: true,
      page: emptyAssistantPage(assistantName),
    };
  }, [assistantName, initialAssistant]);

  const serverYourQuestions = useMemo(
    () => (initialAssistant.ok ? questionsFrom(initialAssistant.page.messages) : []),
    [initialAssistant],
  );
  const serverClientQuestions = useMemo(() => {
    if (!initialClientAssistant?.ok) return [];
    return questionsFrom(initialClientAssistant.page.messages);
  }, [initialClientAssistant]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<OmniQuestion | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [trackingMessageId, setTrackingMessageId] = useState<string | null>(null);
  const [activeSendRequestId, setActiveSendRequestId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [awaitingReply, setAwaitingReply] = useState(false);

  const conversation = useHiveConversation({
    hiveId,
    initial: assistantInitial,
    channel: "assistant",
    threadOwnerUserId: currentUserId,
    assistantName,
    assistantTrigger: {
      staffView: audience === "staff",
      viewerIsClient: audience === "client",
      hiveFirmId: firmId,
    },
    enablePolling: open || awaitingReply,
  });

  useEffect(() => {
    if (conversation.assistantTriggerMessageId) {
      setTrackingMessageId(conversation.assistantTriggerMessageId);
    }
  }, [conversation.assistantTriggerMessageId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("ask") === "1") {
      setOpen(true);
      document.getElementById("omni")?.focus();
    }
  }, []);

  const pendingSend: PendingHiveMessage | undefined = activeSendRequestId
    ? conversation.pending.find((item) => item.clientRequestId === activeSendRequestId)
  : undefined;

  const failedSend = pendingSend?.status === "failed" ? pendingSend : undefined;

  const livePerson = trackingMessageId
    ? conversation.messages.find((message) => message.id === trackingMessageId)
    : undefined;
  const liveReply = trackingMessageId
    ? conversation.messages.find(
        (message) => message.authorKind === "assistant" && message.triggerMessageId === trackingMessageId,
      )
    : undefined;

  const liveQuestionText =
    history?.question ??
    livePerson?.body ??
    (failedSend ? failedSend.body : trackingMessageId ? pendingSend?.body ?? null : null);

  const pending =
    Boolean(trackingMessageId) &&
    !history &&
    !liveReply &&
    !failedSend &&
    (conversation.pendingAssistant || pendingSend?.status === "sending");

  const longWait = useAssistantTypingPhase(pending, askedAt);

  useEffect(() => {
    const waiting =
      open ||
      conversation.pendingAssistant ||
      (trackingMessageId != null && !liveReply && !failedSend) ||
      pendingSend?.status === "sending";
    setAwaitingReply(waiting);
  }, [conversation.pendingAssistant, failedSend, liveReply, open, pendingSend?.status, trackingMessageId]);

  const clientLoadError = useMemo(
    () => clientQuestionsLoadError(initialClientAssistant, clientName),
    [clientName, initialClientAssistant],
  );

  const yourQuestions =
    catalog.yourQuestions.length > 0
      ? catalog.yourQuestions
      : serverYourQuestions.length > 0
        ? serverYourQuestions
        : questionsFrom(conversation.messages);

  const mergedCatalog = useMemo(
    () => ({
      ...catalog,
      yourQuestions,
      clientQuestions:
        catalog.clientQuestions.length > 0 ? catalog.clientQuestions : serverClientQuestions,
      clientName: catalog.clientName ?? clientName,
      clientQuestionsLoadError: clientLoadError,
    }),
    [catalog, clientLoadError, clientName, serverClientQuestions, yourQuestions],
  );

  const answer: OmniAnswer | null =
    history || trackingMessageId || failedSend
      ? {
          question: liveQuestionText ?? "",
          pending,
          longWait,
          text: history ? history.answer : failedSend ? null : (liveReply?.body ?? null),
          refs: history ? history.refs : chipsOf(liveReply),
          handoff:
            !history &&
            !failedSend &&
            audience === "client" &&
            !firmless &&
            (liveReply?.assistantRunStatus === "routed" || liveReply?.assistantRunStatus === "failed"),
          readonlyNote: historyNote,
          sendError: failedSend?.failure
            ? {
                message: failedSend.failure.message,
                reference: failedSend.failure.reference,
                retryable: failedSend.failure.retryable,
              }
            : null,
          onRetrySend:
            failedSend && failedSend.failure?.retryable
              ? () => conversation.retry(failedSend.clientRequestId)
              : null,
        }
      : null;

  const ask = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setHistory(null);
    setHistoryNote(null);
    setTrackingMessageId(null);
    setAskedAt(Date.now());
    setOpen(true);
    setAwaitingReply(true);
    const requestId = conversation.send(trimmed);
    if (requestId) setActiveSendRequestId(requestId);
  };

  return (
    <>
      <OmniBox
        assistantName={assistantName}
        audience={audience}
        catalog={mergedCatalog}
        staffFirstName={staffFirstName ? personFirstName(staffFirstName) : null}
        query={query}
        onQueryChange={(value) => setQuery(value)}
        open={open}
        onOpenChange={setOpen}
        answer={answer}
        onAsk={ask}
        onOpenQuestion={(hit) => {
          setTrackingMessageId(null);
          setActiveSendRequestId(null);
          setHistory(hit.question);
          const name = clientName ? personFirstName(clientName) : "The client";
          setHistoryNote(
            hit.audience === "client" ? `${name} asked this. Only your team can see it.` : null,
          );
          setOpen(true);
        }}
        onOpenChip={(chip) => {
          setOpen(false);
          viewer.open(chip);
        }}
        onHandoff={() => {
          if (!liveReply || !livePerson) return;
          void conversation.handoffToPeople(livePerson.body, liveReply.id).then((ok) => {
            if (!ok) return;
            const who = staffFirstName ? personFirstName(staffFirstName) : "your team";
            setToast(`Sent to ${who} in your messages.`);
            setTrackingMessageId(null);
            setActiveSendRequestId(null);
            setOpen(false);
            setQuery("");
          });
        }}
        onNewQuestion={() => {
          setHistory(null);
          setHistoryNote(null);
          setTrackingMessageId(null);
          setActiveSendRequestId(null);
          setQuery("");
          document.getElementById("omni")?.focus();
        }}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}