import { fetchMyProfile, type StartingView } from "@/lib/auth/profile";
import type { AuthenticatedSession } from "@/server/supabase/server-client";

export async function hiveWorkspaceStartingView(
  session: Extract<AuthenticatedSession, { ok: true }>,
): Promise<StartingView> {
  const { profile } = await fetchMyProfile(session.client);
  return profile?.startingView ?? "own";
}