"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { AccountMenu, type AccountMenuDetails } from "@/components/account-menu";
import { HiveAppLogo } from "@/components/HiveWordmark";
import { hiveListBackLink } from "@/lib/hives/hive-list-back";
import { useClientsHomeSearch } from "@/lib/hives/clients-home-context";
import { HIVE_SECTION_LABELS, MY_HIVES_PATH, type HiveWorkspaceSection } from "@/lib/hive-routes";
import type { StartingView } from "@/lib/auth/profile";
import type { HiveKind } from "@hiveforyou/contracts";

export type HiveHeaderWorkspace = {
  hiveId: string;
  hiveName: string;
  hiveKind?: HiveKind;
  section?: HiveWorkspaceSection;
  startingView?: StartingView;
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

  const breadcrumb =
    inHive && workspace?.section && workspace.startingView && workspace.hiveKind
      ? hiveListBackLink(workspace.startingView, workspace.hiveKind)
      : null;

  return (
    <header
      className="sticky top-0 z-40 flex h-top-sm min-h-top-sm items-center border-b border-line bg-paper px-[clamp(16px,3vw,40px)] min-[600px]:h-top min-[600px]:min-h-top"
      data-testid="app-header"
    >
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-3 min-[900px]:flex-nowrap">
        <div
          className={`flex min-h-11 shrink-0 items-center min-[900px]:w-rail ${
            inHive ? "max-[899px]:w-auto" : ""
          }`}
          data-testid="header-logo-column"
        >
          <Link
            href={MY_HIVES_PATH}
            aria-label="HiveForYou, my hives"
            className={`inline-flex min-h-11 items-center rounded-control text-ink no-underline ${
              hideListLogo ? "invisible" : ""
            }`}
          >
            <HiveAppLogo display="lockup" size="header" />
          </Link>
        </div>

        {inHive && workspace?.section && breadcrumb ? (
          <nav
            aria-label="Breadcrumb"
            className="hidden min-w-0 flex-1 items-center text-meta text-ink-3 min-[900px]:flex"
            data-testid="workspace-breadcrumb"
          >
            <ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-1 p-0">
              <li className="shrink-0">
                <Link href={breadcrumb.href} className="text-blue-deep no-underline hover:underline">
                  {breadcrumb.label}
                </Link>
              </li>
              <li aria-hidden className="shrink-0">
                /
              </li>
              <li className="min-w-0 max-w-[min(28vw,320px)] truncate font-medium text-ink" title={workspace.hiveName}>
                {workspace.hiveName}
              </li>
              <li aria-hidden className="shrink-0">
                /
              </li>
              <li className="shrink-0 truncate">{HIVE_SECTION_LABELS[workspace.section]}</li>
            </ol>
          </nav>
        ) : null}

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

        <div className="order-2 hidden min-h-11 min-w-0 flex-1 min-[600px]:block" aria-hidden />

        <div className="order-2 ml-auto shrink-0 min-[600px]:order-3">
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