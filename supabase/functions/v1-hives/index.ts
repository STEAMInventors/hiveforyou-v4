import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import {
  handleV1HivesRequest,
  type EdgeUserSupabaseClient,
} from "./handler.ts";

function createUserClient(authHeader: string): EdgeUserSupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("misconfigured");
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  }) as unknown as EdgeUserSupabaseClient;
}

Deno.serve((req) => handleV1HivesRequest(req, createUserClient));
