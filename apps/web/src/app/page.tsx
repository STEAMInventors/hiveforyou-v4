import Link from "next/link";
import { redirect } from "next/navigation";

import { LandingStart } from "@/components/LandingStart";
import { HiveAppLogo } from "@/components/HiveWordmark";
import { PILL_PRIMARY_BUTTON_CLASS, QUIET_LINK_CLASS } from "@/components/button-classes";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function LandingPage() {
  const auth = await requireAuthenticatedUser();
  if (auth.ok) {
    redirect("/hives");
  }

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="flex items-center justify-end px-[clamp(16px,3vw,28px)] py-4">
        <nav aria-label="Account" className="flex items-center gap-4">
          <Link href="/sign-in" className={QUIET_LINK_CLASS}>
            Sign in
          </Link>
          <Link href="/sign-in?new=1" className={PILL_PRIMARY_BUTTON_CLASS}>
            Get started
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-[26px] px-5 pb-8 pt-[clamp(40px,10vh,112px)] text-center">
          <HiveAppLogo display="lockup" size="landingMain" />
          <p className="m-0 text-[21px] font-normal leading-[1.4] text-ink-2">
            What are you working on?
          </p>
          <div className="w-full">
            <LandingStart />
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-[1040px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-9 px-6 pb-14 pt-4">
          <div className="flex flex-col gap-1.5 text-left">
            <h2 className="m-0 font-brand text-[20px] font-semibold text-ink">Upload whatever you have</h2>
            <p className="m-0 text-[15px] leading-[1.55] text-ink-2">
              Letters, notices, statements, forms. Old, partial or out of order is fine.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 text-left">
            <h2 className="m-0 font-brand text-[20px] font-semibold text-ink">Every point opens its page</h2>
            <p className="m-0 text-[15px] leading-[1.55] text-ink-2">
              HiveForYou reads each page and ties every date, amount and finding to where it came from.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 text-left">
            <h2 className="m-0 font-brand text-[20px] font-semibold text-ink">See what is missing</h2>
            <p className="m-0 text-[15px] leading-[1.55] text-ink-2">
              A plain report, the places where documents disagree, and what the records don&apos;t include.
            </p>
          </div>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 bg-mist px-[clamp(16px,3vw,28px)] py-4 text-[14px] text-ink-2">
        <span className="font-brand font-medium text-ink-2">The complicated, made simple.</span>
        <span className="text-[12.5px] text-ink-3">
          Your uploaded files stay private to your account. Not legal, financial or medical advice.
        </span>
      </footer>
    </div>
  );
}