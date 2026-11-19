import Link from "next/link";

import { WORKSPACE_PRIMARY } from "@/components/button-classes";

type HivePageHeadProps = {
  title: string;
  subtitle?: string;
  primaryAction?: { label: string; href: string; testId?: string };
};

/** Compact workspace page title (D18); hive identity lives in the sidebar and breadcrumb. */
export function HivePageHead({ title, subtitle, primaryAction }: HivePageHeadProps) {
  return (
    <header className="mb-4 flex flex-col gap-2 min-[600px]:flex-row min-[600px]:items-start min-[600px]:justify-between" data-testid="hive-page-head">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-brand text-[28px] font-semibold leading-tight text-ink">{title}</h1>
        {subtitle ? <p className="m-0 text-small text-graphite">{subtitle}</p> : null}
      </div>
      {primaryAction ? (
        <Link href={primaryAction.href} className={WORKSPACE_PRIMARY} data-testid={primaryAction.testId}>
          {primaryAction.label}
        </Link>
      ) : null}
    </header>
  );
}