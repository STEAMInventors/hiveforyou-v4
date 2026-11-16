import { HiveBoardPanel } from "@/components/hives/HiveBoardPanel";
import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadFirm } from "@/server/firm/load-firm";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { hiveWorkspaceStartingView } from "@/server/hives/hive-workspace-props";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type BoardPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function HiveBoardPage({ params }: BoardPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/board`);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return null;
  }

  const correlationId = await requestCorrelationId();
  const startingView = await hiveWorkspaceStartingView(auth);
  const loaded = await loadHiveBoard(auth.client, {
    hive,
    correlationId,
    userId: auth.userId,
  });

  const documentLabels = Object.fromEntries(
  [
    ...loaded.overview.preparation.eligibility.documents,
    ...loaded.overview.preparation.eligibility.excluded.map((item) => ({
      sourceDocumentId: item.sourceDocumentId,
      fileName: item.fileName,
    })),
  ].map((document) => [document.sourceDocumentId.toLowerCase(), document.fileName]),
  );

  const documentCount =
    loaded.overview.preparation.eligibility.documents.length +
    loaded.overview.preparation.eligibility.excluded.length;

  const firm = hive.firmId ? await loadFirm(auth.client) : null;

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      hiveKind={hive.kind}
      startingView={startingView}
      activeTab="board"
      summary={loaded.overview.summary}
    >
      <HiveBoardPanel
        hive={hive}
        currentUserId={auth.userId}
        hiveId={hive.id}
        hiveName={hive.name}
        hiveDescription={hive.description ?? ""}
        hasDocuments={documentCount > 0}
        board={loaded.board}
        documentLabels={documentLabels}
        initialPreparation={loaded.overview.preparation}
        firm={firm}
      />
    </HiveWorkspaceLayout>
  );
}