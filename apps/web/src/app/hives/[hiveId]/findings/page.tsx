import { permanentRedirect } from "next/navigation";

import { HOME_SHOW_ANCHOR, hiveHomePath, preservedQuery } from "@/lib/hive-routes";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";

import { PersonalFindingsStudy } from "./PersonalFindingsStudy";

/** Firm findings stay on Home. A personal Hive shows the accepted study here. */
export default async function FindingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ hiveId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/findings`);
  if (hive.firmId != null) {
    const query = searchParams ? await searchParams : {};
    permanentRedirect(`${hiveHomePath(hive.id)}${preservedQuery(query, { tab: null })}#${HOME_SHOW_ANCHOR}`);
  }
  return <PersonalFindingsStudy hiveId={hive.id} />;
}
