"use client";

import type { ReactNode, RefObject, TextareaHTMLAttributes } from "react";

import { Button } from "./Button";

export type ComposerProps = {
  textareaId: string;
  textareaLabel: string;
  hint?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  footer?: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  textareaProps: TextareaHTMLAttributes<HTMLTextAreaElement>;
};

export function Composer({
  textareaId,
  textareaLabel,
  hint,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  footer,
  textareaRef,
  textareaProps,
}: ComposerProps) {
  return (
    <div className="composer-shell sticky bottom-4 mt-2 rounded-surface border border-line-strong bg-paper shadow-composer focus-within:border-blue focus-within:shadow-[0_0_0_3px_rgba(59,124,246,0.15)]">
      <label htmlFor={textareaId} className="sr-only">
        {textareaLabel}
      </label>
      <textarea
        id={textareaId}
        ref={textareaRef}
        {...textareaProps}
        className={`block min-h-16 max-h-[180px] w-full resize-none border-0 bg-transparent px-4 pb-1.5 pt-3.5 text-body text-ink outline-none placeholder:text-ink-3 ${textareaProps.className ?? ""}`.trim()}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-2.5 pb-2.5 pl-4 pt-2">
        {hint ? <span className="max-w-[min(100%,520px)] text-label text-ink-3">{hint}</span> : <span />}
        <Button type="button" onClick={onPrimary} disabled={primaryDisabled} className="ms-auto">
          {primaryLabel}
        </Button>
      </div>
      {footer}
    </div>
  );
}