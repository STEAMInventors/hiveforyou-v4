import type { Hive } from "@hiveforyou/contracts";
import { redirect } from "next/navigation";

import { MyHivesPanel } from "@/components/hives/MyHivesPanel";
import { fetchMyProfile } from "@/lib/auth/profile";
import { CREATE_HIVE_PARAM, hiveHomePath } from "@/lib/hive-routes";
import { isHiveDeletionPending } from "@/lib/hives/hive-deletion-state";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadFirm } from "@/server/firm/load-firm";
import { listHivesViaEdge } from "@/server/hives/hive-edge-gateway";
import { type HiveSummary, loadHiveOverview } from "@/server/hives/hive-summary";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type MyHivesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MyHivesPage({ searchParams }: MyHivesPageProps) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    redirect("/sign-in?next=%2Fhives");
  }

  const { profile, error: profileError } = await fetchMyProfile(auth.client);
  if (profileError) {
    redirect("/sign-in?next=%2Fhives");
  }
  if (!profile) {
    redirect("/welcome?next=%2Fhives");
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

  const firm = profile.startingView === "clients" ? await loadFirm(auth.client) : null;

  // One person, one own hive, no firm: the list adds nothing, so open the hive. `?all=1` shows the list.
  const onlyHive = hives.length === 1 ? hives[0] : null;
  if (
    onlyHive &&
    !initialError &&
    !firm?.firm &&
    onlyHive.kind === "own" &&
    !isHiveDeletionPending(onlyHive) &&
    params.all !== "1"
  ) {
    redirect(hiveHomePath(onlyHive.id));
  }

  return (
    <MyHivesPanel
      initialHives={hives}
      initialError={initialError}
      summaries={summaries}
      openCreateOnLoad={params[CREATE_HIVE_PARAM] === "1"}
      startingView={profile.startingView}
      showFirmRail={(firm?.members.filter((member) => member.joined).length ?? 0) > 1}
      viewerUserId={auth.userId}
    />
  );
}