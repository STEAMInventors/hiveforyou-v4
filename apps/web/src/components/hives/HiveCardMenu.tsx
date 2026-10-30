"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { hiveDocumentsPath } from "@/lib/hive-routes";

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export function HiveCardMenu({ hiveId, hiveName }: { hiveId: string; hiveName: string }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) {
        return;
      }
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Options for ${hiveName}`}
        className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-muted hover:bg-mist hover:text-ink"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-[10px] border border-line bg-paper py-1 shadow-[0_12px_32px_rgba(31,35,40,0.12)]"
        >
          <Link
            href={hiveDocumentsPath(hiveId)}
            role="menuitem"
            className="flex w-full px-3 py-2.5 text-left text-sm font-semibold text-ink no-underline hover:bg-mist"
            onClick={() => setOpen(false)}
          >
            Open Hive
          </Link>
        </div>
      ) : null}
    </div>
  );
}
