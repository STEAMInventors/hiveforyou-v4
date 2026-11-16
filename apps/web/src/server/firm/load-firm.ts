import { normalizeListFirmResponse, type ListFirmResponse } from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadFirm(client: SupabaseClient): Promise<ListFirmResponse | null> {
  const { data, error } = await client.rpc("list_firm");
  if (error) {
    return null;
  }
  return normalizeListFirmResponse(data);
}