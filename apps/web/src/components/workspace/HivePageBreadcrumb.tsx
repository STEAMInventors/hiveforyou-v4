"use client";

import Link from "next/link";

import { useHiveHeaderWorkspace } from "@/components/app-header";
import { MY_HIVES_PATH } from "@/lib/hive-routes";

export function HivePageBreadcrumb() {
  const workspace = useHiveHeaderWorkspace()?.workspace;
  if (!workspace) return null;
  return (
    <nav aria-label="Breadcrumb" className="text-meta text-ink-3" data-testid="hive-page-breadcrumb">
      <ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-1 p-0">
        <li>
          <Link href={MY_HIVES_PATH} className="font-normal text-blue-deep no-underline hover:underline">
            All hives
          </Link>
        </li>
        <li aria-hidden>/</li>
        <li className="min-w-0 truncate font-medium text-ink" title={workspace.hiveName}>
          {workspace.hiveName}
        </li>
      </ol>
    </nav>
  );
}