"use client";

import { HIVE_NAME_MAX_LENGTH } from "@hiveforyou/contracts";
import { useEffect, useId, useRef } from "react";

import type { CreateHiveFailure } from "@/components/hives/create-hive-flow";

export type NameHiveDialogProps = {
  open: boolean;
  hiveName: string;
  nameError: string | null;
  failure: CreateHiveFailure | null;
  busy: boolean;
  onHiveNameChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function NameHiveDialog({
  open,
  hiveName,
  nameError,
  failure,
  busy,
  onHiveNameChange,
  onConfirm,
  onCancel,
}: NameHiveDialogProps) {
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.select();
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
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:px-6 sm:py-8"
      data-testid="name-hive-dialog"
    >
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-ink/40"
        aria-label="Close naming dialog"
        onClick={busy ? undefined : onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-[420px] rounded-t-card border border-line bg-paper px-6 pb-6 pt-7 shadow-[0_24px_80px_rgba(0,0,0,0.2)] sm:rounded-card"
      >
        <h2
          id={titleId}
          className="m-0 font-brand text-[22px] font-semibold leading-tight text-ink"
        >
          Name your Hive
        </h2>
        <p className="mb-4 mt-2 text-[14px] leading-[1.5] text-ink-muted">
          You can change this anytime. We suggested a short label from what you wrote.
        </p>

        {failure ? (
          <div
            role="alert"
            className="mb-4 flex flex-col gap-1 rounded-button bg-coral-wash px-3.5 py-2.5 text-[14px] text-coral-deep"
          >
            <p className="m-0 font-semibold">{failure.headline}</p>
            <p className="m-0">{failure.message}</p>
            {failure.correlationId ? (
              <p className="m-0 font-mono text-[12px] opacity-80">
                Support reference: {failure.correlationId}
              </p>
            ) : null}
          </div>
        ) : null}

        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) {
              onConfirm();
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[14px] font-medium text-ink">
              Hive name
            </label>
            <input
              id={inputId}
              type="text"
              value={hiveName}
              maxLength={HIVE_NAME_MAX_LENGTH}
              disabled={busy}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? errorId : undefined}
              className="box-border w-full rounded-button border border-line bg-paper px-3.5 py-2.5 text-[16px] text-ink placeholder:text-ink-subtle focus:border-cell-blue focus:outline-none focus:ring-2 focus:ring-cell-blue/25 disabled:opacity-60"
              onChange={(event) => onHiveNameChange(event.target.value)}
            />
            {nameError ? (
              <p id={errorId} className="m-0 text-[13px] text-coral-deep">
                {nameError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              className="h-10 cursor-pointer rounded-button border border-line bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:bg-mist disabled:cursor-not-allowed disabled:opacity-45"
              onClick={onCancel}
            >
              Back
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-10 cursor-pointer rounded-button border-0 bg-cell-blue px-5 text-[14px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? "Creating…" : "Create Hive"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
