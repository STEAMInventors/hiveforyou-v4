"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { Button } from "./Button";

export type DrawerProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

export function Drawer({ open, title, onClose, children, footer }: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close panel"
        className="absolute inset-0 bg-[rgba(20,26,34,0.28)]"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="drawer-panel fixed bottom-0 right-0 top-0 z-[51] flex w-full max-w-[520px] flex-col bg-paper shadow-pop focus:outline-none motion-safe:animate-[slidein_220ms_cubic-bezier(0.16,1,0.3,1)]"
        data-testid="ui-drawer"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="m-0 text-item font-semibold text-ink">{title}</h2>
          <Button variant="quiet" size="small" type="button" onClick={onClose} aria-label="Close">
            Close
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 pb-8 pt-5">{children}</div>
        {footer ? <footer className="border-t border-line px-5 py-4">{footer}</footer> : null}
      </aside>
    </div>
  );
}