import { permanentRedirect } from "next/navigation";

import { hiveFactsPath } from "@/lib/hive-routes";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";

type StudyPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function StudyPage({ params }: StudyPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/study`);
  permanentRedirect(hiveFactsPath(hive.id));
}