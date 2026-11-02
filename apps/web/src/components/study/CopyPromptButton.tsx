"use client";

import { useEffect, useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/button-classes";

type CopyState = "idle" | "copied" | "failed";

export function CopyPromptButton({ text }: { text: string }) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-ink-subtle" aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select the text instead" : ""}
      </span>
      <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => void copy()} data-testid="copy-prompt">
        Copy Prompt
      </button>
    </div>
  );
}
