"use client";

import {
  HIVE_DESCRIPTION_MAX_LENGTH,
  HIVE_NAME_MAX_LENGTH,
} from "@hiveforyou/contracts";
import { useEffect, useId, useRef } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/button-classes";

export type CreateHiveModalProps = {
  open: boolean;
  hiveName: string;
  hiveDescription: string;
  nameError?: string | null;
  descriptionError?: string | null;
  submitError?: string | null;
  submitBusy?: boolean;
  onHiveNameChange: (value: string) => void;
  onHiveDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

const FIELD_CLASS =
  "rounded-[10px] border bg-paper px-3.5 text-[15px] font-normal text-ink outline-none focus:border-cell-blue focus:ring-2 focus:ring-cell-blue-wash";

function fieldClass(invalid: boolean): string {
  return `${FIELD_CLASS} ${invalid ? "border-coral-deep ring-2 ring-coral-wash" : "border-line-strong"}`;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function CreateHiveModal({
  open,
  hiveName,
  hiveDescription,
  nameError = null,
  descriptionError = null,
  submitError = null,
  submitBusy = false,
  onHiveNameChange,
  onHiveDescriptionChange,
  onCancel,
  onSubmit,
}: CreateHiveModalProps) {
  const titleId = useId();
  const nameErrorId = useId();
  const descriptionErrorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
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
      if (event.key === "Escape" && !submitBusy) {
        onCancel();
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
  }, [open, onCancel, submitBusy]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center px-4 py-6 sm:items-center sm:py-8"
      data-testid="create-hive-modal"
    >
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 bg-ink/40"
        aria-label="Close dialog"
        onClick={submitBusy ? undefined : onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-lg rounded-[18px] border border-line bg-paper p-6 shadow-lg sm:max-h-[90vh] sm:overflow-y-auto sm:p-7"
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <h2
              id={titleId}
              className="m-0 font-brand text-[1.875rem] font-semibold leading-tight tracking-[-0.02em] text-ink"
            >
              Create a Hive
            </h2>
            <p className="m-0 text-[15px] leading-relaxed text-ink-muted">
              A private space for one situation.
            </p>
          </div>

          {submitError ? (
            <p
              role="alert"
              className="mb-0 mt-4 rounded-[10px] border border-coral bg-coral-wash px-3.5 py-2.5 text-sm text-coral-deep"
            >
              {submitError}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
              Hive name
              <input
                ref={nameInputRef}
                type="text"
                value={hiveName}
                maxLength={HIVE_NAME_MAX_LENGTH}
                placeholder="e.g. Household bills 2026"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? nameErrorId : undefined}
                className={`min-h-[46px] ${fieldClass(Boolean(nameError))}`}
                onChange={(event) => onHiveNameChange(event.target.value)}
              />
              <span className="text-xs font-normal text-ink-muted">
                Up to {HIVE_NAME_MAX_LENGTH} characters.
              </span>
            </label>
            {nameError ? (
              <p id={nameErrorId} className="-mt-2 mb-0 text-sm text-coral-deep" role="alert">
                {nameError}
              </p>
            ) : null}

            <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
              <span>
                Description <span className="font-normal text-ink-muted">(optional)</span>
              </span>
              <textarea
                value={hiveDescription}
                maxLength={HIVE_DESCRIPTION_MAX_LENGTH}
                rows={3}
                placeholder="What this Hive is for"
                aria-invalid={descriptionError ? true : undefined}
                aria-describedby={descriptionError ? descriptionErrorId : undefined}
                className={`resize-y py-2.5 leading-relaxed ${fieldClass(Boolean(descriptionError))}`}
                onChange={(event) => onHiveDescriptionChange(event.target.value)}
              />
              <span className="text-xs font-normal text-ink-muted">
                Up to {HIVE_DESCRIPTION_MAX_LENGTH} characters.
              </span>
            </label>
            {descriptionError ? (
              <p
                id={descriptionErrorId}
                className="-mt-2 mb-0 text-sm text-coral-deep"
                role="alert"
              >
                {descriptionError}
              </p>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-2.5">
            <button
              type="button"
              disabled={submitBusy}
              className={SECONDARY_BUTTON_CLASS}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button type="submit" disabled={submitBusy} className={PRIMARY_BUTTON_CLASS}>
              {submitBusy ? "Creating…" : "Create Hive"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
