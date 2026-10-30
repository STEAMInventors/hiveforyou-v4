import Link from "next/link";

import { HiveAppLogo, HiveBrandMark } from "@/components/HiveWordmark";
import { LandingStart } from "@/components/LandingStart";
import { CREATE_HIVE_AFTER_SIGN_UP_PATH } from "@/lib/hive-routes";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function LandingPage() {
  const auth = await requireAuthenticatedUser();
  const signedIn = auth.ok;

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        <HiveAppLogo linkHome display="lockup" className="py-0.5" />
        <nav aria-label="Account" className="flex items-center gap-1">
          <Link
            href="#how"
            className="hidden rounded-md px-3 py-2.5 text-sm text-ink-muted no-underline transition-colors hover:text-ink sm:inline-flex"
          >
            How it works
          </Link>
          {signedIn ? (
            <Link
              href="/hives"
              className="rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-paper no-underline"
            >
              My Hives
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-2.5 text-sm font-medium text-ink no-underline hover:bg-mist"
              >
                Sign in
              </Link>
              <Link
                href={CREATE_HIVE_AFTER_SIGN_UP_PATH}
                className="rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-paper no-underline"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-5 pb-12 pt-6">
        <div className="flex w-full max-w-[720px] flex-col items-center gap-7">
          <div className="flex flex-col items-center gap-3.5">
            <HiveBrandMark variant="hero" />
            <h1 className="m-0 text-center font-brand text-[clamp(1.75rem,5vw,2.25rem)] font-semibold tracking-tight">
              What are you working on?
            </h1>
          </div>

          <LandingStart signedIn={signedIn} />

          <div
            id="how"
            className="flex flex-wrap items-center justify-center gap-2.5 text-center text-sm text-ink-muted"
          >
            <span>Every answer points to its source</span>
            <span
              className="rounded-md border border-honey/40 bg-honey-wash px-2 py-1 font-mono text-xs text-honey-deep"
              aria-label="Example source chip: receipt, page 2"
            >
              Receipt · p.2
            </span>
            <span>and says what&apos;s missing. Nothing invented.</span>
          </div>
        </div>
      </main>

      <footer className="flex items-center justify-center gap-2 px-5 pb-6 pt-4 text-center text-[13px] text-ink-muted">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        Your uploaded files stay private to your account. Not legal, financial or
        medical advice.
      </footer>
    </div>
  );
}
