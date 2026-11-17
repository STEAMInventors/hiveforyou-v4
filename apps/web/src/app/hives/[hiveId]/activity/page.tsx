import { HiveActivityPanel } from "@/components/hives/HiveActivityPanel";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { loadFirm } from "@/server/firm/load-firm";
import { requestCorrelationId } from "@/server/auth/action-support";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function ActivityPage({ params }: { params: Promise<{ hiveId: string }> }) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/activity`);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return null;
  const correlationId = await requestCorrelationId();
  const loaded = await loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId });
  const firm = await loadFirm(auth.client);
  const assistantName = firm?.firm?.assistantName?.trim() || "HiveForYou";

  return (
    <>
      <HivePageHead title="What happened" />
      <HiveActivityPanel board={loaded.board} assistantName={assistantName} />
    </>
  );
}