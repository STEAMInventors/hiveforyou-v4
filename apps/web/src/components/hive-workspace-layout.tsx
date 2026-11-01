"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { useHiveHeaderWorkspace } from "@/components/app-header";
import { MY_HIVES_PATH } from "@/lib/hive-routes";

import { HiveTabNav } from "./hive-tab-nav";

type HiveWorkspaceLayoutProps = {
  hiveId: string;
  hiveName: string;
  hiveDescription: string;
  activeTab: "documents" | "study" | "reports";
  documentCount?: number;
  children: ReactNode;
};

export function HiveWorkspaceLayout({
  hiveId,
  hiveName,
  hiveDescription,
  activeTab,
  documentCount,
  children,
}: HiveWorkspaceLayoutProps) {
  const headerCtx = useHiveHeaderWorkspace();
  const setWorkspace = headerCtx?.setWorkspace;
  const headerDisplaysBreadcrumb = headerCtx?.workspace?.hiveId === hiveId;

  useEffect(() => {
    if (!setWorkspace) {
      return;
    }
    setWorkspace({ hiveId, hiveName });
    return () => {
      setWorkspace(null);
    };
  }, [hiveId, hiveName, setWorkspace]);

  return (
    <div className="flex flex-1 flex-col bg-paper">
      <div className="sticky top-16 z-30 border-b border-line bg-paper px-[clamp(16px,3vw,32px)]">
        {!headerDisplaysBreadcrumb ? (
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 pt-2 text-[14px] text-ink-subtle"
          >
            <Link
              href={MY_HIVES_PATH}
              className="whitespace-nowrap text-[14px] text-ink-muted no-underline transition-colors hover:text-cell-blue-deep"
            >
              My Hives
            </Link>
            <span aria-hidden>/</span>
            <span
              aria-current="page"
              className="max-w-[260px] truncate font-medium text-ink"
            >
              {hiveName}
            </span>
          </nav>
        ) : null}
        <HiveTabNav
          hiveId={hiveId}
          active={activeTab}
          documentCount={documentCount}
        />
      </div>

      <div className="mx-auto flex w-full max-w-workspace flex-col gap-6 px-[clamp(16px,3vw,32px)] pb-16 pt-8">
        {activeTab !== "documents" ? (
          <div>
            <h1 className="m-0 break-words font-brand text-[30px] font-semibold text-ink">
              {activeTab === "study" ? "Study" : "Reports"}
            </h1>
            {hiveDescription ? (
              <p className="mb-0 mt-1.5 max-w-2xl text-[15px] leading-[1.55] text-ink-muted">
                {hiveDescription}
              </p>
            ) : null}
          </div>
        ) : null}

        {children}
      </div>
    </div>
  );
}
