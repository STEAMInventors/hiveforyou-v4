import { notFound } from "next/navigation";

import { HiveTeamNotesPanel } from "@/components/hives/HiveTeamNotesPanel";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { loadTeamNotes } from "@/server/firm/load-firm-board";
import { loadFirm } from "@/server/firm/load-firm";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";
import { personFirstName } from "@/lib/hives/firm-board";

export default async function NotesPage({ params }: { params: Promise<{ hiveId: string }> }) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/notes`);
  if (!showsFirmThreePane(hive)) {
    notFound();
  }
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return null;
  const firm = await loadFirm(auth.client);
  const notes = await loadTeamNotes(auth.client, hive.id);
  const firmName = firm?.firm?.name ?? "your firm";
  const clientName = personFirstName(hive.name);

  return (
    <>
      <HivePageHead
        title="Team notes"
        subtitle={`Only people at ${firmName} see these. Never shown to ${clientName}.`}
      />
      <HiveTeamNotesPanel hive={hive} firmName={firmName} clientName={clientName} notes={notes} />
    </>
  );
}