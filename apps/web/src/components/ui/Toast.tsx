"use client";

import { useEffect } from "react";

export function Toast({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  useEffect(() => {
    if (!message || !onDismiss) return;
    const id = window.setTimeout(onDismiss, 2600);
    return () => window.clearTimeout(id);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="toast"
      className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-[10px] bg-ink px-4 py-2.5 text-[13.5px] text-paper shadow-pop"
    >
      {message}
    </div>
  );
}
