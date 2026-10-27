import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { SourceChip } from "@/components/source-chip";
import { TabEmptyState } from "@/components/tab-empty-state";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";

type DocumentsPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function DocumentsPage({ params }: DocumentsPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(
    hiveId,
    `/hives/${hiveId}/documents`,
  );

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      activeTab="documents"
    >
      <TabEmptyState variant="documents" />
      <SourceChip />
    </HiveWorkspaceLayout>
  );
}
