import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseAdminEnv } from "../env.js";

/**
 * Hive admin clients use PostgREST and Storage only.
 * Realtime is disabled so Node 20 server/CLI runtimes do not require a native WebSocket.
 */
class DisabledRealtimeTransport {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly readyState = DisabledRealtimeTransport.CLOSED;

  constructor(..._args: [url: string | URL, protocols?: string | string[]]) {
    void _args;
  }

  close(): void {
    return;
  }

  send(): void {
    return;
  }

  addEventListener(): void {
    return;
  }

  removeEventListener(): void {
    return;
  }

  dispatchEvent(): boolean {
    return false;
  }
}

export function createSupabaseAdminClient(env: SupabaseAdminEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: DisabledRealtimeTransport as never },
  });
}
