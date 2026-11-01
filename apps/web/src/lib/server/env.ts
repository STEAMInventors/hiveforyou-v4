import "server-only";

import { getPublicSupabaseConfig } from "@/lib/supabase-config";

export function readServerEnv(): { supabaseUrl: string; supabaseAnonKey: string } {
  const { url, anonKey } = getPublicSupabaseConfig();
  return { supabaseUrl: url, supabaseAnonKey: anonKey };
}
