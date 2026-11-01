import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import { handleV1SourceDocumentsRequest } from "./handler.ts";

function createUserClient(authHeader: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("misconfigured");
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
}

function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("misconfigured");
  }
  return createClient(url, serviceKey);
}

Deno.serve((req) =>
  handleV1SourceDocumentsRequest(req, createUserClient, createServiceClient),
);
