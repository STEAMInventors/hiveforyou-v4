"use client";

import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-paper px-4 py-12 text-ink">
      <section
        role="alert"
        className="w-full max-w-md rounded-card border border-line bg-paper p-8 text-center"
      >
        <h1 className="m-0 font-brand text-[21px] font-medium text-ink">
          Something went wrong
        </h1>
        <p className="mb-0 mt-2 text-[15px] leading-[1.55] text-ink-muted">
          We could not load this page. Your documents and Study are not changed
          by this error.
        </p>
        <p className="mb-0 mt-2 text-[12.5px] text-ink-subtle">
          If this keeps happening, note the time and contact support. Technical
          details are not shown here.
        </p>
        <button
          type="button"
          className={`${PRIMARY_BUTTON_CLASS} mt-6`}
          onClick={() => reset()}
        >
          Try again
        </button>
      </section>
    </div>
  );
}
