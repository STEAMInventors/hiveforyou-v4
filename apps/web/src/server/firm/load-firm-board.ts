import { normalizeHiveRecord, type Hive } from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

export type FirmTeamNote = {
  teamNoteId: string;
  authorUserId: string;
  authorDisplayName: string | null;
  body: string;
  itemRef: string | null;
  createdAt: string;
};

export type FirmHandoverCard = {
  fromDisplayName: string;
  note: string | null;
  createdAt: string;
};

export async function loadTeamNotes(client: SupabaseClient, hiveId: string): Promise<FirmTeamNote[]> {
  const { data, error } = await client.rpc("list_team_notes", { p_hive_id: hiveId });
  if (error || !data || typeof data !== "object") return [];
  const notes = (data as { teamNotes?: unknown }).teamNotes;
  if (!Array.isArray(notes)) return [];
  return notes.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const teamNoteId = typeof record.teamNoteId === "string" ? record.teamNoteId : "";
    const authorUserId = typeof record.authorUserId === "string" ? record.authorUserId : "";
    const body = typeof record.body === "string" ? record.body : "";
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
    if (!teamNoteId || !authorUserId || !body || !createdAt) return [];
    return [
      {
        teamNoteId,
        authorUserId,
        authorDisplayName:
          typeof record.authorDisplayName === "string" ? record.authorDisplayName : null,
        body,
        itemRef: typeof record.itemRef === "string" ? record.itemRef : null,
        createdAt,
      },
    ];
  });
}

export async function loadLatestHandover(
  client: SupabaseClient,
  hiveId: string,
): Promise<FirmHandoverCard | null> {
  const { data, error } = await client
    .schema("hive")
    .from("hive_handovers")
    .select("from_user_id, note, created_at")
    .eq("hive_id", hiveId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { from_user_id?: string | null; note?: string | null; created_at?: string };
  const createdAt = typeof row.created_at === "string" ? row.created_at : "";
  if (!createdAt) return null;
  let fromDisplayName = "Someone";
  if (typeof row.from_user_id === "string") {
    const profile = await client
      .schema("hive")
      .from("user_profiles")
      .select("display_name")
      .eq("user_id", row.from_user_id)
      .maybeSingle();
    const name =
      profile.data && typeof profile.data === "object"
        ? (profile.data as { display_name?: string | null }).display_name
        : null;
    if (typeof name === "string" && name.trim()) fromDisplayName = name.trim();
  }
  return {
    fromDisplayName,
    note: typeof row.note === "string" ? row.note : null,
    createdAt,
  };
}

export function openHiveCounts(hives: readonly Hive[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const hive of hives) {
    if (hive.kind !== "client" || !hive.firmId || !hive.assigneeUserId || hive.stage === "closed") continue;
    const key = hive.assigneeUserId.toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export async function loadOpenHiveCounts(client: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await client.rpc("list_hives");
  if (error || !Array.isArray(data)) return {};
  const hives = data.flatMap((row) => {
    const hive = normalizeHiveRecord(row);
    return hive ? [hive] : [];
  });
  return openHiveCounts(hives);
}
