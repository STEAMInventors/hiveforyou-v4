import Link from "next/link";
import { redirect } from "next/navigation";

import { FrontExample } from "@/components/FrontExample";
import { FrontStartButton } from "@/components/FrontStartButton";
import { HiveMarkGraphic } from "@/components/HiveMarkGraphic";
import { LandingStart } from "@/components/LandingStart";
import { SignedOutBar } from "@/components/SignedOutBar";
import { QUIET_LINK_CLASS } from "@/components/button-classes";
import { FRONT_EXAMPLE, FRONT_PAGE_COPY, coveredAreasParagraph } from "@/content/front-page";
import { loadPracticeAreaSetupOptions } from "@/server/firm/practice-area-options";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

const SECTION_TITLE = "m-0 font-brand text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink min-[760px]:text-[30px]";
const WRAP = "mx-auto w-full max-w-[1120px] px-4 min-[760px]:px-6";

export default async function LandingPage() {
  const auth = await requireAuthenticatedUser();
  if (auth.ok) {
    redirect("/hives");
  }

  const covers = coveredAreasParagraph(loadPracticeAreaSetupOptions().map((area) => area.label));

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <SignedOutBar>
        <Link href="/sign-in" className={QUIET_LINK_CLASS}>
          {FRONT_PAGE_COPY.signIn}
        </Link>
      </SignedOutBar>

      <main className="flex flex-1 flex-col">
        <section
          aria-labelledby="front-title"
          className="mx-auto flex w-full max-w-[720px] flex-col items-center px-4 pb-16 pt-12 text-center min-[760px]:px-6 min-[760px]:pb-[88px] min-[760px]:pt-[72px]"
        >
          <HiveMarkGraphic animate heightPx={64} />
          <h1
            id="front-title"
            className="m-0 mt-6 font-brand text-[clamp(34px,5.4vw,52px)] font-semibold leading-[1.08] tracking-[-0.03em] text-ink"
          >
            {FRONT_PAGE_COPY.heroTitle}
          </h1>
          <p className="m-0 mt-4 max-w-[560px] text-[17px] leading-[1.55] text-ink-2">{FRONT_PAGE_COPY.heroLede}</p>
          <LandingStart />
        </section>

        <section aria-labelledby="front-example-title" className="bg-mist py-[72px]">
          <div className={WRAP}>
            <h2 id="front-example-title" className={SECTION_TITLE}>
              {FRONT_PAGE_COPY.exampleTitle}
            </h2>
            <p className="m-0 mt-2 text-[15px] text-ink-2">{FRONT_PAGE_COPY.exampleSub}</p>
            <FrontExample example={FRONT_EXAMPLE} />
          </div>
        </section>

        <section aria-labelledby="front-how-title" className="pt-20">
          <div className={WRAP}>
            <h2 id="front-how-title" className={SECTION_TITLE}>
              {FRONT_PAGE_COPY.howTitle}
            </h2>
            <div className="mt-6 grid gap-x-10 gap-y-8 min-[760px]:grid-cols-3">
              {FRONT_PAGE_COPY.how.map((step) => (
                <div key={step.title} className="border-t border-ink pt-4">
                  <h3 className="m-0 font-brand text-[19px] font-semibold tracking-[-0.01em] text-ink">{step.title}</h3>
                  <p className="m-0 mt-2 text-[15px] leading-[1.55] text-ink-2">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="front-who-title" className="pt-20">
          <div className={WRAP}>
            <h2 id="front-who-title" className={SECTION_TITLE}>
              {FRONT_PAGE_COPY.whoTitle}
            </h2>
            <div className="mt-5 border-t border-ink">
              {FRONT_PAGE_COPY.who.map((row) => (
                <div
                  key={row.label}
                  className="grid gap-x-6 gap-y-1 border-b border-line py-4 text-[15px] min-[760px]:grid-cols-[200px_minmax(0,1fr)]"
                >
                  <b className="font-semibold text-ink">{row.label}</b>
                  <p className="m-0 text-ink-2">{row.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {covers ? (
          <section aria-labelledby="front-covers-title" className="pt-20">
            <div className={WRAP}>
              <h2 id="front-covers-title" className={SECTION_TITLE}>
                {FRONT_PAGE_COPY.coversTitle}
              </h2>
              <p className="m-0 mt-3 max-w-[640px] text-[16px] leading-[1.6] text-ink-2">{covers}</p>
            </div>
          </section>
        ) : null}

        <section className="pb-[72px] pt-24">
          <div className={WRAP}>
            <div className="flex flex-wrap items-center justify-between gap-6 border-t border-line pt-10">
              <div className="flex items-center gap-3.5 font-brand text-[26px] font-semibold tracking-[-0.02em] text-ink">
                <HiveMarkGraphic heightPx={40} />
                <span>{FRONT_PAGE_COPY.slogan}</span>
              </div>
              <FrontStartButton label={FRONT_PAGE_COPY.startAHive} />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${WRAP} flex flex-wrap justify-between gap-3 py-6 text-[13px] text-ink-3`}>
          <span>© {new Date().getFullYear()} HiveForYou</span>
          <span>{FRONT_PAGE_COPY.disclaimer}</span>
        </div>
      </footer>
    </div>
  );
}
