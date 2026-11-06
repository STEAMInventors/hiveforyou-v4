import type { Hive } from "@hiveforyou/contracts";
import { redirect } from "next/navigation";

import { MyHivesPanel } from "@/components/hives/MyHivesPanel";
import { CREATE_HIVE_PARAM } from "@/lib/hive-routes";
import { isHiveDeletionPending } from "@/lib/hives/hive-deletion-state";
import { requestCorrelationId } from "@/server/auth/action-support";
import { listHivesViaEdge } from "@/server/hives/hive-edge-gateway";
import { type HiveSummary, loadHiveOverview } from "@/server/hives/hive-summary";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type MyHivesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MyHivesPage({ searchParams }: MyHivesPageProps) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    redirect("/login?next=%2Fhives");
  }

  const params = await searchParams;
  const correlationId = await requestCorrelationId();
  let hives: Hive[] = [];
  let initialError: { message: string; correlationId: string } | null = null;

  try {
    const result = await listHivesViaEdge(auth.client, correlationId);
    hives = result.hives;
  } catch (error) {
    initialError = {
      message:
        error && typeof error === "object" && "safeMessage" in error
          ? String((error as { safeMessage: string }).safeMessage)
          : "Could not load your hives.",
      correlationId,
    };
  }

  // One preparation read (and one reports read once a study exists) per hive; a card without a
  // summary still shows its name and description.
  const summaries: Record<string, HiveSummary> = Object.fromEntries(
    (
      await Promise.all(
        hives
          .filter((hive) => !isHiveDeletionPending(hive))
          .map((hive) =>
            loadHiveOverview(auth.client, { hiveId: hive.id, correlationId })
              .then((overview) => [hive.id, overview.summary] as const)
              .catch(() => null),
          ),
      )
    ).filter((entry): entry is readonly [string, HiveSummary] => entry !== null),
  );

  return (
    <MyHivesPanel
      initialHives={hives}
      initialError={initialError}
      summaries={summaries}
      openCreateOnLoad={params[CREATE_HIVE_PARAM] === "1"}
    />
  );
}
