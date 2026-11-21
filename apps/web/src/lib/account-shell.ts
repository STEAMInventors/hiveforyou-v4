import { accountInitials } from "@/lib/account-initials";
import type { AccountMenuDetails } from "@/components/account-menu";
import { fetchMyProfile } from "@/lib/auth/profile";
import { loadFirm } from "@/server/firm/load-firm";
import type { AuthenticatedSession } from "@/server/supabase/server-client";

export async function accountMenuDetails(session: Extract<AuthenticatedSession, { ok: true }>): Promise<AccountMenuDetails> {
  const [{ profile }, firm] = await Promise.all([fetchMyProfile(session.client), loadFirm(session.client)]);
  const firmLine = firm?.firm ? "Firm settings" : null;

  return {
    initials: session.email ? accountInitials(session.email) : null,
    displayName: profile?.displayName ?? null,
    email: session.email ?? null,
    startingView: profile?.startingView ?? null,
    firmLine,
    firmName: firm?.firm?.name?.trim() || null,
  };
}