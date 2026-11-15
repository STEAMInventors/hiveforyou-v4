import { redirect } from "next/navigation";

import { WelcomeForm } from "@/components/auth/WelcomeForm";
import { fetchMyProfile } from "@/lib/auth/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isNextNavigationError, safeNextPath } from "@/server/auth/redirects";

type PageProps = {
  searchParams: Promise<{ next?: string; start?: string }>;
};

export default async function WelcomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "/hives");
  const preselectClients = params.start === "clients";

  try {
    const supabase = await createServerSupabaseClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      redirect(`/sign-in?next=${encodeURIComponent(next)}`);
    }

    const { profile, error: profileError } = await fetchMyProfile(supabase);
    if (profileError) {
      redirect(`/sign-in?next=${encodeURIComponent(next)}`);
    }
    if (profile) {
      redirect(next);
    }
  } catch (error) {
    if (isNextNavigationError(error)) {
      throw error;
    }
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }

  return <WelcomeForm nextPath={next} preselectClients={preselectClients} />;
}