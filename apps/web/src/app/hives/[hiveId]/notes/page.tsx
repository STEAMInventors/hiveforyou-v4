import { notFound, redirect } from "next/navigation";

import { HiveTeamNotesPanel } from "@/components/hives/HiveTeamNotesPanel";
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
  if (!auth.ok) {
    redirect(`/sign-in?next=${encodeURIComponent(`/hives/${hiveId}/notes`)}`);
  }
  const firm = await loadFirm(auth.client);
  const notes = await loadTeamNotes(auth.client, hive.id);
  const firmName = firm?.firm?.name ?? "your firm";
  const clientName = personFirstName(hive.name);

  return (
    <>
      <p className="m-0 mb-4 text-meta text-ink-3">
        Only people at {firmName} see these. Never shown to {clientName}.
      </p>
      <HiveTeamNotesPanel hive={hive} firmName={firmName} clientName={clientName} notes={notes} />
    </>
  );
}