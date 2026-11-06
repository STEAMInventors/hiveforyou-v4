import type { ReactNode } from "react";

import { AppShell } from "@/components/app-header";
import { accountInitials } from "@/lib/account-initials";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function HivesLayout({ children }: { children: ReactNode }) {
  const session = await requireAuthenticatedUser();
  return <AppShell account={{ initials: session.ok ? accountInitials(session.email) : null }}>{children}</AppShell>;
}
