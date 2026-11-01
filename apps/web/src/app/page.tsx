import Link from "next/link";

import { HiveAppLogo, HiveBrandMark } from "@/components/HiveWordmark";
import { LandingStart } from "@/components/LandingStart";
import {
  COMPACT_PRIMARY_BUTTON_CLASS,
  COMPACT_SECONDARY_BUTTON_CLASS,
} from "@/components/button-classes";
import { CREATE_HIVE_AFTER_SIGN_UP_PATH } from "@/lib/hive-routes";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function LandingPage() {
  const auth = await requireAuthenticatedUser();
  const signedIn = auth.ok;

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="flex items-center justify-between gap-4 border-b border-line px-[clamp(20px,4vw,48px)] py-5">
        <HiveAppLogo linkHome display="lockup" size="landing" />
        <nav aria-label="Account" className="flex items-center gap-2">
          {signedIn ? (
            <Link href="/hives" className={COMPACT_PRIMARY_BUTTON_CLASS}>
              My Hives
            </Link>
          ) : (
            <>
              <Link href="/login" className={COMPACT_SECONDARY_BUTTON_CLASS}>
                Sign in
              </Link>
              <Link
                href={CREATE_HIVE_AFTER_SIGN_UP_PATH}
                className={COMPACT_PRIMARY_BUTTON_CLASS}
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-hero flex-col items-center gap-5 px-[clamp(20px,4vw,48px)] pb-10 pt-[clamp(48px,9vw,112px)] text-center">
          <HiveBrandMark variant="hero" />
          <h1 className="m-0 font-brand text-[clamp(36px,6vw,60px)] font-semibold leading-[1.08] tracking-[-0.01em] text-ink [text-wrap:balance]">
            What are you trying to get done?
          </h1>
          <p className="m-0 max-w-[560px] text-[18px] leading-[1.55] text-ink-muted [text-wrap:pretty]">
            Give Hive the paperwork. Get the work done.
          </p>

          <div className="mt-3 w-full">
            <LandingStart signedIn={signedIn} />
          </div>
        </section>

        <section className="mx-auto w-full max-w-landing px-[clamp(20px,4vw,48px)] pb-16 pt-6">
          <div className="grid grid-cols-1 border-t border-line md:grid-cols-3">
            <div className="flex flex-col gap-2 py-7 md:pr-6">
              <div className="font-brand text-[21px] font-medium text-ink">
                Upload whatever you have
              </div>
              <div className="text-[15px] leading-[1.55] text-ink-muted">
                Statements, plans, letters, estimates. Duplicates and missing
                pages are fine; Hive tells you about them.
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-line py-7 md:border-l md:border-t-0 md:px-6">
              <div className="font-brand text-[21px] font-medium text-ink">
                Hive does the work
              </div>
              <div className="text-[15px] leading-[1.55] text-ink-muted">
                It checks coverage, matches records, calculates step by step and
                names what&apos;s missing.
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-line py-7 md:border-l md:border-t-0 md:pl-6">
              <div className="font-brand text-[21px] font-medium text-ink">
                You review, then receive
              </div>
              <div className="text-[15px] leading-[1.55] text-ink-muted">
                Every line in the finished work links to the page it came from.
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-[clamp(20px,4vw,48px)] py-8">
        <div className="flex flex-wrap items-center gap-4">
          <HiveAppLogo display="lockup" size="footer" />
          <span className="font-brand text-[17px] font-medium text-ink">
            The complicated, made simple.
          </span>
        </div>
        <span className="text-[12.5px] text-ink-subtle">
          Your uploaded files stay private to your account. Not legal, financial
          or medical advice.
        </span>
      </footer>
    </div>
  );
}
