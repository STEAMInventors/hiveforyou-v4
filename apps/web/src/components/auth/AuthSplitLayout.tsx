import type { ReactNode } from "react";

import { AuthAboutAside } from "./AuthAboutAside";

export function AuthSplitLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink min-[960px]:flex-row">
      <div className="flex flex-1 items-center justify-center px-5 py-10">{children}</div>
      <AuthAboutAside />
    </div>
  );
}