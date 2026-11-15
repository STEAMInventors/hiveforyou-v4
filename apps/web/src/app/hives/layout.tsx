import type { ReactNode } from "react";

import { AppShell } from "@/components/app-header";
import { accountMenuDetails } from "@/lib/account-shell";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function HivesLayout({ children }: { children: ReactNode }) {
  const session = await requireAuthenticatedUser();
  if (!session.ok) {
    return <AppShell>{children}</AppShell>;
  }
  const account = await accountMenuDetails(session);
  return <AppShell account={account}>{children}</AppShell>;
}