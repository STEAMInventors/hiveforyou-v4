import Link from "next/link";
import type { ReactNode } from "react";

import { QUIET_LINK_CLASS, WORKSPACE_PRIMARY } from "@/components/button-classes";

const STEPS = [
  {
    label: "You set it up",
    text: "Pick the matter type. The starting checklist comes from it, and you can change it before you send.",
  },
  { label: "They upload", text: "Your client opens the link on their phone. No account, no password." },
  { label: "You review", text: "The hive lists what came in, what to review and what is still missing." },
] as const;

export function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** A professional with no hives yet (DESIGN §3 "First visit"): one next step, then what happens after it. */
export function HivesFirstVisit({
  newHiveHref,
  onStartOwn,
  notice,
}: {
  newHiveHref: string;
  onStartOwn: () => void;
  /** Rendered between the sentence and the actions (for example a load error). */
  notice?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pb-24 pt-12 min-[760px]:px-6 min-[760px]:pt-[72px]" data-testid="hives-first-visit">
      <h1 className="m-0 font-brand text-title-sm font-semibold text-ink min-[760px]:text-title">Your hives</h1>
      <p className="m-0 mt-3 font-brand text-[20px] font-medium leading-[1.35] tracking-[-0.02em] text-ink min-[760px]:text-[22px]">
        Start with one client.{" "}
        <em className="font-medium not-italic text-ink-3">
          Add their name and email, and HiveForYou sends them a list of what to upload.
        </em>
      </p>
      {notice}
      <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link href={newHiveHref} className={`${WORKSPACE_PRIMARY} px-[18px]`} data-testid="new-hive">
          <PlusIcon />
          New hive
        </Link>
        <button type="button" className={QUIET_LINK_CLASS} onClick={onStartOwn}>
          Or start one for your own documents
        </button>
      </div>
      <div className="mt-14 border-t border-ink">
        {STEPS.map((step) => (
          <div
            key={step.label}
            className="grid gap-x-6 gap-y-1 border-b border-line py-4 text-[14.5px] min-[760px]:grid-cols-[130px_minmax(0,1fr)]"
          >
            <b className="font-semibold text-ink">{step.label}</b>
            <p className="m-0 text-ink-2">{step.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
