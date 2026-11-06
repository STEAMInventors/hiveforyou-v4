"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { AccountMenu } from "@/components/account-menu";
import { HiveMark } from "@/components/study/HiveMark";
import { MY_HIVES_PATH } from "@/lib/hive-routes";

export type HiveHeaderWorkspace = {
  hiveId: string;
  hiveName: string;
};

type HiveHeaderContextValue = {
  workspace: HiveHeaderWorkspace | null;
  setWorkspace: (workspace: HiveHeaderWorkspace | null) => void;
};

const HiveHeaderContext = createContext<HiveHeaderContextValue | null>(null);

export function useHiveHeaderWorkspace() {
  return useContext(HiveHeaderContext);
}

export type AppShellAccount = {
  /** Up to two letters for the account button; null shows "Account". */
  initials: string | null;
};

export function AppShell({ children, account }: { children: ReactNode; account?: AppShellAccount }) {
  const [workspace, setWorkspace] = useState<HiveHeaderWorkspace | null>(null);
  const contextValue = useMemo(() => ({ workspace, setWorkspace }), [workspace]);

  return (
    <HiveHeaderContext.Provider value={contextValue}>
      <div className="flex min-h-dvh flex-col bg-mist text-ink">
        <AppHeader workspace={workspace} initials={account?.initials ?? null} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </HiveHeaderContext.Provider>
  );
}

const CRUMB_LINK_CLASS =
  "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap text-graphite no-underline hover:text-ink hover:underline underline-offset-2";

function currentCrumb(pathname: string, workspace: HiveHeaderWorkspace | null): string | null {
  if (workspace && pathname.startsWith(`/hives/${workspace.hiveId}`)) return workspace.hiveName;
  if (pathname.startsWith("/account/password")) return "Change password";
  return null;
}

export function AppHeader({ workspace, initials }: { workspace: HiveHeaderWorkspace | null; initials: string | null }) {
  const pathname = usePathname() ?? "";
  const current = currentCrumb(pathname, workspace);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper px-6 py-3" data-testid="app-header">
      <div className="flex items-center gap-3 sm:gap-5">
        <Link
          href={MY_HIVES_PATH}
          aria-label="HiveForYou, my hives"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control text-ink no-underline"
        >
          <HiveMark className="h-[26px] w-[24px] shrink-0" />
          <span aria-hidden className={`font-brand text-[20px] leading-none text-ink ${current ? "max-[479px]:hidden" : ""}`}>
            <span className="font-semibold">Hive</span>
            <span className="font-normal">ForYou</span>
          </span>
        </Link>

        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-[15px]">
            <li className="flex shrink-0 items-center">
              {current ? (
                <Link href={MY_HIVES_PATH} className={CRUMB_LINK_CLASS}>
                  My hives
                </Link>
              ) : (
                <span aria-current="page" className="whitespace-nowrap font-medium text-ink">
                  My hives
                </span>
              )}
            </li>
            {current ? (
              <li className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="text-quiet">
                  /
                </span>
                <span aria-current="page" className="truncate font-medium text-ink" title={current}>
                  {current}
                </span>
              </li>
            ) : null}
          </ol>
        </nav>

        <AccountMenu initials={initials} />
      </div>
    </header>
  );
}
