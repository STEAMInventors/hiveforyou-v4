import type { ReactNode } from "react";

export function GalleryFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper px-4 py-6 min-[900px]:px-10">
      <p className="m-0 mb-4 text-label text-ink-3">Development gallery — {title}</p>
      {children}
    </div>
  );
}