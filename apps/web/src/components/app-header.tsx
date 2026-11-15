"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { AccountMenu, type AccountMenuDetails } from "@/components/account-menu";
import { HiveWorkspaceAsk } from "@/components/hive-ask-input";
import { HiveAppLogo } from "@/components/HiveWordmark";
import { useClientsHomeSearch } from "@/lib/hives/clients-home-context";
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
      <div className="flex min-h-dvh flex-col bg-paper text-ink">
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
  const clientsHome = useClientsHomeSearch();
  const clientsListHeader =
    onHiveList && account.startingView === "clients" && clientsHome?.enabled;
  const hideListLogo = onHiveList && account.startingView !== "clients";

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
            hideListLogo ? "invisible" : ""
          }`}
        >
          <HiveAppLogo display="lockup" size="header" />
        </Link>

        {clientsListHeader && clientsHome ? (
          <div
            className="order-1 flex min-h-12 max-w-[680px] min-w-0 flex-1 basis-[360px] items-center gap-3 rounded-pill bg-mist px-[18px] min-[600px]:order-2"
            data-testid="header-find-client"
          >
            <MagnifierIcon />
            <input
              type="search"
              value={clientsHome.findQuery}
              onChange={(event) => clientsHome.setFindQuery(event.target.value)}
              placeholder="Find a client"
              aria-label="Find a client"
              className="min-h-11 w-full border-0 bg-transparent text-base text-ink outline-none"
            />
          </div>
        ) : null}

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

function MagnifierIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="shrink-0 text-graphite"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}