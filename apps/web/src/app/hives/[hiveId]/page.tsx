import { isValidUuid } from "@hiveforyou/contracts";
import { notFound, redirect } from "next/navigation";

import { hiveBoardPath, hiveDocumentsPath } from "@/lib/hive-routes";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadHiveOverview } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { createServerSupabaseClient } from "@/server/supabase/server-client";

type HiveRootPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function HiveRootPage({ params }: HiveRootPageProps) {
  const { hiveId } = await params;
  const trimmed = hiveId.trim().toLowerCase();
  if (!isValidUuid(trimmed)) {
    notFound();
  }
  const hive = await loadOwnedHiveOrNotFound(trimmed, `/hives/${trimmed}`);
  const correlationId = await requestCorrelationId();
  let documentCount = 0;
  try {
    const client = await createServerSupabaseClient();
    const overview = await loadHiveOverview(client, { hiveId: hive.id, correlationId });
    documentCount =
      overview.preparation.eligibility.documents.length + overview.preparation.eligibility.excluded.length;
  } catch {
    documentCount = 0;
  }
  redirect(documentCount === 0 ? hiveDocumentsPath(hive.id) : hiveBoardPath(hive.id));
}
