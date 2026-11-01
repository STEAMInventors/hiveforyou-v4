import "server-only";

export {
  createServerSupabaseClient,
  requireAuthenticatedUser,
} from "@/server/supabase/server-client";
