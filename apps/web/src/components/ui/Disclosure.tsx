import type { ReactNode } from "react";

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function Disclosure({
  title,
  hint,
  children,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group border-b border-line" open={defaultOpen || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="text-[14.5px] font-semibold text-ink">{title}</span>
        {hint ? <span className="ms-auto text-meta text-ink-3">{hint}</span> : null}
        <Chevron />
      </summary>
      <div className="pb-6 pt-1">{children}</div>
    </details>
  );
}
