import { permanentRedirect } from "next/navigation";

import { hiveAuditPath, preservedQuery } from "@/lib/hive-routes";

export default async function ActivityRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ hiveId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { hiveId } = await params;
  const query = searchParams ? await searchParams : {};
  permanentRedirect(`${hiveAuditPath(hiveId)}${preservedQuery(query)}`);
}
