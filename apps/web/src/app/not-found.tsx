import Link from "next/link";

import { HiveAppLogo } from "@/components/HiveWordmark";
import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center gap-6 bg-mist px-4 py-10">
      <HiveAppLogo linkHome display="lockup" />
      <section className="w-full max-w-md rounded-[18px] border border-line bg-paper p-8 text-center">
        <h1 className="m-0 font-brand text-xl font-semibold text-ink">Page not found</h1>
        <p className="mb-0 mt-2 text-sm text-ink-muted">
          That address is not part of this application.
        </p>
        <Link href="/" className={`${PRIMARY_BUTTON_CLASS} mt-6`}>
          Back to home
        </Link>
      </section>
    </div>
  );
}
