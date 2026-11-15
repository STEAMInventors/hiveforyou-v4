import { normalizeInvitationLookup } from "@hiveforyou/contracts";
import { redirect } from "next/navigation";

import { InviteAcceptPanel } from "@/components/invitations/InviteAcceptPanel";
import { hashInviteToken } from "@/server/hives/invite-token";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function InvitePage({ params }: PageProps) {
  const { token } = await params;
  const trimmed = token?.trim() ?? "";
  if (trimmed.length !== 64) {
    return <InviteAcceptPanel mode="invalid" />;
  }

  const supabase = await createServerSupabaseClient();
  const { data: lookupRaw } = await supabase.rpc("lookup_invitation", {
    p_token_hash: hashInviteToken(trimmed),
  });
  const lookup = normalizeInvitationLookup(lookupRaw);
  if (!lookup || lookup.status !== "valid" || !lookup.email || !lookup.role || !lookup.hiveId) {
    const mode =
      lookup?.status === "used"
        ? "used"
        : lookup?.status === "revoked"
          ? "revoked"
          : lookup?.status === "expired"
            ? "expired"
            : "invalid";
    return <InviteAcceptPanel mode={mode} invitedEmail={lookup?.email} />;
  }

  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    const next = `/invite/${trimmed}`;
    redirect(`/sign-in?next=${encodeURIComponent(next)}&email=${encodeURIComponent(lookup.email)}`);
  }

  const { data: userData } = await auth.client.auth.getUser();
  const sessionEmail = userData.user?.email?.trim().toLowerCase() ?? "";
  if (sessionEmail && sessionEmail !== lookup.email) {
    return (
      <InviteAcceptPanel
        mode="wrong_email"
        invitedEmail={lookup.email}
        sessionEmail={sessionEmail}
        token={trimmed}
        lookup={lookup}
      />
    );
  }

  return (
    <InviteAcceptPanel
      mode="welcome"
      token={trimmed}
      lookup={lookup}
    />
  );
}