import type { ReactNode } from "react";
import { Suspense } from "react";

import { AppShell } from "@/components/app-header";
import { accountMenuDetails } from "@/lib/account-shell";
import { ClientsHomeLayoutBridge } from "@/lib/hives/ClientsHomeLayoutBridge";
import { ClientsHomeProvider } from "@/lib/hives/clients-home-context";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function HivesLayout({ children }: { children: ReactNode }) {
  const session = await requireAuthenticatedUser();
  if (!session.ok) {
    return (
      <ClientsHomeProvider enabled={false}>
        <AppShell>{children}</AppShell>
      </ClientsHomeProvider>
    );
  }
  const account = await accountMenuDetails(session);
  const clientsHome = account.startingView === "clients";
  return (
    <Suspense fallback={<AppShell account={account}>{children}</AppShell>}>
      <ClientsHomeLayoutBridge enabled={clientsHome}>
        <AppShell account={account}>{children}</AppShell>
      </ClientsHomeLayoutBridge>
    </Suspense>
  );
}