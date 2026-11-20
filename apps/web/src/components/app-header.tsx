"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { AccountMenu, type AccountMenuDetails } from "@/components/account-menu";
import { HiveBrandMark } from "@/components/HiveWordmark";
import { HiveOmni } from "@/components/hives/HiveOmni";
import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { OmniCatalogProvider } from "@/components/ui/omni-catalog";
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
  staffFirstName?: string | null;
  clientName?: string | null;
  currentUserId?: string | null;
  firmId?: string | null;
  firmless?: boolean;
  initialAssistant?: ConversationLoad;
  initialClientAssistant?: ConversationLoad | null;
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
      <OmniCatalogProvider>
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
      </OmniCatalogProvider>
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
  const inHive = workspace !== null && isInHivePath(pathname, workspace.hiveId);
  const staff = workspace?.staffView ?? workspace?.startingView === "clients";
  const viewerIsClient = workspace?.staffView === false && workspace.hiveKind === "client" && Boolean(workspace.firmId);

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
        {inHive && workspace ? (
          <HiveOmni
            hiveId={workspace.hiveId}
            assistantName={workspace.assistantName?.trim() || "HiveForYou"}
            audience={viewerIsClient ? "client" : "staff"}
            staffFirstName={workspace.staffFirstName ?? null}
            clientName={workspace.clientName ?? null}
            currentUserId={workspace.currentUserId ?? null}
            firmless={workspace.firmless ?? workspace.firmId == null}
            firmId={workspace.firmId ?? null}
            initialAssistant={
              workspace.initialAssistant ?? { ok: false, message: "Could not load the conversation. Try again.", correlationId: null, retryable: true }
            }
            initialClientAssistant={workspace.initialClientAssistant ?? null}
          />
        ) : null}
      </div>

      <div className={`flex items-center justify-end gap-2.5 ${inHive ? "max-[759px]:hidden" : ""}`}>
        {!inHive ? (
          <Link href={MY_HIVES_PATH} className={`text-[13.5px] font-medium text-ink-2 no-underline hover:text-ink ${onHiveList ? "max-[759px]:sr-only" : ""}`}>
            My hives
          </Link>
        ) : null}
        <AccountMenu {...account} />
      </div>
    </header>
  );
}