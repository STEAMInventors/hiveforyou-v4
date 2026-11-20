"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { AccountMenu, type AccountMenuDetails } from "@/components/account-menu";
import { HiveBrandMark } from "@/components/HiveWordmark";
import { ChatSheet } from "@/components/hives/ChatSheet";
import { HiveOmni } from "@/components/hives/HiveOmni";
import { HivesFindBox } from "@/components/hives/HivesFindBox";
import { OmniCatalogProvider } from "@/components/ui/omni-catalog";
import { HiveChatProvider, type HiveChatConfig } from "@/lib/hive-chat-context";
import { buildHiveChatConfig } from "@/lib/build-hive-chat-config";

export { buildHiveChatConfig };
import { MY_HIVES_PATH, type HiveWorkspaceSection } from "@/lib/hive-routes";
import type { StartingView } from "@/lib/auth/profile";
import type { HiveKind } from "@hiveforyou/contracts";

export type HiveHeaderWorkspace = {
  hiveId: string;
  hiveName: string;
  hiveKind?: HiveKind;
  section?: HiveWorkspaceSection;
  startingView?: StartingView;
  staffView?: boolean;
  assistantName?: string;
  clientViewer?: boolean;
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

function isClientViewer(workspace: HiveHeaderWorkspace): boolean {
  return workspace.clientViewer === true;
}

export function AppShell({
  children,
  account,
  chatConfig = null,
}: {
  children: ReactNode;
  account?: AppShellAccount;
  /** When set (hive workspace), must match server render and first client render. */
  chatConfig?: HiveChatConfig | null;
}) {
  const [workspace, setWorkspace] = useState<HiveHeaderWorkspace | null>(null);
  const contextValue = useMemo(() => ({ workspace, setWorkspace }), [workspace]);

  return (
    <HiveHeaderContext.Provider value={contextValue}>
      <OmniCatalogProvider>
        <HiveChatProvider config={chatConfig}>
          <div className="flex min-h-dvh flex-col bg-paper text-ink">
            <AppHeader
              workspace={workspace}
              account={{
                initials: account?.initials ?? null,
                displayName: account?.displayName ?? null,
                email: account?.email ?? null,
                startingView: account?.startingView ?? null,
                firmName: account?.firmName ?? null,
              }}
            />
            <main className="flex flex-1 flex-col">{children}</main>
            <ChatSheet />
          </div>
        </HiveChatProvider>
      </OmniCatalogProvider>
    </HiveHeaderContext.Provider>
  );
}

const GALLERY_HIVES_LIST = /^\/dev\/gallery\/hives-/;

function isHiveListPath(pathname: string): boolean {
  return pathname === MY_HIVES_PATH || GALLERY_HIVES_LIST.test(pathname);
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
    workspace !== null &&
    (workspace.section != null || isInHivePath(pathname, workspace.hiveId));
  const staff = workspace?.staffView ?? workspace?.startingView === "clients";
  const viewerIsClient = workspace ? isClientViewer(workspace) : false;

  return (
    <header
      className="sticky top-0 z-40 grid h-[60px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line bg-paper/90 px-3 backdrop-blur-[10px] min-[760px]:h-top min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,600px)_minmax(0,1fr)] min-[760px]:gap-4 min-[760px]:px-5"
      data-testid="app-header"
    >
      <div className="flex min-w-0 items-center gap-3.5" data-testid="header-logo-column">
        <Link
          href={MY_HIVES_PATH}
          aria-label="HiveForYou, my hives"
          className="inline-flex min-h-10 items-center gap-2 text-ink no-underline"
        >
          <HiveBrandMark />
          <span className="font-brand text-[18px] tracking-[-0.035em] max-[759px]:hidden">
            <b className="font-semibold">Hive</b>
            <span className="font-normal">ForYou</span>
          </span>
        </Link>
        {onHiveList && account.firmName ? (
          <span
            className="hidden min-w-0 items-center gap-1.5 text-[13.5px] text-ink-3 min-[760px]:flex"
            data-testid="header-firm"
          >
            <span aria-hidden className="text-line-strong">/</span>
            <span className="truncate">{account.firmName}</span>
          </span>
        ) : null}
        {inHive && staff ? (
          <nav
            aria-label="Breadcrumb"
            data-testid="workspace-breadcrumb"
            className="hidden min-w-0 items-center gap-1.5 text-[13.5px] text-ink-3 min-[760px]:flex"
          >
            <span aria-hidden className="text-line-strong">/</span>
            <Link href={MY_HIVES_PATH} className="text-ink-3 no-underline hover:text-ink">
              All hives
            </Link>
            <span aria-hidden className="text-line-strong">/</span>
            <b className="truncate font-semibold text-ink">{workspace.hiveName}</b>
          </nav>
        ) : null}
      </div>

      <div className="min-w-0">
        {onHiveList ? <HivesFindBox /> : null}
        {inHive && workspace ? (
          <HiveOmni
            assistantName={workspace.assistantName?.trim() || "HiveForYou"}
            audience={viewerIsClient ? "client" : "staff"}
          />
        ) : null}
      </div>

      <div className={`flex items-center justify-end gap-2.5 ${inHive ? "max-[759px]:hidden" : ""}`}>
        {!inHive && !onHiveList ? (
          <Link href={MY_HIVES_PATH} className="text-[13.5px] font-medium text-ink-2 no-underline hover:text-ink">
            My hives
          </Link>
        ) : null}
        <AccountMenu {...account} />
      </div>
    </header>
  );
}