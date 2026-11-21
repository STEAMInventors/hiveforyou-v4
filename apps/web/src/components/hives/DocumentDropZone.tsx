"use client";

import { SOURCE_FILE_ACCEPT } from "@hiveforyou/contracts";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import { UploadIcon } from "@/components/hives/SourceFilePicker";

type DocumentDropZoneProps = {
  onAdd: (files: File[]) => void;
  disabled?: boolean;
  quotaText: string;
};

export function DocumentDropZone({ onAdd, disabled = false, quotaText }: DocumentDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const quotaId = useId();
  const [dragOver, setDragOver] = useState(false);

  const openPicker = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={SOURCE_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        onChange={(event) => {
          const picked = event.target.files ? Array.from(event.target.files) : [];
          event.target.value = "";
          if (picked.length > 0) {
            onAdd(picked);
          }
        }}
      />
      <div
        data-testid="document-drop-zone"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-describedby={quotaId}
        className={`hive-drop-zone box-border w-full cursor-pointer bg-line p-0.5 outline-none ${
          dragOver ? "hive-drop-zone--active" : ""
        } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragOver={(event) => {
          if (disabled) {
            return;
          }
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragOver(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (disabled) {
            return;
          }
          const dropped = Array.from(event.dataTransfer.files);
          if (dropped.length > 0) {
            onAdd(dropped);
          }
        }}
      >
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-[18px] bg-paper px-5 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-mist text-ink">
            <UploadIcon />
          </span>
          <p className="m-0 text-[15px] font-medium text-ink">Drop documents here, or choose files</p>
        </div>
      </div>
      <p id={quotaId} className="m-0 text-[13px] text-ink-3">
        {quotaText}
      </p>
    </div>
  );
}