"use client";

import Link from "next/link";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";

import { signOutAction } from "@/server/auth/auth-actions";

const ITEM_CLASS =
  "flex min-h-11 w-full cursor-pointer items-center rounded-control border-0 bg-transparent px-3 text-left text-[15px] font-medium text-ink no-underline hover:bg-mist focus-visible:bg-mist";

const menuItems = (menu: HTMLElement | null): HTMLElement[] =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

export function AccountMenu({ initials }: { initials: string | null }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const openMenu = (focus: "first" | "last") => {
    pendingFocus.current = focus;
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const list = menuItems(menuRef.current);
    const target = pendingFocus.current === "last" ? list.at(-1) : list[0];
    pendingFocus.current = null;
    target?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!menuRef.current?.contains(node) && !buttonRef.current?.contains(node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(event.key === "ArrowUp" ? "last" : "first");
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = menuItems(menuRef.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => list[(next + list.length) % list.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(list.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-pill border-0 bg-transparent p-1.5 text-ink hover:bg-mist"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="account-menu-button"
        onClick={() => (open ? close(false) : openMenu("first"))}
        onKeyDown={onButtonKeyDown}
      >
        <span
          aria-hidden
          className={`flex h-8 items-center justify-center rounded-pill border border-line bg-mist text-[13px] font-semibold text-ink ${
            initials ? "w-8" : "px-3"
          }`}
        >
          {initials ?? "Account"}
        </span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-1 flex w-56 flex-col gap-0.5 rounded-control border border-line bg-paper p-1.5 shadow-[0_12px_28px_rgba(31,35,40,0.12)]"
          onKeyDown={onMenuKeyDown}
        >
          <Link href="/account/password" role="menuitem" tabIndex={-1} className={ITEM_CLASS} onClick={() => close(false)}>
            Change password
          </Link>
          <form action={signOutAction} className="m-0">
            <button type="submit" role="menuitem" tabIndex={-1} className={ITEM_CLASS}>
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
