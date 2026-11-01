"use client";

import {
  HIVE_DESCRIPTION_MAX_LENGTH,
  HIVE_NAME_MAX_LENGTH,
  INTENT_TEXT_MAX_LENGTH,
} from "@hiveforyou/contracts";
import { useEffect, useId, useRef, useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/button-classes";

import { AddFilesButton, SelectedFileList } from "./SourceFilePicker";
import { MAX_FILES_PER_BATCH, type SelectedSourceFile } from "./source-file-upload";

export type CreateHiveModalProps = {
  open: boolean;
  hiveName: string;
  hiveDescription: string;
  intentText: string;
  files: SelectedSourceFile[];
  nameError?: string | null;
  descriptionError?: string | null;
  intentError?: string | null;
  filesError?: string | null;
  submitError?: string | null;
  submitBusy?: boolean;
  /** The Hive exists; only the intent and documents remain to be saved. */
  hiveCreated?: boolean;
  onHiveNameChange: (value: string) => void;
  onHiveDescriptionChange: (value: string) => void;
  onIntentTextChange: (value: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (key: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

const FIELD_LABEL_CLASS = "flex flex-col gap-1.5 text-[13px] font-semibold text-ink-muted";

const FIELD_CLASS =
  "w-full rounded-button border bg-paper px-3.5 text-[16px] font-normal text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-cell-blue disabled:bg-mist disabled:text-ink-muted";

function fieldClass(invalid: boolean): string {
  return `${FIELD_CLASS} ${invalid ? "border-coral-deep ring-2 ring-coral-wash" : "border-line"}`;
}

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
  hiveName,
  hiveDescription,
  intentText,
  files,
  nameError = null,
  descriptionError = null,
  intentError = null,
  filesError = null,
  submitError = null,
  submitBusy = false,
  hiveCreated = false,
  onHiveNameChange,
  onHiveDescriptionChange,
  onIntentTextChange,
  onAddFiles,
  onRemoveFile,
  onCancel,
  onSubmit,
}: CreateHiveModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const intentId = useId();
  const nameErrorId = useId();
  const descriptionErrorId = useId();
  const intentErrorId = useId();
  const filesHelpId = useId();
  const filesErrorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const intentInputRef = useRef<HTMLTextAreaElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const canAddFiles = !submitBusy && files.length < MAX_FILES_PER_BATCH;

  useEffect(() => {
    if (!open) {
      return;
    }
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const intentInput = intentInputRef.current;
      if (intentInput && intentInput.value.trim().length === 0) {
        intentInput.focus();
      } else {
        nameInputRef.current?.focus();
      }
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
        onClick={submitBusy ? undefined : onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 flex max-h-[calc(100dvh-16px)] w-full max-w-[760px] flex-col overflow-hidden rounded-t-card border border-line bg-paper shadow-[0_24px_80px_rgba(0,0,0,0.2)] sm:max-h-[min(92dvh,920px)] sm:rounded-card"
      >
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-[clamp(20px,4vw,32px)] pb-6 pt-[clamp(24px,4vw,32px)]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="m-0 font-brand text-[clamp(26px,4vw,30px)] font-semibold leading-tight text-ink"
                >
                  New Hive
                </h2>
                <p
                  id={descriptionId}
                  className="mb-0 mt-2 text-[15px] leading-[1.55] text-ink-muted"
                >
                  Describe what you want done, in your own words, then add the
                  documents you have. Each Hive is private to your account.
                </p>
              </div>
              <button
                type="button"
                disabled={submitBusy}
                aria-label="Close"
                className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-button border-0 bg-transparent text-ink-subtle transition-colors hover:bg-mist hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                onClick={onCancel}
              >
                <CloseIcon />
              </button>
            </div>

            {submitError ? (
              <p
                role="alert"
                className="m-0 rounded-button bg-coral-wash px-3.5 py-2.5 text-[14px] text-coral-deep"
              >
                {submitError}
              </p>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <div
                className={`hive-composer box-border flex flex-col gap-2.5 rounded-card border-2 bg-paper pb-3 pl-5 pr-4 pt-4 ${
                  intentError ? "border-coral-deep" : "border-line"
                }`}
              >
                <label htmlFor={intentId} className="sr-only">
                  Describe what you want done
                </label>
                <textarea
                  ref={intentInputRef}
                  id={intentId}
                  required
                  value={intentText}
                  maxLength={INTENT_TEXT_MAX_LENGTH}
                  rows={3}
                  placeholder="I need to understand five years of bank statements for my mother’s Medicaid application."
                  aria-invalid={intentError ? true : undefined}
                  aria-describedby={intentError ? intentErrorId : undefined}
                  className="w-full resize-none border-0 bg-transparent p-0 text-[17px] leading-[1.55] text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-0 focus-visible:outline-none"
                  onChange={(event) => onIntentTextChange(event.target.value)}
                />
                <div className="flex justify-end">
                  <span className="text-[12.5px] text-ink-subtle" aria-hidden>
                    {intentText.length} / {INTENT_TEXT_MAX_LENGTH}
                  </span>
                </div>
              </div>
              {intentError ? (
                <p id={intentErrorId} className="m-0 text-[14px] text-coral-deep" role="alert">
                  {intentError}
                </p>
              ) : null}
            </div>

            <section
              aria-label="Hive details"
              className="overflow-hidden rounded-card border border-line"
            >
              <div className="bg-mist px-[clamp(16px,3vw,24px)] py-4 text-[13px] text-ink-muted">
                Name this Hive and add the documents you have.
              </div>
              <div className="flex flex-col gap-[18px] p-[clamp(16px,3vw,24px)]">
                <div className="flex flex-col gap-1.5">
                  <label className={FIELD_LABEL_CLASS}>
                    Name
                    <input
                      ref={nameInputRef}
                      type="text"
                      required
                      value={hiveName}
                      disabled={hiveCreated}
                      maxLength={HIVE_NAME_MAX_LENGTH}
                      placeholder="e.g. Mom’s Medicaid application"
                      aria-invalid={nameError ? true : undefined}
                      aria-describedby={nameError ? nameErrorId : undefined}
                      className={`h-11 ${fieldClass(Boolean(nameError))}`}
                      onChange={(event) => onHiveNameChange(event.target.value)}
                    />
                  </label>
                  {nameError ? (
                    <p id={nameErrorId} className="m-0 text-[14px] text-coral-deep" role="alert">
                      {nameError}
                    </p>
                  ) : (
                    <span className="text-[12.5px] text-ink-subtle">
                      Up to {HIVE_NAME_MAX_LENGTH} characters.
                    </span>
                  )}
                </div>

                <fieldset
                  className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
                  aria-describedby={filesError ? `${filesHelpId} ${filesErrorId}` : filesHelpId}
                >
                  <legend className="mb-1.5 p-0 text-[13px] font-semibold text-ink-muted">
                    Documents
                  </legend>
                  <div
                    className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border-[1.5px] border-dashed p-[clamp(16px,3vw,20px)] transition-colors ${
                      dragActive
                        ? "border-cell-blue bg-cell-blue-wash"
                        : filesError
                          ? "border-coral-deep bg-paper"
                          : "border-line-strong bg-paper"
                    }`}
                    onDragOver={(event) => {
                      if (!canAddFiles) {
                        return;
                      }
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragActive(false);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      if (!canAddFiles) {
                        return;
                      }
                      const dropped = Array.from(event.dataTransfer.files);
                      if (dropped.length > 0) {
                        onAddFiles(dropped);
                      }
                    }}
                  >
                    <AddFilesButton
                      showLabel
                      label="Add files"
                      disabled={!canAddFiles}
                      onAdd={onAddFiles}
                    />
                    <div className="flex min-w-0 flex-1 basis-[220px] flex-col gap-0.5">
                      <span className="text-[15px] font-medium text-ink">
                        Old, partial or out of order is fine.
                      </span>
                      <span id={filesHelpId} className="text-[13px] text-ink-subtle">
                        At least one PDF, PNG, JPG or DOCX, up to 25 MB each. Drop files
                        here or select Add files.
                      </span>
                    </div>
                  </div>
                  <SelectedFileList files={files} onRemove={onRemoveFile} busy={submitBusy} />
                  {filesError ? (
                    <p id={filesErrorId} className="m-0 text-[14px] text-coral-deep" role="alert">
                      {filesError}
                    </p>
                  ) : null}
                </fieldset>

                <div className="flex flex-col gap-1.5">
                  <label className={FIELD_LABEL_CLASS}>
                    <span>
                      Description <span className="font-normal">(optional)</span>
                    </span>
                    <textarea
                      value={hiveDescription}
                      disabled={hiveCreated}
                      maxLength={HIVE_DESCRIPTION_MAX_LENGTH}
                      rows={2}
                      placeholder="What this Hive is for"
                      aria-invalid={descriptionError ? true : undefined}
                      aria-describedby={descriptionError ? descriptionErrorId : undefined}
                      className={`resize-y py-2.5 leading-[1.5] ${fieldClass(Boolean(descriptionError))}`}
                      onChange={(event) => onHiveDescriptionChange(event.target.value)}
                    />
                  </label>
                  {descriptionError ? (
                    <p
                      id={descriptionErrorId}
                      className="m-0 text-[14px] text-coral-deep"
                      role="alert"
                    >
                      {descriptionError}
                    </p>
                  ) : (
                    <span className="text-[12.5px] text-ink-subtle">
                      Up to {HIVE_DESCRIPTION_MAX_LENGTH} characters.
                    </span>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line bg-paper px-[clamp(20px,4vw,32px)] py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={submitBusy}
              className={SECONDARY_BUTTON_CLASS}
              onClick={onCancel}
            >
              {hiveCreated ? "Open Hive" : "Cancel"}
            </button>
            <button type="submit" disabled={submitBusy} className={PRIMARY_BUTTON_CLASS}>
              {submitBusy
                ? "Uploading…"
                : hiveCreated
                  ? "Try again"
                  : "Create Hive and add documents"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
