import type { SupabaseClient } from "@supabase/supabase-js";

export type StartingView = "own" | "clients";

export type UserProfile = {
  userId: string;
  startingView: StartingView;
  createdAt: string;
  updatedAt: string;
};

function isStartingView(value: unknown): value is StartingView {
  return value === "own" || value === "clients";
}

export function parseUserProfile(data: unknown): UserProfile | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const row = data as Record<string, unknown>;
  if (
    typeof row.userId !== "string" ||
    !isStartingView(row.startingView) ||
    typeof row.createdAt !== "string" ||
    typeof row.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    userId: row.userId,
    startingView: row.startingView,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function fetchMyProfile(
  supabase: SupabaseClient,
): Promise<{ profile: UserProfile | null; error: boolean }> {
  const { data, error } = await supabase.rpc("get_my_profile");
  if (error) {
    return { profile: null, error: true };
  }
  return { profile: parseUserProfile(data), error: false };
}

export function startingViewLabel(view: StartingView): string {
  return view === "clients" ? "Client hives" : "My own paperwork";
}

export function switchStartingViewLabel(current: StartingView): string {
  return current === "clients" ? "Switch to my own paperwork" : "Switch to client hives";
}

export function switchedStartingView(current: StartingView): StartingView {
  return current === "clients" ? "own" : "clients";
}