"use client";

import { SOURCE_FILE_ACCEPT } from "@hiveforyou/contracts";
import { useRef } from "react";

import type { SelectedSourceFile, SourceFileState } from "./source-file-upload";

const STATE_LABELS: Record<SourceFileState, string> = {
  ready: "Ready",
  invalid: "Not supported",
  uploading: "Uploading…",
  checking: "Checking…",
  registered: "Added",
  rejected: "Not accepted",
  failed: "Didn't upload",
};

const STATE_CLASSES: Record<SourceFileState, string> = {
  ready: "bg-mist text-ink-muted",
  invalid: "bg-coral-wash text-coral-deep",
  uploading: "bg-cell-blue-wash text-cell-blue-deep",
  checking: "bg-cell-blue-wash text-cell-blue-deep",
  registered: "bg-leaf-wash text-leaf-deep",
  rejected: "bg-coral-wash text-coral-deep",
  failed: "bg-honey-wash text-honey-deep",
};

function PaperclipIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48" />
    </svg>
  );
}

function UploadIcon() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type AddFilesButtonProps = {
  onAdd: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
  showLabel?: boolean;
  describedBy?: string;
};

export function AddFilesButton({
  onAdd,
  disabled = false,
  label = "Add documents",
  showLabel = false,
  describedBy,
}: AddFilesButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={SOURCE_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const picked = event.target.files ? Array.from(event.target.files) : [];
          event.target.value = "";
          if (picked.length > 0) {
            onAdd(picked);
          }
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={showLabel ? undefined : label}
        aria-describedby={describedBy}
        className={
          showLabel
            ? "inline-flex h-10 cursor-pointer items-center gap-2 rounded-button border border-line bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:bg-mist disabled:cursor-not-allowed disabled:opacity-45"
            : "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-button border-0 bg-transparent text-ink-subtle transition-colors hover:bg-mist hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
        }
        onClick={() => inputRef.current?.click()}
      >
        {showLabel ? <UploadIcon /> : <PaperclipIcon />}
        {showLabel ? label : null}
      </button>
    </>
  );
}

type SelectedFileChipsProps = {
  files: SelectedSourceFile[];
  onRemove?: (key: string) => void;
  busy?: boolean;
};

const CHIP_PROBLEM_STATES: ReadonlySet<SourceFileState> = new Set(["invalid", "rejected", "failed"]);

export function SelectedFileChips({ files, onRemove, busy = false }: SelectedFileChipsProps) {
  if (files.length === 0) {
    return null;
  }
  const problems = files.filter((item) => CHIP_PROBLEM_STATES.has(item.state) && item.message);
  return (
    <div className="flex flex-col gap-1.5">
      <ul aria-label="Attached documents" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {files.map((item) => {
          const problem = CHIP_PROBLEM_STATES.has(item.state);
          const removable = Boolean(onRemove) && !busy && item.state !== "registered";
          return (
            <li
              key={item.key}
              className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border pl-3 text-[13px] ${
                removable ? "pr-1" : "pr-3"
              } ${problem ? "border-coral-deep bg-coral-wash text-coral-deep" : "border-line bg-mist text-ink"}`}
            >
              <span className="min-w-0 max-w-[220px] truncate font-medium" title={item.file.name}>
                {item.file.name}
              </span>
              <span className={`shrink-0 ${problem ? "" : "text-ink-subtle"}`} aria-live="polite">
                {item.state === "ready" ? formatSize(item.file.size) : STATE_LABELS[item.state]}
              </span>
              {removable ? (
                <button
                  type="button"
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-current hover:bg-paper"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => onRemove?.(item.key)}
                >
                  <span aria-hidden>×</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {problems.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] text-coral-deep">
          {problems.map((item) => (
            <li key={item.key}>
              <span className="font-medium">{item.file.name}</span>: {item.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type SelectedFileListProps = {
  files: SelectedSourceFile[];
  onRemove?: (key: string) => void;
  busy?: boolean;
  label?: string;
};

export function SelectedFileList({
  files,
  onRemove,
  busy = false,
  label = "Selected documents",
}: SelectedFileListProps) {
  if (files.length === 0) {
    return null;
  }
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {files.map((item) => (
        <li
          key={item.key}
          className="flex items-start gap-3 rounded-[12px] border border-line bg-paper px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm font-semibold text-ink" title={item.file.name}>
              {item.file.name}
            </p>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              {formatSize(item.file.size)}
              {item.message ? (
                <span
                  className={
                    item.state === "invalid" || item.state === "rejected"
                      ? " text-coral-deep"
                      : ""
                  }
                >
                  {" · "}
                  {item.message}
                </span>
              ) : null}
            </p>
          </div>
          <span
            className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium ${STATE_CLASSES[item.state]}`}
            aria-live="polite"
          >
            {STATE_LABELS[item.state]}
          </span>
          {onRemove && !busy && item.state !== "registered" ? (
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink-muted hover:bg-mist hover:text-ink"
              aria-label={`Remove ${item.file.name}`}
              onClick={() => onRemove(item.key)}
            >
              <span aria-hidden>×</span>
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
