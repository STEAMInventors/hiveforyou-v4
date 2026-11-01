"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { HiveAppLogo } from "@/components/HiveWordmark";
import { MY_HIVES_PATH } from "@/lib/hive-routes";
import { signOutAction } from "@/server/auth/auth-actions";

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

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      {open ? (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      ) : (
        <>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </>
      )}
    </svg>
  );
}

function myHivesLinkClass(active: boolean): string {
  return active
    ? "whitespace-nowrap text-[14px] font-medium text-ink no-underline"
    : "whitespace-nowrap text-[14px] text-ink-muted no-underline transition-colors hover:text-cell-blue-deep";
}

export function AppShell({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<HiveHeaderWorkspace | null>(null);
  const contextValue = useMemo(
    () => ({ workspace, setWorkspace }),
    [workspace],
  );

  return (
    <HiveHeaderContext.Provider value={contextValue}>
      <div className="flex min-h-dvh flex-col bg-paper text-ink">
        <AppHeader workspace={workspace} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </HiveHeaderContext.Provider>
  );
}

function AppHeader({ workspace }: { workspace: HiveHeaderWorkspace | null }) {
  const pathname = usePathname();
  const inHiveRoute = /^\/hives\/[^/]+\/(documents|study|reports)/.test(pathname);
  const myHivesActive = pathname === MY_HIVES_PATH;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  return (
    <header
      className={`sticky top-0 z-40 bg-paper ${
        inHiveRoute ? "" : "border-b border-line"
      }`}
    >
      <div className="flex h-16 items-center gap-5 px-[clamp(16px,3vw,32px)]">
        <HiveAppLogo linkHome display="lockup" size="header" />

        {workspace ? (
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-[14px] text-ink-subtle"
          >
            <Link
              href={MY_HIVES_PATH}
              className="shrink-0 whitespace-nowrap text-[14px] text-ink-muted no-underline transition-colors hover:text-cell-blue-deep"
            >
              My Hives
            </Link>
            <span aria-hidden>/</span>
            <span
              aria-current="page"
              className="max-w-[260px] truncate font-medium text-ink"
              title={workspace.hiveName}
            >
              {workspace.hiveName}
            </span>
          </nav>
        ) : (
          <nav aria-label="Primary" className="hidden items-center gap-2 md:flex">
            <Link
              href={MY_HIVES_PATH}
              aria-current={myHivesActive ? "page" : undefined}
              className={myHivesLinkClass(myHivesActive)}
            >
              My Hives
            </Link>
          </nav>
        )}

        <div className="flex-1" aria-hidden />

        <Link
          href="/account/password"
          className="hidden whitespace-nowrap text-[14px] text-ink-muted no-underline transition-colors hover:text-cell-blue-deep md:inline-flex"
        >
          Change password
        </Link>
        <form action={signOutAction} className="hidden md:block">
          <button
            type="submit"
            className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-[14px] text-ink-muted transition-colors hover:text-cell-blue-deep"
          >
            Log out
          </button>
        </form>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-[12px] text-ink hover:bg-mist md:hidden"
          aria-expanded={mobileNavOpen}
          aria-controls="app-mobile-nav"
          aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          <MenuIcon open={mobileNavOpen} />
        </button>
      </div>

      {mobileNavOpen ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            className="fixed inset-0 top-16 z-30 bg-ink/30 md:hidden"
            aria-label="Close menu"
            onClick={closeMobileNav}
          />
          <div
            id="app-mobile-nav"
            className="absolute left-0 right-0 top-full z-40 flex max-h-[calc(100vh-4rem)] flex-col overflow-auto border-b border-line bg-paper px-4 py-2 shadow-[0_16px_32px_rgba(31,35,40,0.12)] md:hidden"
          >
            <nav aria-label="Primary" className="flex flex-col gap-1 py-2">
              <Link
                href={MY_HIVES_PATH}
                aria-current={myHivesActive ? "page" : undefined}
                className="rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-ink no-underline hover:bg-mist"
                onClick={closeMobileNav}
              >
                My Hives
              </Link>
            </nav>
            <Link
              href="/account/password"
              onClick={closeMobileNav}
              className="mt-1 block border-t border-line px-3 py-3 text-[14px] font-medium text-ink-muted no-underline hover:text-cell-blue-deep"
            >
              Change password
            </Link>
            <form action={signOutAction} className="border-t border-line pt-1">
              <button
                type="submit"
                className="w-full cursor-pointer rounded-[12px] border-0 bg-transparent px-3 py-3 text-left text-[14px] font-medium text-ink-muted hover:bg-mist hover:text-ink"
              >
                Log out
              </button>
            </form>
          </div>
        </>
      ) : null}
    </header>
  );
}
