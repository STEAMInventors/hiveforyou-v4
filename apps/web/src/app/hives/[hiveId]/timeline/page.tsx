import { permanentRedirect } from "next/navigation";

import { hiveFindingsRedirectPath, preservedQuery } from "@/lib/hive-routes";

export default async function TimelineRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ hiveId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { hiveId } = await params;
  const query = searchParams ? await searchParams : {};
  permanentRedirect(
    hiveFindingsRedirectPath(hiveId, { tab: "timeline", queryString: preservedQuery(query, { tab: null }) }),
  );
}
