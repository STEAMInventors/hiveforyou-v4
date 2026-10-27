import { notFound } from "next/navigation";

import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { TabEmptyState } from "@/components/tab-empty-state";
import { DEMO_HIVES } from "@/lib/demo-scaffold";

type StudyPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function StudyPage({ params }: StudyPageProps) {
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
      activeTab="study"
    >
      <TabEmptyState variant="study" />
    </HiveWorkspaceLayout>
  );
}
