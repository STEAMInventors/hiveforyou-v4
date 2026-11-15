"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { setDisplayNameAction } from "@/server/auth/auth-actions";
import type { SignInActionState } from "@/server/auth/auth-actions";

const initialState: SignInActionState = {};

export function DisplayNameDialog({
  open,
  initialName,
  onClose,
}: {
  open: boolean;
  initialName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(initialName);
  const [state, formAction, pending] = useActionState(setDisplayNameAction, initialState);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      submittedRef.current = false;
    }
  }, [open, initialName]);

  useEffect(() => {
    if (!pending && submittedRef.current && !state.error) {
      submittedRef.current = false;
      onClose();
      router.refresh();
    }
  }, [state.error, pending, onClose, router]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, pending, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:px-6 sm:py-8">
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-ink/40"
        aria-label="Close"
        onClick={pending ? undefined : onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby={titleId}
        className="relative z-10 flex w-full max-w-md flex-col gap-4 rounded-card border border-line bg-paper p-6 shadow-[0_12px_32px_rgba(31,35,40,0.14)]"
      >
        <h2 id={titleId} className="m-0 font-brand text-section font-semibold text-ink">
          Your first name
        </h2>
        <form
          action={formAction}
          className="m-0 flex flex-col gap-4"
          onSubmit={() => {
            submittedRef.current = true;
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium text-ink">
              First name
            </label>
            <input
              id={inputId}
              name="displayName"
              type="text"
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="min-h-11 rounded-control border border-line bg-paper px-3 text-[15px] text-ink"
              autoComplete="given-name"
            />
            {state.field === "displayName" && state.error ? (
              <p className="m-0 text-sm text-missing-fg" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}