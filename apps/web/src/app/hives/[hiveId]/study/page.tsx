import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { TabEmptyState } from "@/components/tab-empty-state";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";

type StudyPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function StudyPage({ params }: StudyPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/study`);

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      activeTab="study"
    >
      <TabEmptyState variant="study" />
    </HiveWorkspaceLayout>
  );
}
