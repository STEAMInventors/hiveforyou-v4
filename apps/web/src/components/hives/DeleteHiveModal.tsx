"use client";

import { useEffect, useId, useRef, useState } from "react";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import {
  HIVE_DELETE_CONFIRMATION_TEXT,
  isHiveDeleteConfirmed,
} from "@/lib/hives/delete-hive-confirmation";

type DeleteHiveModalProps = {
  hiveName: string;
  open: boolean;
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteHiveModal({
  hiveName,
  open,
  busy,
  errorMessage,
  onCancel,
  onConfirm,
}: DeleteHiveModalProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (!open) {
      setConfirmText("");
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) {
    return null;
  }

  const confirmed = isHiveDeleteConfirmed(confirmText);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close dialog"
        onClick={busy ? undefined : onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[61] w-full max-w-md rounded-card border border-line bg-paper p-6 shadow-[0_24px_48px_rgba(31,35,40,0.18)]"
      >
        <h2 id={titleId} className="m-0 font-brand text-[22px] font-semibold text-ink">
          Delete this Hive?
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          This permanently deletes <span className="font-semibold text-ink">{hiveName}</span>, all
          uploaded documents, and any data in this Hive. This cannot be undone.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          Type{" "}
          <span className="font-mono font-semibold text-ink">{HIVE_DELETE_CONFIRMATION_TEXT}</span>{" "}
          to confirm.
        </p>
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={confirmText}
          disabled={busy}
          onChange={(event) => setConfirmText(event.target.value)}
          className="mt-3 h-11 w-full rounded-control border border-line px-3 text-[15px] text-ink disabled:bg-mist"
        />
        {errorMessage ? (
          <p className="mt-3 text-sm text-coral-deep" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!confirmed || busy}
            onClick={onConfirm}
            className={`${PRIMARY_BUTTON_CLASS} !bg-coral-deep hover:!bg-coral-deep/90 disabled:!cursor-not-allowed disabled:!opacity-60`}
          >
            {busy ? "Deleting…" : "Delete Hive"}
          </button>
        </div>
      </div>
    </div>
  );
}
