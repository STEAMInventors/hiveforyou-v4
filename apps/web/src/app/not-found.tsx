import Link from "next/link";

import { HiveAppLogo } from "@/components/HiveWordmark";
import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center gap-6 bg-paper px-4 py-12 text-ink">
      <HiveAppLogo linkHome display="lockup" size="landing" />
      <section className="w-full max-w-md rounded-card border border-line bg-paper p-8 text-center">
        <h1 className="m-0 font-brand text-[21px] font-medium text-ink">Page not found</h1>
        <p className="mb-0 mt-2 text-[15px] leading-[1.55] text-ink-muted">
          That address is not part of this application.
        </p>
        <Link href="/" className={`${PRIMARY_BUTTON_CLASS} mt-6`}>
          Back to home
        </Link>
      </section>
    </div>
  );
}
