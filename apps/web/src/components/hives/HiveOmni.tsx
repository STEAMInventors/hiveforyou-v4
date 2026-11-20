"use client";

import { normalizeHiveMessagePage, type HiveMessage, type HiveMessagePage } from "@hiveforyou/contracts";
import { useEffect, useMemo, useState } from "react";

import { useEvidenceViewer } from "@/components/study/EvidenceViewer";
import type { ChipRef } from "@/components/study/SourceChip";
import { useAssistantTypingPhase } from "@/components/hives/assistant-conversation-ui";
import { useHiveConversation } from "@/components/hives/useHiveConversation";
import { OmniBox, type OmniAnswer } from "@/components/ui/OmniBox";
import { useOmniCatalog } from "@/components/ui/omni-catalog";
import type { OmniQuestion } from "@/components/ui/omni-catalog";
import { Toast } from "@/components/ui/Toast";
import { personFirstName } from "@/lib/hives/firm-board";
import { CORRELATION_HEADER_NAME } from "@/lib/hives-client";

const EMPTY_PAGE: HiveMessagePage = {
  messages: [],
  participantRoleLabels: [],
  participantCount: 0,
  viewerLastReadAt: null,
  nextCursor: null,
  pendingAssistant: false,
  assistantRepliesOn: true,
  assistantAvailable: true,
  assistantThreads: [],
};

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

function questionsFrom(messages: readonly HiveMessage[]): OmniQuestion[] {
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

export function HiveOmni({
  hiveId,
  assistantName,
  audience,
  staffFirstName,
  clientName,
  currentUserId,
  firmless,
  firmId,
}: {
  hiveId: string;
  assistantName: string;
  audience: "staff" | "client";
  staffFirstName: string | null;
  clientName: string | null;
  currentUserId: string | null;
  firmless: boolean;
  firmId: string | null;
}) {
  const catalog = useOmniCatalog();
  const viewer = useEvidenceViewer();
  const conversation = useHiveConversation({
    hiveId,
    initial: { ok: true, page: { ...EMPTY_PAGE, assistantName } },
    channel: "assistant",
    threadOwnerUserId: currentUserId,
    assistantName,
    assistantTrigger: {
      staffView: audience === "staff",
      viewerIsClient: audience === "client",
      hiveFirmId: firmId,
    },
  });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [liveQuestion, setLiveQuestion] = useState<string | null>(null);
  const [history, setHistory] = useState<OmniQuestion | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [clientQuestions, setClientQuestions] = useState<OmniQuestion[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [askedAt, setAskedAt] = useState<number | null>(null);

  const otherThreadId =
    conversation.assistantThreads.find(
      (thread) => currentUserId && thread.userId.toLowerCase() !== currentUserId.toLowerCase(),
    )?.userId ?? null;

  useEffect(() => {
    if (audience !== "staff" || !otherThreadId) return;
    let cancelled = false;
    const url = `/api/v1/hives/${encodeURIComponent(hiveId)}/messages?channel=assistant&threadOwner=${encodeURIComponent(otherThreadId)}`;
    void fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { [CORRELATION_HEADER_NAME]: crypto.randomUUID() },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return normalizeHiveMessagePage(await response.json());
      })
      .then((page) => {
        if (cancelled || !page) return;
        setClientQuestions(questionsFrom(page.messages));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [audience, hiveId, otherThreadId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("ask") === "1") {
      setOpen(true);
      document.getElementById("omni")?.focus();
    }
  }, []);

  const yourQuestions = catalog.yourQuestions.length > 0 ? catalog.yourQuestions : questionsFrom(conversation.messages);
  const mergedCatalog = useMemo(
    () => ({
      ...catalog,
      yourQuestions,
      clientQuestions: catalog.clientQuestions.length > 0 ? catalog.clientQuestions : clientQuestions,
      clientName: catalog.clientName ?? clientName,
    }),
    [catalog, clientName, clientQuestions, yourQuestions],
  );

  const livePerson = liveQuestion
    ? [...conversation.messages].reverse().find((message) => message.authorKind === "person" && message.body.trim() === liveQuestion.trim())
    : undefined;
  const liveReply = livePerson
    ? conversation.messages.find((message) => message.authorKind === "assistant" && message.triggerMessageId === livePerson.id)
    : undefined;
  const pending = Boolean(liveQuestion) && !history && !liveReply;
  const longWait = useAssistantTypingPhase(pending, askedAt);

  const answer: OmniAnswer | null = history
    ? {
        question: history.question,
        pending: false,
        longWait: false,
        text: history.answer,
        refs: history.refs,
        handoff: false,
        readonlyNote: historyNote,
      }
    : liveQuestion
      ? {
          question: liveQuestion,
          pending,
          longWait,
          text: liveReply?.body ?? null,
          refs: chipsOf(liveReply),
          handoff:
            audience === "client" &&
            !firmless &&
            (liveReply?.assistantRunStatus === "routed" || liveReply?.assistantRunStatus === "failed"),
          readonlyNote: null,
        }
      : null;

  const ask = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setHistory(null);
    setHistoryNote(null);
    setLiveQuestion(trimmed);
    setAskedAt(Date.now());
    setOpen(true);
    conversation.send(trimmed);
  };

  return (
    <>
      <OmniBox
        assistantName={assistantName}
        audience={audience}
        catalog={mergedCatalog}
        staffFirstName={staffFirstName ? personFirstName(staffFirstName) : null}
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          setHistory(null);
          setLiveQuestion(null);
        }}
        open={open}
        onOpenChange={setOpen}
        answer={answer}
        onAsk={ask}
        onOpenQuestion={(hit) => {
          setLiveQuestion(null);
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
          if (!liveReply || !liveQuestion) return;
          void conversation.handoffToPeople(liveQuestion, liveReply.id).then((ok) => {
            if (!ok) return;
            const who = staffFirstName ? personFirstName(staffFirstName) : "your team";
            setToast(`Sent to ${who} in your messages.`);
            setLiveQuestion(null);
            setOpen(false);
            setQuery("");
          });
        }}
        onNewQuestion={() => {
          setHistory(null);
          setHistoryNote(null);
          setLiveQuestion(null);
          setQuery("");
          document.getElementById("omni")?.focus();
        }}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
