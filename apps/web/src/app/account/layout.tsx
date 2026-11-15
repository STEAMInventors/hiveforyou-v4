import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-header";
import { accountMenuDetails } from "@/lib/account-shell";
import { MY_HIVES_PATH } from "@/lib/hive-routes";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const session = await requireAuthenticatedUser();
  if (!session.ok) {
    redirect(`/sign-in?next=${encodeURIComponent(MY_HIVES_PATH)}`);
  }
  const account = await accountMenuDetails(session);
  return <AppShell account={account}>{children}</AppShell>;
}