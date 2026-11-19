import Link from "next/link";

import { WORKSPACE_PRIMARY } from "@/components/button-classes";
import { PageHead } from "@/components/ui/PageHead";

import { HivePageBreadcrumb } from "./HivePageBreadcrumb";

type HivePageHeadProps = {
  title: string;
  subtitle?: string;
  primaryAction?: { label: string; href: string; testId?: string };
  breadcrumb?: boolean;
};

/** Compact workspace page title; hive identity lives in the sidebar and page breadcrumb. */
export function HivePageHead({ title, subtitle, primaryAction, breadcrumb = true }: HivePageHeadProps) {
  return (
    <div data-testid="hive-page-head">
      <PageHead
        breadcrumb={breadcrumb ? <HivePageBreadcrumb /> : undefined}
        title={title}
        description={subtitle}
        action={
          primaryAction ? (
            <Link href={primaryAction.href} className={WORKSPACE_PRIMARY} data-testid={primaryAction.testId}>
              {primaryAction.label}
            </Link>
          ) : null
        }
      />
    </div>
  );
}