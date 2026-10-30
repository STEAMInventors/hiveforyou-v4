import Link from "next/link";
import type { ReactNode } from "react";

import { MY_HIVES_PATH } from "@/lib/hive-routes";

import { HiveTabNav } from "./hive-tab-nav";

type HiveWorkspaceLayoutProps = {
  hiveId: string;
  hiveName: string;
  hiveDescription: string;
  activeTab: "documents" | "study" | "reports";
  children: ReactNode;
};

export function HiveWorkspaceLayout({
  hiveId,
  hiveName,
  hiveDescription,
  activeTab,
  children,
}: HiveWorkspaceLayoutProps) {
  return (
    <div className="mx-auto w-full max-w-[1160px] px-4 py-8 md:px-8 md:py-10">
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-sm text-ink-muted">
          <li>
            <Link
              href={MY_HIVES_PATH}
              className="font-medium text-cell-blue-deep no-underline hover:underline"
            >
              My Hives
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="min-w-0 break-words">
            {hiveName}
          </li>
        </ol>
      </nav>

      <div className="mb-6">
        <h1 className="m-0 break-words font-brand text-[clamp(1.75rem,4vw,2.125rem)] font-semibold text-ink">
          {hiveName}
        </h1>
        {hiveDescription ? (
          <p className="mb-0 mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-muted">
            {hiveDescription}
          </p>
        ) : null}
      </div>

      <div className="mb-6 max-w-[720px]">
        <label htmlFor="hive-ask" className="mb-2 block text-sm font-semibold text-ink">
          Ask about these documents
        </label>
        <input
          id="hive-ask"
          type="text"
          disabled
          placeholder="Available after document upload"
          aria-describedby="hive-ask-help"
          className="h-12 w-full cursor-not-allowed rounded-[14px] border border-line bg-paper px-4 text-[15px] text-ink placeholder:text-ink-muted"
        />
        <p id="hive-ask-help" className="mb-0 mt-2 text-xs text-ink-muted">
          Questions open once documents are uploaded and a Study is accepted.
        </p>
      </div>

      <HiveTabNav hiveId={hiveId} active={activeTab} />
      {children}
    </div>
  );
}
