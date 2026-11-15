"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { AccountMenu, type AccountMenuDetails } from "@/components/account-menu";
import { HiveWorkspaceAsk } from "@/components/hive-ask-input";
import { HiveAppLogo } from "@/components/HiveWordmark";
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

export type AppShellAccount = AccountMenuDetails;

export function AppShell({
  children,
  account,
}: {
  children: ReactNode;
  account?: AppShellAccount;
}) {
  const [workspace, setWorkspace] = useState<HiveHeaderWorkspace | null>(null);
  const contextValue = useMemo(() => ({ workspace, setWorkspace }), [workspace]);

  return (
    <HiveHeaderContext.Provider value={contextValue}>
      <div className="flex min-h-dvh flex-col bg-mist text-ink">
        <AppHeader
          workspace={workspace}
          account={{
            initials: account?.initials ?? null,
            displayName: account?.displayName ?? null,
            email: account?.email ?? null,
            startingView: account?.startingView ?? null,
          }}
        />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </HiveHeaderContext.Provider>
  );
}

function isHiveListPath(pathname: string): boolean {
  return pathname === MY_HIVES_PATH;
}

function isInHivePath(pathname: string, hiveId: string): boolean {
  return pathname.startsWith(`/hives/${hiveId}`);
}

export function AppHeader({
  workspace,
  account,
}: {
  workspace: HiveHeaderWorkspace | null;
  account: AccountMenuDetails;
}) {
  const pathname = usePathname() ?? "";
  const onHiveList = isHiveListPath(pathname);
  const inHive =
    workspace !== null && isInHivePath(pathname, workspace.hiveId);

  return (
    <header
      className="sticky top-0 z-40 border-b border-line bg-paper px-[clamp(16px,3vw,28px)] py-3"
      data-testid="app-header"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link
          href={MY_HIVES_PATH}
          aria-label="HiveForYou, my hives"
          className={`inline-flex min-h-11 shrink-0 items-center rounded-control text-ink no-underline ${
            onHiveList ? "invisible" : ""
          }`}
        >
          <HiveAppLogo display="lockup" size="header" />
        </Link>

        {inHive && workspace ? (
          <HiveWorkspaceAsk hiveId={workspace.hiveId} hiveName={workspace.hiveName} />
        ) : null}

        <div className="order-2 hidden min-h-11 min-w-0 flex-1 min-[600px]:block" aria-hidden />

        <div className="order-2 ml-auto min-[600px]:order-3">
          <AccountMenu {...account} />
        </div>
      </div>
    </header>
  );
}