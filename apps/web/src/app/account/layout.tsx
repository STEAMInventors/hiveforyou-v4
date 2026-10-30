import type { ReactNode } from "react";

import { AppShell } from "@/components/app-header";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
