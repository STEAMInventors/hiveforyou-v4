import { HiveActivityPanel } from "@/components/hives/HiveActivityPanel";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadFirm } from "@/server/firm/load-firm";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function AuditPage({ params }: { params: Promise<{ hiveId: string }> }) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/audit`);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return null;
  const correlationId = await requestCorrelationId();
  const loaded = await loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId });
  const firm = await loadFirm(auth.client);
  const assistantName = firm?.firm?.assistantName?.trim() || "HiveForYou";

  return (
    <>
      <HivePageHead title="Audit trail" subtitle="What was read, checked and decided, in order." />
      <HiveActivityPanel board={loaded.board} assistantName={assistantName} />
    </>
  );
}
