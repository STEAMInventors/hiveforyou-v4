import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { TabEmptyState } from "@/components/tab-empty-state";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";

type ReportsPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function ReportsPage({ params }: ReportsPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(
    hiveId,
    `/hives/${hiveId}/reports`,
  );

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      activeTab="reports"
    >
      <TabEmptyState variant="reports" />
    </HiveWorkspaceLayout>
  );
}
