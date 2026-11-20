import Link from "next/link";

import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";
import { MY_HIVES_PATH } from "@/lib/hive-routes";

export default function HiveNotFound() {
  return (
    <div className="mx-auto w-full max-w-workspace px-[clamp(16px,3vw,32px)] py-10">
      <section className="rounded-card border border-line bg-paper p-8 text-center">
        <h1 className="m-0 font-brand text-[21px] font-medium text-ink">Hive not found</h1>
        <p className="mx-auto mb-0 mt-2 max-w-md text-[15px] leading-[1.55] text-ink-muted">
          We could not find that Hive in your account. Unknown or unauthorized
          Hive identifiers are not shown.
        </p>
        <Link href={MY_HIVES_PATH} className={`${PRIMARY_BUTTON_CLASS} mt-6`}>
          Back to My Hives
        </Link>
      </section>
    </div>
  );
}
