import type { ReactNode } from "react";

export function MetaLine({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-meta text-ink-3" data-testid="meta-line">
      {children}
    </p>
  );
}

export function MetaDot() {
  return (
    <span aria-hidden className="text-ink-3">
      ·
    </span>
  );
}