import { normalizeFirmInvitationLookup } from "@hiveforyou/contracts";
import { redirect } from "next/navigation";

import { FirmInviteAcceptPanel } from "@/components/firm/FirmInviteAcceptPanel";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hashInviteToken } from "@/server/hives/invite-token";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function FirmInvitePage({ params }: PageProps) {
  const { token } = await params;
  const trimmed = token?.trim() ?? "";
  if (trimmed.length !== 64) {
    return <FirmInviteAcceptPanel mode="invalid" />;
  }

  const supabase = await createServerSupabaseClient();
  const { data: lookupRaw } = await supabase.rpc("lookup_firm_invitation", {
    p_token_hash: hashInviteToken(trimmed),
  });
  const lookup = normalizeFirmInvitationLookup(lookupRaw);
  if (!lookup || lookup.status !== "valid" || !lookup.email) {
    const mode =
      lookup?.status === "used"
        ? "used"
        : lookup?.status === "revoked"
          ? "revoked"
          : lookup?.status === "expired"
            ? "expired"
            : "invalid";
    return <FirmInviteAcceptPanel mode={mode} />;
  }

  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    const next = `/firm-invite/${trimmed}`;
    redirect(`/sign-in?next=${encodeURIComponent(next)}&email=${encodeURIComponent(lookup.email)}`);
  }

  const { data: userData } = await auth.client.auth.getUser();
  const sessionEmail = userData.user?.email?.trim().toLowerCase() ?? "";
  if (sessionEmail && sessionEmail !== lookup.email) {
    return (
      <FirmInviteAcceptPanel mode="wrong_email" invitedEmail={lookup.email} sessionEmail={sessionEmail} />
    );
  }

  return <FirmInviteAcceptPanel mode="welcome" token={trimmed} lookup={lookup} />;
}
