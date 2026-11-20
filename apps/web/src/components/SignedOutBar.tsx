import Link from "next/link";
import type { ReactNode } from "react";

import { HiveBrandMark } from "@/components/HiveWordmark";

/** Signed-out top bar (DESIGN §3 "Top bar"): mark + wordmark to the front page, an optional quiet action on the right. */
export function SignedOutBar({ children }: { children?: ReactNode }) {
  return (
    <header
      className="sticky top-0 z-40 flex h-[60px] items-center justify-between gap-4 border-b border-line bg-paper/90 px-4 backdrop-blur-[10px] min-[760px]:h-top min-[760px]:px-6"
      data-testid="signed-out-bar"
    >
      <Link
        href="/"
        aria-label="HiveForYou home"
        className="inline-flex min-h-10 items-center gap-2 text-ink no-underline"
      >
        <HiveBrandMark />
        <span className="font-brand text-[18px] tracking-[-0.035em]">
          <b className="font-semibold">Hive</b>
          <span className="font-normal">ForYou</span>
        </span>
      </Link>
      {children ? <nav aria-label="Account" className="flex items-center gap-4">{children}</nav> : null}
    </header>
  );
}
