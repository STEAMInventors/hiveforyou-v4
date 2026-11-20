import { permanentRedirect } from "next/navigation";

import { HOME_SHOW_ANCHOR, hiveHomePath, preservedQuery } from "@/lib/hive-routes";

/** Findings, including legacy tabs, now live on Home under What the documents show. */
export default async function FindingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ hiveId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { hiveId } = await params;
  const query = searchParams ? await searchParams : {};
  permanentRedirect(`${hiveHomePath(hiveId)}${preservedQuery(query, { tab: null })}#${HOME_SHOW_ANCHOR}`);
}
