"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { HiveAppLogo } from "@/components/HiveWordmark";
import { signOutAction } from "@/server/auth/auth-actions";

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
    ? "rounded-full bg-cell-blue-wash px-3.5 py-2 text-sm font-semibold text-cell-blue-deep no-underline"
    : "rounded-full px-3.5 py-2 text-sm font-medium text-ink-muted no-underline hover:bg-mist";
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-mist">
      <AppHeader />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}

function AppHeader() {
  const pathname = usePathname();
  const myHivesActive = pathname === "/hives" || pathname.startsWith("/hives/");
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
    <header className="sticky top-0 z-40 border-b border-line bg-paper">
      <div className="mx-auto flex h-14 max-w-[1160px] items-center gap-3 px-4 md:h-16 md:gap-7 md:px-8">
        <HiveAppLogo linkHome display="lockup" className="py-0.5" />
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          <Link
            href="/hives"
            aria-current={myHivesActive ? "page" : undefined}
            className={myHivesLinkClass(myHivesActive)}
          >
            My Hives
          </Link>
        </nav>
        <div className="flex-1" aria-hidden />
        <Link
          href="/account/password"
          className="hidden rounded-[10px] px-3 py-2 text-sm font-semibold text-cell-blue-deep no-underline hover:bg-mist md:inline-flex"
        >
          Change password
        </Link>
        <form action={signOutAction} className="hidden md:block">
          <button
            type="submit"
            className="rounded-[10px] border border-line bg-paper px-3 py-2 text-sm font-semibold text-ink hover:bg-mist"
          >
            Log out
          </button>
        </form>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-[10px] text-ink md:hidden"
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
            className="fixed inset-0 top-14 z-30 bg-ink/30 md:hidden"
            aria-label="Close menu"
            onClick={closeMobileNav}
          />
          <div
            id="app-mobile-nav"
            className="absolute left-0 right-0 top-full z-40 flex max-h-[calc(100vh-3.5rem)] flex-col overflow-auto border-b border-line bg-paper px-4 py-2 shadow-[0_16px_32px_rgba(31,35,40,0.12)] md:hidden"
          >
            <nav aria-label="Primary" className="flex flex-col gap-1 py-2">
              <Link
                href="/hives"
                aria-current={myHivesActive ? "page" : undefined}
                className={myHivesLinkClass(myHivesActive)}
                onClick={closeMobileNav}
              >
                My Hives
              </Link>
            </nav>
            <Link
              href="/account/password"
              onClick={closeMobileNav}
              className="mt-2 block border-t border-line px-3 py-3 text-sm font-semibold text-cell-blue-deep no-underline"
            >
              Change password
            </Link>
            <form action={signOutAction} className="border-t border-line pt-2">
              <button
                type="submit"
                className="w-full rounded-[10px] px-3 py-3 text-left text-sm font-semibold text-ink"
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
