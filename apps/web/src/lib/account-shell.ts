import { accountInitials } from "@/lib/account-initials";
import type { AccountMenuDetails } from "@/components/account-menu";
import { fetchMyProfile } from "@/lib/auth/profile";
import type { AuthenticatedSession } from "@/server/supabase/server-client";

export async function accountMenuDetails(session: Extract<AuthenticatedSession, { ok: true }>): Promise<AccountMenuDetails> {
  const { data } = await session.client.auth.getUser();
  const fullName =
    typeof data.user?.user_metadata?.full_name === "string"
      ? data.user.user_metadata.full_name.trim()
      : "";
  const { profile } = await fetchMyProfile(session.client);

  return {
    initials: session.email ? accountInitials(session.email) : null,
    displayName: fullName || null,
    email: session.email ?? null,
    startingView: profile?.startingView ?? null,
  };
}