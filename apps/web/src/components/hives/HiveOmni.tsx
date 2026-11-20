"use client";

import { useEffect, useRef, useState } from "react";

import { useOpenEvidenceByUrl } from "@/components/study/EvidenceViewer";
import { OmniBox } from "@/components/ui/OmniBox";
import { useOmniCatalog } from "@/components/ui/omni-catalog";
import { useHiveChat } from "@/lib/hive-chat-context";

/**
 * The top box inside a hive: find only. Statements, open items and documents filter client-side.
 * The last row, "Ask <assistant>: <query>", hands the text to the chat (panel or sheet). It never calls a model.
 */
export function HiveOmni({
  assistantName,
  audience,
}: {
  assistantName: string;
  audience: "staff" | "client";
}) {
  const catalog = useOmniCatalog();
  const openChip = useOpenEvidenceByUrl();
  const chat = useHiveChat();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const askOn = Boolean(chat?.assistantOn);

  // Older email links arrive as ?ask=1: open the chat for them.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("ask") !== "1") return;
    chatRef.current?.openChat();
  }, []);

  const ask = (question: string) => {
    const text = question.trim();
    if (!text || !chat) return;
    // Let go of the input first: the sheet gives focus back to whatever had it, and the input would reopen the box.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setOpen(false);
    setQuery("");
    chat.openChat({ send: text });
  };

  return (
    <OmniBox
      assistantName={askOn ? assistantName : null}
      audience={audience}
      catalog={catalog}
      query={query}
      onQueryChange={setQuery}
      open={open}
      onOpenChange={setOpen}
      onAsk={ask}
      onOpenChip={(chip) => {
        setOpen(false);
        openChip(chip);
      }}
    />
  );
}
