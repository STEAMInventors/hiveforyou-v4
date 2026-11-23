"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { ConnectedAskChat } from "@/components/hives/AskChat";
import { EvidenceViewerOpenOverride, useOpenEvidenceByUrl } from "@/components/study/EvidenceViewer";
import type { ChipRef } from "@/components/study/SourceChip";
import { useHiveChat } from "@/lib/hive-chat-context";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The chat as a bottom sheet (full screen under 760px). Everywhere the side panel is not on screen.
 * Scrim, Escape and the close button close it; focus stays inside while it is open and goes back to the opener.
 */
export function ChatSheet() {
  const chat = useHiveChat();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [everOpened, setEverOpened] = useState(false);

  const open = Boolean(chat?.sheetOpen && chat.assistantOn);
  const wasOpenRef = useRef(false);
  const closeSheet = chat?.closeSheet;
  const openerRef = chat?.openerRef;

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const opener = openerRef?.current;
      openerRef!.current = null;
      if (opener && opener.isConnected) opener.focus();
    }
    wasOpenRef.current = open;
  }, [open, openerRef]);

  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  const openByUrl = useOpenEvidenceByUrl();
  const openChip = useCallback(
    (chip: ChipRef) => {
      closeSheet?.();
      openByUrl(chip);
    },
    [closeSheet, openByUrl],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // First in the Escape order: the sheet, then the box, then the evidence view.
      event.preventDefault();
      event.stopPropagation();
      closeSheet?.();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.getAttribute("aria-hidden") !== "true",
    );
    if (items.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialog.contains(current)) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!chat || !chat.assistantOn) return null;
  if (!open && !everOpened) return null;

  return (
    <div hidden={!open} data-testid="chat-sheet-root">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        data-testid="chat-sheet-scrim"
        className="fixed inset-0 z-[60] cursor-default border-0 bg-ink/35 p-0"
        onClick={() => chat.closeSheet()}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Ask ${chat.config.assistantName}`}
        tabIndex={-1}
        data-testid="chat-sheet"
        onKeyDown={onKeyDown}
        className="fixed inset-0 z-[61] flex h-dvh w-full flex-col overflow-hidden bg-paper outline-none motion-safe:animate-[hfy-sheet_220ms_cubic-bezier(.16,1,.3,1)] min-[760px]:inset-x-auto min-[760px]:bottom-0 min-[760px]:left-1/2 min-[760px]:top-auto min-[760px]:h-[min(88dvh,780px)] min-[760px]:w-[560px] min-[760px]:max-w-full min-[760px]:-translate-x-1/2 min-[760px]:rounded-t-sheet min-[760px]:shadow-pop"
      >
        <EvidenceViewerOpenOverride open={openChip}>
          <ConnectedAskChat variant="sheet" active={open} />
        </EvidenceViewerOpenOverride>
      </div>
    </div>
  );
}
