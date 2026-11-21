"use client";

import { SECONDARY_BUTTON_CLASS } from "@/components/button-classes";

/** Closing "Start a hive": back to the hero, then into its input. */
export function FrontStartButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className={SECONDARY_BUTTON_CLASS}
      onClick={() => {
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
        document
          .querySelector<HTMLInputElement>('[data-front-start] input:not([type="file"])')
          ?.focus({ preventScroll: true });
      }}
    >
      {label}
    </button>
  );
}
