import type { ReactNode } from "react";
import { Suspense } from "react";

import { AppShell } from "@/components/app-header";
import { HivesRouteShell } from "@/components/hives/HivesRouteShell";
import { accountMenuDetails } from "@/lib/account-shell";
import { ClientsHomeLayoutBridge } from "@/lib/hives/clients-home-context";
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
  // Everyone finds on Your hives, so the find state (and its `q` param) is on for every signed-in person.
  return (
    <Suspense fallback={<AppShell account={account}>{children}</AppShell>}>
      <ClientsHomeLayoutBridge enabled>
        <HivesRouteShell account={account}>{children}</HivesRouteShell>
      </ClientsHomeLayoutBridge>
    </Suspense>
  );
}
