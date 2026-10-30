"use client";

import { useId, useState } from "react";

const STARTER_SITUATIONS = [
  { title: "Meeting prep", fill: "Help me prepare for an upcoming meeting." },
  { title: "Understand spending", fill: "Help me understand where my money is going." },
  { title: "Organize paperwork", fill: "Help me organize a stack of paperwork." },
] as const;

type HiveComposerProps = {
  onSubmit: () => void;
  busy?: boolean;
};

function ArrowUpIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

export function HiveComposer({ onSubmit, busy = false }: HiveComposerProps) {
  const inputId = useId();
  const helpId = useId();
  const [intentText, setIntentText] = useState("");
  const canSubmit = intentText.trim().length > 0 && !busy;

  return (
    <section
      className="mx-auto flex w-full max-w-[720px] flex-col gap-4"
      aria-label="Start a Hive"
    >
      <form
        className="hive-composer box-border w-full rounded-[28px] border border-line bg-paper px-3.5 pb-3 pl-[22px] pt-3.5 shadow-[0_1px_2px_rgba(31,35,40,0.04),0_8px_28px_rgba(31,35,40,0.06)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSubmit();
          }
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Describe what you need
        </label>
        <textarea
          id={inputId}
          rows={3}
          aria-describedby={helpId}
          className="w-full resize-none border-0 bg-transparent pb-0 pl-0 pr-2 pt-1.5 text-[17px] leading-normal text-ink placeholder:text-ink-muted focus:outline-none focus:ring-0 focus-visible:outline-none"
          placeholder="Upload whatever you have — old, partial or out of order is fine. What do you need to understand?"
          value={intentText}
          onChange={(event) => setIntentText(event.target.value)}
        />
        <div className="mt-2 flex items-center justify-between gap-2.5">
          <p id={helpId} className="m-0 text-xs text-ink-muted">
            Next, you&apos;ll name a private Hive for this situation.
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label="Start a Hive"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 ${
              canSubmit
                ? "cursor-pointer bg-ink text-paper"
                : "cursor-not-allowed bg-mist text-ink-muted"
            }`}
          >
            <ArrowUpIcon />
          </button>
        </div>
      </form>

      <div className="flex flex-wrap justify-center gap-2">
        {STARTER_SITUATIONS.map((situation) => (
          <button
            key={situation.title}
            type="button"
            className="min-h-10 cursor-pointer rounded-full border border-line bg-paper px-4 py-2 text-sm text-ink-muted transition-colors hover:border-line-strong hover:bg-mist hover:text-ink"
            onClick={() => setIntentText(situation.fill)}
          >
            {situation.title}
          </button>
        ))}
      </div>
    </section>
  );
}
