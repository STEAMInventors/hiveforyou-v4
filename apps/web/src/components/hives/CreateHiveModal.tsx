"use client";

import { useEffect, useId, useRef } from "react";

import { HiveComposer, type HiveComposerProps } from "@/components/HiveComposer";

export type CreateHiveModalProps = {
  open: boolean;
  busy: boolean;
  /** The Hive exists; closing opens it instead of discarding the draft. */
  hiveCreated: boolean;
  onClose: () => void;
  composerProps: HiveComposerProps;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function CreateHiveModal({
  open,
  busy,
  hiveCreated,
  onClose,
  composerProps,
}: CreateHiveModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      returnFocusTo?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, busy]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:px-6 sm:py-8"
      data-testid="create-hive-modal"
    >
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-ink/40"
        aria-label="Close dialog"
        onClick={busy ? undefined : onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 flex max-h-[calc(100dvh-16px)] w-full max-w-[680px] flex-col gap-5 overflow-y-auto rounded-t-card border border-line bg-paper px-[clamp(20px,4vw,32px)] pb-[clamp(20px,4vw,28px)] pt-[clamp(24px,4vw,32px)] shadow-[0_24px_80px_rgba(0,0,0,0.2)] sm:max-h-[min(92dvh,760px)] sm:rounded-card"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="m-0 font-brand text-[clamp(26px,4vw,30px)] font-semibold leading-tight text-ink"
            >
              New Hive
            </h2>
            <p id={descriptionId} className="mb-0 mt-2 text-[15px] leading-[1.55] text-ink-muted">
              Describe what you&apos;re trying to get done and attach the documents you
              have. You&apos;ll confirm a Hive name before anything is saved.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            aria-label={hiveCreated ? "Close and open your Hive" : "Close"}
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-button border-0 bg-transparent text-ink-subtle transition-colors hover:bg-mist hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <HiveComposer {...composerProps} />
      </div>
    </div>
  );
}
