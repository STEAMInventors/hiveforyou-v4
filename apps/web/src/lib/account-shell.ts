import { accountInitials } from "@/lib/account-initials";
import type { AccountMenuDetails } from "@/components/account-menu";
import { fetchMyProfile } from "@/lib/auth/profile";
import type { AuthenticatedSession } from "@/server/supabase/server-client";

export async function accountMenuDetails(session: Extract<AuthenticatedSession, { ok: true }>): Promise<AccountMenuDetails> {
  const { profile } = await fetchMyProfile(session.client);

  return {
    initials: session.email ? accountInitials(session.email) : null,
    displayName: profile?.displayName ?? null,
    email: session.email ?? null,
    startingView: profile?.startingView ?? null,
  };
}