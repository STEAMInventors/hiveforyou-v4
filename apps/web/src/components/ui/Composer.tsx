"use client";

import type { ReactNode, RefObject, TextareaHTMLAttributes } from "react";

import { Button } from "./Button";
import { LockIcon } from "./LockIcon";
import { SendIcon } from "./SendIcon";

export type ComposerProps = {
  textareaId: string;
  textareaLabel: string;
  hint?: ReactNode;
  /** Draws the lock beside the hint. */
  lock?: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  /** Renders a 16px send arrow after the primary label. */
  primaryTrailIcon?: boolean;
  footer?: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  textareaProps: TextareaHTMLAttributes<HTMLTextAreaElement>;
};

export function Composer({
  textareaId,
  textareaLabel,
  hint,
  lock = false,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryTrailIcon = false,
  footer,
  textareaRef,
  textareaProps,
}: ComposerProps) {
  return (
    <div className="sticky bottom-4 mt-2 rounded-input border border-line-strong bg-paper shadow-rest transition-[border-color,box-shadow] focus-within:border-blue focus-within:shadow-focus">
      <label htmlFor={textareaId} className="sr-only">
        {textareaLabel}
      </label>
      <textarea
        id={textareaId}
        ref={textareaRef}
        {...textareaProps}
        className={`block max-h-40 min-h-[52px] w-full resize-none border-0 bg-transparent px-3.5 pb-1 pt-3 text-message text-ink outline-none focus:outline-none focus:ring-0 focus-visible:outline-none placeholder:text-ink-3 ${textareaProps.className ?? ""}`.trim()}
      />
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-2 pb-2 pl-3.5 pt-1.5">
        {hint ? (
          <span className="inline-flex max-w-[min(100%,520px)] items-center gap-1.5 text-[12px] text-ink-3">
            {lock ? <LockIcon /> : null}
            {hint}
          </span>
        ) : (
          <span />
        )}
        <Button type="button" onClick={onPrimary} disabled={primaryDisabled} className="ms-auto">
          {primaryLabel}
          {primaryTrailIcon ? <SendIcon /> : null}
        </Button>
      </div>
      {footer}
    </div>
  );
}
