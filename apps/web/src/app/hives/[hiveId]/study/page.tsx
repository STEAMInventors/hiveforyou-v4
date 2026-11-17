import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";

import { StudyLegacyRedirect } from "./StudyLegacyRedirect";

type StudyPageProps = {
  params: Promise<{ hiveId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function queryString(params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) search.append(key, entry);
    } else {
      search.set(key, value);
    }
  }
  return search.toString();
}

export default async function StudyPage({ params, searchParams }: StudyPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/study`);
  const qs = queryString(await searchParams);
  return <StudyLegacyRedirect hiveId={hive.id} queryString={qs} />;
}