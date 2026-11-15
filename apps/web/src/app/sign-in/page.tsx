import { redirect } from "next/navigation";

import { SignInFlow } from "@/components/auth/SignInFlow";
import { authLinkErrorMessage } from "@/server/auth/messages";
import { isNextNavigationError, safeNextPath } from "@/server/auth/redirects";
import { fetchMyProfile } from "@/lib/auth/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ next?: string; start?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "/hives");
  const startClients = params.start === "clients";
  const linkError = authLinkErrorMessage(params.error);

  try {
    const supabase = await createServerSupabaseClient();
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const { profile } = await fetchMyProfile(supabase);
      redirect(profile ? next : `/welcome?next=${encodeURIComponent(next)}`);
    }
  } catch (error) {
    if (isNextNavigationError(error)) {
      throw error;
    }
    // Misconfigured local env — still render sign-in UI.
  }

  return <SignInFlow nextPath={next} startClients={startClients} linkError={linkError} />;
}