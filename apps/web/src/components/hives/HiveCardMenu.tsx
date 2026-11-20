"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { setHiveKind, HiveClientError } from "@/lib/hives-client";
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

export function HiveCardMenu({
  hiveId,
  hiveName,
  hiveKind,
  onDeleteHive,
  onKindChanged,
  triggerClassName = "",
}: {
  hiveId: string;
  hiveName: string;
  hiveKind: "own" | "client";
  onDeleteHive: () => void;
  onKindChanged: () => void | Promise<void>;
  triggerClassName?: string;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [kindBusy, setKindBusy] = useState(false);
  const [kindError, setKindError] = useState<string | null>(null);
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
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
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

  const moveKind = async (next: "own" | "client") => {
    setKindBusy(true);
    setKindError(null);
    try {
      await setHiveKind(hiveId, next);
      setOpen(false);
      await onKindChanged();
    } catch (error) {
      setKindError(error instanceof HiveClientError ? error.message : "Could not update this hive.");
    } finally {
      setKindBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Options for ${hiveName}`}
        className={
          triggerClassName ||
          "flex h-11 w-11 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-mist hover:text-ink"
        }
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </button>
      {kindError ? (
        <p className="sr-only" role="alert">
          {kindError}
        </p>
      ) : null}
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[200px] rounded-button border border-line bg-paper py-1 shadow-[0_12px_32px_rgba(31,35,40,0.12)]"
        >
          <Link
            href={hiveDocumentsPath(hiveId)}
            role="menuitem"
            className="flex min-h-11 w-full items-center px-3.5 text-left text-[15px] font-medium text-ink no-underline hover:bg-mist"
            onClick={() => setOpen(false)}
          >
            Open hive
          </Link>
          {hiveKind === "own" ? (
            <button
              type="button"
              role="menuitem"
              disabled={kindBusy}
              className="flex min-h-11 w-full items-center px-3.5 text-left text-[15px] font-medium text-ink hover:bg-mist disabled:opacity-45"
              onClick={() => void moveKind("client")}
            >
              Move to client hives
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={kindBusy}
              className="flex min-h-11 w-full items-center px-3.5 text-left text-[15px] font-medium text-ink hover:bg-mist disabled:opacity-45"
              onClick={() => void moveKind("own")}
            >
              Move to my own hives
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full items-center px-3.5 text-left text-[15px] font-semibold text-coral-deep hover:bg-coral-wash"
            onClick={() => {
              setOpen(false);
              onDeleteHive();
            }}
          >
            Delete hive
          </button>
        </div>
      ) : null}
    </div>
  );
}