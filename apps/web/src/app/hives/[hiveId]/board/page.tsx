import { redirect } from "next/navigation";

import { hiveHomePath, preservedQuery } from "@/lib/hive-routes";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";

type BoardPageProps = {
  params: Promise<{ hiveId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Older board links, including message emails, open Home. `?view=ask` opens the box. */
export default async function HiveBoardPage({ params, searchParams }: BoardPageProps) {
  const { hiveId } = await params;
  await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/board`);
  const query = (await searchParams) ?? {};
  const viewRaw = query.view;
  const view = Array.isArray(viewRaw) ? viewRaw[0] : viewRaw;
  const overrides: Record<string, string | null> = { view: null };
  if (view === "ask") overrides.ask = "1";
  redirect(`${hiveHomePath(hiveId)}${preservedQuery(query, overrides)}`);
}
