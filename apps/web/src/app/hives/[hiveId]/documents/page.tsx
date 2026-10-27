import { notFound } from "next/navigation";

import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { SourceChip } from "@/components/source-chip";
import { TabEmptyState } from "@/components/tab-empty-state";
import { DEMO_HIVES } from "@/lib/demo-scaffold";

type DocumentsPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function DocumentsPage({ params }: DocumentsPageProps) {
  const { hiveId } = await params;
  const hive = DEMO_HIVES.find((item) => item.id === hiveId);
  if (!hive) {
    notFound();
  }

  return (
    <HiveWorkspaceLayout
      hiveId={hiveId}
      hiveName={hive.name}
      hiveDescription={hive.description}
      activeTab="documents"
    >
      <TabEmptyState variant="documents" />
      <SourceChip />
    </HiveWorkspaceLayout>
  );
}
