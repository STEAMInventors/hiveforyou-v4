import { permanentRedirect } from "next/navigation";

import { hiveFindingsPath, preservedQuery } from "@/lib/hive-routes";

export default async function MissingRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ hiveId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { hiveId } = await params;
  const query = searchParams ? await searchParams : {};
  permanentRedirect(`${hiveFindingsPath(hiveId)}${preservedQuery(query, { tab: "gaps" })}`);
}
