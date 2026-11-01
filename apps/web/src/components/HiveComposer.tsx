"use client";

import { useId, useRef, useState } from "react";

import { AddFilesButton, SelectedFileList } from "@/components/hives/SourceFilePicker";
import {
  MAX_FILES_PER_BATCH,
  hasUploadableFiles,
  toSelectedSourceFiles,
  type SelectedSourceFile,
} from "@/components/hives/source-file-upload";
import type { GuestDraft } from "@/lib/guest-draft";

const STARTER_SITUATIONS = [
  "Prepare for an IEP meeting",
  "Reconcile financial statements",
  "Review an insurance claim",
  "Organize an application package",
] as const;

type HiveComposerProps = {
  onSubmit: (draft: GuestDraft) => void;
  busy?: boolean;
};

function ArrowRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function HiveComposer({ onSubmit, busy = false }: HiveComposerProps) {
  const inputId = useId();
  const helpId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [intentText, setIntentText] = useState("");
  const [files, setFiles] = useState<SelectedSourceFile[]>([]);
  const [attempted, setAttempted] = useState(false);
  const hasIntent = intentText.trim().length > 0;
  const hasFiles = hasUploadableFiles(files);
  const ready = hasIntent && hasFiles;
  const showProblem = attempted && !ready;

  const helpText = !hasFiles
    ? files.length > 0
      ? "Remove the files that aren't supported — PDF, PNG, JPG or DOCX, up to 25 MB each."
      : showProblem
        ? "Add at least one document — PDF, PNG, JPG or DOCX, up to 25 MB each."
        : "Add your documents. Old, partial or out of order is fine."
    : !hasIntent
      ? "Now describe what you're trying to get done."
      : "Next, you'll name a private Hive for this situation.";

  const submit = () => {
    if (busy) {
      return;
    }
    if (!ready) {
      setAttempted(true);
      if (!hasIntent) {
        textareaRef.current?.focus();
      }
      return;
    }
    onSubmit({ intentText: intentText.trim(), files: files.map((item) => item.file) });
  };

  return (
    <section className="flex w-full flex-col gap-5" aria-label="Start a Hive">
      <form
        noValidate
        className="hive-composer box-border flex w-full flex-col gap-2.5 rounded-card border-2 border-line bg-paper pb-3 pl-5 pr-4 pt-4 text-left"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          What are you trying to get done?
        </label>
        <textarea
          ref={textareaRef}
          id={inputId}
          rows={2}
          required
          aria-describedby={helpId}
          aria-invalid={showProblem && !hasIntent ? true : undefined}
          className="w-full resize-none border-0 bg-transparent p-0 text-[18px] leading-[1.5] text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-0 focus-visible:outline-none"
          placeholder="Describe your situation, then add whatever documents you have…"
          value={intentText}
          onChange={(event) => setIntentText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {files.length > 0 ? (
          <SelectedFileList
            files={files}
            onRemove={(key) => setFiles((current) => current.filter((item) => item.key !== key))}
          />
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 basis-[220px] items-center gap-1.5">
            <AddFilesButton
              disabled={busy || files.length >= MAX_FILES_PER_BATCH}
              describedBy={helpId}
              onAdd={(picked) =>
                setFiles((current) =>
                  [...current, ...toSelectedSourceFiles(picked)].slice(0, MAX_FILES_PER_BATCH),
                )
              }
            />
            <p
              id={helpId}
              className={`m-0 text-[13px] ${showProblem ? "text-coral-deep" : "text-ink-subtle"}`}
              aria-live="polite"
            >
              {helpText}
            </p>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="ml-auto inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-button border-0 bg-cell-blue-deep px-4 text-[14px] font-medium text-paper transition-colors hover:bg-cell-blue-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Saving…" : "Show me how"}
            <ArrowRightIcon />
          </button>
        </div>
      </form>

      <div className="flex flex-wrap justify-center gap-2">
        {STARTER_SITUATIONS.map((situation) => {
          const active = intentText === situation;
          return (
            <button
              key={situation}
              type="button"
              aria-pressed={active}
              className={`h-9 cursor-pointer rounded-full border px-3.5 text-[14px] transition-colors hover:border-cell-blue ${
                active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"
              }`}
              onClick={() => {
                setIntentText(situation);
                textareaRef.current?.focus();
              }}
            >
              {situation}
            </button>
          );
        })}
      </div>
    </section>
  );
}
