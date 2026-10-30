import type { ReactNode } from "react";

import { AppShell } from "@/components/app-header";

export default function HivesLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
