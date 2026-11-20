import Link from "next/link";

import { WORKSPACE_PRIMARY } from "@/components/button-classes";
import { NEW_CLIENT_HIVE_PATH } from "@/lib/hive-routes";

export function ClientsHomeFirstVisit({ firstName }: { firstName: string | null }) {
  const greeting = firstName ? `Welcome to HiveForYou, ${firstName}` : "Welcome to HiveForYou";

  return (
    <div
      className="flex flex-col gap-4 border-b border-line px-[18px] py-[22px]"
      data-testid="clients-home-first-visit"
    >
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold text-ink">{greeting}</span>
        <span className="text-sm leading-normal text-graphite">
          Each client gets a hive: you invite them, they send documents from their phone, and HiveForYou reads every
          page and tells you what’s missing.
        </span>
      </div>
      <section className="flex max-w-md flex-col gap-2.5 rounded-card border border-line bg-canvas p-[18px]">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-control bg-cell-blue-wash text-cell-blue-deep"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </span>
        <span className="text-[15px] font-semibold text-ink">Add your first client</span>
        <span className="text-[13px] leading-normal text-graphite">
          Name, email and what you know. HiveForYou builds their checklist; you send it.
        </span>
        <Link href={NEW_CLIENT_HIVE_PATH} className={`${WORKSPACE_PRIMARY} self-start px-4 no-underline`}>
          Add a client
        </Link>
      </section>
    </div>
  );
}