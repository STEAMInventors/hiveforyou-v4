"use client";

import { INTENT_AUDIENCE_MAX_LENGTH, INTENT_TEXT_MAX_LENGTH } from "@hiveforyou/contracts";
import { useId, useState } from "react";

import type { CreateHiveFailure } from "@/components/hives/create-hive-flow";
import { AddFilesButton, SelectedFileChips } from "@/components/hives/SourceFilePicker";
import {
  MAX_FILES_PER_BATCH,
  type SelectedSourceFile,
} from "@/components/hives/source-file-upload";

const COUNTER_THRESHOLD = INTENT_TEXT_MAX_LENGTH - 200;

export type HiveComposerProps = {
  intentText: string;
  /** Optional: who the result is for, in the owner's words. */
  audience?: string;
  files: SelectedSourceFile[];
  intentError?: string | null;
  filesError?: string | null;
  failure?: CreateHiveFailure | null;
  busy?: boolean;
  /** The intent is already saved with the Hive and can no longer change. */
  intentLocked?: boolean;
  onIntentTextChange: (value: string) => void;
  onAudienceChange?: (value: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (key: string) => void;
  onSubmit: () => void;
};

export function HiveComposer({
  intentText,
  audience = "",
  files,
  intentError = null,
  filesError = null,
  failure = null,
  busy = false,
  intentLocked = false,
  onIntentTextChange,
  onAudienceChange,
  onAddFiles,
  onRemoveFile,
  onSubmit,
}: HiveComposerProps) {
  const inputId = useId();
  const audienceId = useId();
  const hintId = useId();
  const intentErrorId = useId();
  const filesErrorId = useId();
  const [dragActive, setDragActive] = useState(false);
  const canAddFiles = !busy && files.length < MAX_FILES_PER_BATCH;
  const invalid = Boolean(intentError || filesError);

  const hint = intentLocked
    ? "What you need is saved with your Hive."
    : files.length === 0
      ? "Attach PDF, PNG, JPG or DOCX. Old, partial or out of order is fine."
      : "Old, partial or out of order is fine.";

  const describedBy = [hintId, intentError ? intentErrorId : null, filesError ? filesErrorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <form
      noValidate
      aria-label="Start a Hive"
      aria-busy={busy || undefined}
      className="flex w-full flex-col gap-2 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) {
          onSubmit();
        }
      }}
    >
      {failure ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-button bg-coral-wash px-3.5 py-2.5 text-[14px] text-coral-deep"
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

      <div
        className={`hive-composer box-border flex w-full flex-col gap-2.5 rounded-card border-2 bg-paper pb-3 pl-5 pr-4 pt-4 transition-colors ${
          dragActive
            ? "border-cell-blue bg-cell-blue-wash"
            : invalid
              ? "border-coral-deep"
              : "border-line"
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
          const dropped = Array.from(event.dataTransfer.files);
          if (canAddFiles && dropped.length > 0) {
            onAddFiles(dropped);
          }
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          What are you trying to get done?
        </label>
        <textarea
          id={inputId}
          rows={2}
          required
          readOnly={intentLocked}
          value={intentText}
          maxLength={INTENT_TEXT_MAX_LENGTH}
          aria-invalid={intentError ? true : undefined}
          aria-describedby={describedBy}
          className="w-full resize-none border-0 bg-transparent p-0 text-[18px] leading-[1.5] text-ink placeholder:text-ink-subtle read-only:text-ink-muted focus:outline-none focus:ring-0 focus-visible:outline-none"
          placeholder="Describe your situation, then add whatever documents you have…"
          onChange={(event) => onIntentTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {intentText.length > COUNTER_THRESHOLD ? (
          <span className="self-end text-[12.5px] text-ink-subtle" aria-live="polite">
            {intentText.length} / {INTENT_TEXT_MAX_LENGTH}
          </span>
        ) : null}

        {onAudienceChange ? (
          <div className="flex items-center gap-2 border-t border-line pt-2">
            <label htmlFor={audienceId} className="shrink-0 text-[13px] font-medium text-ink-muted">
              For
            </label>
            <input
              id={audienceId}
              type="text"
              readOnly={intentLocked}
              value={audience}
              maxLength={INTENT_AUDIENCE_MAX_LENGTH}
              aria-label="Who is this for? (optional)"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] text-ink placeholder:text-ink-subtle read-only:text-ink-muted focus:outline-none focus:ring-0 focus-visible:outline-none"
              placeholder="Who is this for? Optional, for example the vendor team or my accountant"
              onChange={(event) => onAudienceChange(event.target.value)}
            />
          </div>
        ) : null}

        <SelectedFileChips files={files} onRemove={onRemoveFile} busy={busy} />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 basis-[200px] items-center gap-1.5">
            <AddFilesButton
              label="Attach documents"
              disabled={!canAddFiles}
              describedBy={hintId}
              onAdd={onAddFiles}
            />
            <p id={hintId} className="m-0 text-[13px] text-ink-subtle">
              {hint}
            </p>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="ml-auto inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-button border-0 bg-cell-blue-deep px-4 text-[14px] font-medium text-paper transition-colors hover:bg-cell-blue-hover disabled:cursor-not-allowed disabled:opacity-45 max-sm:w-full max-sm:justify-center"
          >
            {busy ? "Creating Hive…" : "Create Hive"}
          </button>
        </div>
      </div>

      {intentError ? (
        <p id={intentErrorId} className="m-0 text-[14px] text-coral-deep" role="alert">
          {intentError}
        </p>
      ) : null}
      {filesError ? (
        <p id={filesErrorId} className="m-0 text-[14px] text-coral-deep" role="alert">
          {filesError}
        </p>
      ) : null}
    </form>
  );
}
