import type { ReactNode } from "react";

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
        <span className="text-item font-semibold text-ink">{title}</span>
        {hint ? <span className="ms-auto text-meta text-ink-3">{hint}</span> : null}
        <span
          aria-hidden
          className="text-ink-3 transition-transform group-open:rotate-90 max-[899px]:motion-reduce:transition-none"
        >
          ›
        </span>
      </summary>
      <div className="pb-6 pt-1">{children}</div>
    </details>
  );
}