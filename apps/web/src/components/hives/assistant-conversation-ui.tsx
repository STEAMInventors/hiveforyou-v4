"use client";

import {
  hiveMessageInitials,
  shouldTriggerHiveAssistant,
  type HiveMessage,
  type HiveMessageAuthorRole,
} from "@hiveforyou/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";

import { avatarClassFor } from "@/components/hives/hive-conversation-view";
export const ASSISTANT_TYPING_LONG_MS = 20_000;
export const ASSISTANT_TYPING_TIMEOUT_MS = 60_000;
export const ASSISTANT_REVEAL_MAX_MS = 1200;

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false),
    () => false,
  );
}

export function viewerAuthorRole(staffView: boolean, viewerIsClient: boolean): HiveMessageAuthorRole {
  if (viewerIsClient) return "client";
  return staffView ? "staff" : "owner";
}

export function messageWouldTriggerAssistant(input: {
  body: string;
  assistantAvailable: boolean;
  assistantRepliesOn: boolean;
  assistantName: string;
  authorRole: HiveMessageAuthorRole;
  hiveFirmId: string | null;
}): boolean {
  if (!input.assistantAvailable || !input.assistantRepliesOn) return false;
  return shouldTriggerHiveAssistant({
    hive: { contentClass: "synthetic", assistantRepliesOn: input.assistantRepliesOn, firmId: input.hiveFirmId },
    message: { body: input.body, authorKind: "person" },
    authorRole: input.authorRole,
    assistantName: input.assistantName,
    runsInLastHour: 0,
  }).trigger;
}

function TypingDots() {
  return (
    <span className="hive-assistant-typing-dots ms-0.5 inline-flex gap-0.5" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function AssistantTypingRow({
  assistantName,
  longWait,
}: {
  assistantName: string;
  longWait: boolean;
}) {
  const line = longWait
    ? `${assistantName} is still working on it…`
    : `${assistantName} is looking through the documents`;
  return (
    <div className={rowClass(false)} data-testid="hive-assistant-typing">
      <span
        aria-hidden="true"
        className={`grid h-[35px] w-[35px] flex-none place-items-center rounded-[11px] text-[12px] font-bold ${avatarClassFor("assistant")}`}
      >
        {hiveMessageInitials(assistantName)}
      </span>
      <p role="status" className="m-0 flex flex-wrap items-center text-[13px] text-quiet">
        {line}
        <TypingDots />
      </p>
    </div>
  );
}

function rowClass(mine: boolean): string {
  return `flex items-start gap-[11px] ${mine ? "flex-row-reverse self-end" : "self-start"} max-w-full max-[649px]:w-full`;
}

export function useAssistantTypingPhase(waiting: boolean, startedAt: number | null): boolean {
  const [longWait, setLongWait] = useState(false);
  const [fallbackStart, setFallbackStart] = useState<number | null>(null);
  useEffect(() => {
    if (waiting) setFallbackStart((value) => value ?? Date.now());
    else setFallbackStart(null);
  }, [waiting]);
  const effectiveStart = startedAt ?? fallbackStart;
  useEffect(() => {
    if (!waiting || effectiveStart === null) {
      setLongWait(false);
      return;
    }
    const elapsed = Date.now() - effectiveStart;
    const remaining = Math.max(0, ASSISTANT_TYPING_LONG_MS - elapsed);
    const timer = window.setTimeout(() => setLongWait(true), remaining);
    return () => window.clearTimeout(timer);
  }, [effectiveStart, waiting]);
  return longWait;
}

export function useAssistantMessageReveal(
  message: HiveMessage,
  enabled: boolean,
): { displayBody: string; revealComplete: boolean } {
  const reducedMotion = usePrefersReducedMotion();
  const [wordCount, setWordCount] = useState(0);
  const words = message.body.split(/(\s+)/).filter((part) => part !== "");

  useEffect(() => {
    if (!enabled || reducedMotion) {
      setWordCount(words.length);
      return;
    }
    setWordCount(0);
    if (words.length === 0) return;
    const perWord = Math.max(16, Math.min(80, Math.floor(ASSISTANT_REVEAL_MAX_MS / words.length)));
    let index = 0;
    const tick = () => {
      index += 1;
      setWordCount(index);
      if (index < words.length) {
        timer = window.setTimeout(tick, perWord);
      }
    };
    let timer = window.setTimeout(tick, perWord);
    return () => window.clearTimeout(timer);
  }, [enabled, message.body, message.id, reducedMotion, words.length]);

  const revealComplete = wordCount >= words.length;
  const displayBody = revealComplete ? message.body : words.slice(0, wordCount).join("");
  return { displayBody, revealComplete };
}