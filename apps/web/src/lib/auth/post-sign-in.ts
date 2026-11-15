import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchMyProfile } from "./profile";
import { safeNextPath } from "./redirects";

export async function resolvePostSignInPath(
  supabase: SupabaseClient,
  next: string,
): Promise<string> {
  const safeNext = safeNextPath(next, "/hives");
  const { profile, error } = await fetchMyProfile(supabase);
  if (error) {
    return safeNext;
  }
  if (!profile) {
    const welcome = new URLSearchParams({ next: safeNext });
    return `/welcome?${welcome.toString()}`;
  }
  return safeNext;
}