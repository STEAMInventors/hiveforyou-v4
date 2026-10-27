import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getPublicSupabaseConfig } from "@/lib/supabase-config";

export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const { url, anonKey } = getPublicSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }[],
      ) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot always mutate cookies; middleware refreshes sessions.
        }
      },
    },
  });
}

export type AuthenticatedSession =
  | { ok: true; userId: string; email?: string; client: SupabaseClient }
  | { ok: false; diagnosticReason: "no_session" };

export async function requireAuthenticatedUser(): Promise<AuthenticatedSession> {
  try {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) {
      return { ok: false, diagnosticReason: "no_session" };
    }
    return {
      ok: true,
      userId: data.user.id,
      email: data.user.email,
      client,
    };
  } catch {
    return { ok: false, diagnosticReason: "no_session" };
  }
}
