import type { ReactNode } from "react";

export function GalleryFrame({ children }: { title?: string; children: ReactNode }) {
  return <div className="min-h-dvh bg-paper">{children}</div>;
}