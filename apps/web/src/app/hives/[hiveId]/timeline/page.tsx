import { HiveTimelinePanel } from "@/components/timeline/HiveTimelinePanel";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { studyAvailability } from "@/lib/hives/study-availability";
import { requestCorrelationId } from "@/server/auth/action-support";
import { documentPageCounts, loadHiveOverview, workspaceStudyView } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type TimelinePageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function TimelinePage({ params }: TimelinePageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/timeline`);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return null;

  const correlationId = await requestCorrelationId();
  const overview = await loadHiveOverview(auth.client, { hiveId: hive.id, correlationId });
  const { view, sources } = workspaceStudyView(overview);
  const revision = overview.preparation.studyRevision ?? null;
  const availability = studyAvailability({
    revision,
    hasCanonicalView: overview.studyTab?.view != null,
    studyLoadError: overview.studyLoadError,
  });
  const timeline = view?.blocks.find((block) => block.name === "timeline")?.rows ?? [];

  return (
    <HiveTimelinePanel
      hiveId={hive.id}
      staffDisplayName={hive.assigneeDisplayName?.trim() || null}
      staffView={showsFirmThreePane(hive)}
      viewerIsClient={hive.membershipRole === "client"}
      studyAvailability={availability}
      studyLoadError={overview.studyLoadError}
      timeline={timeline}
      view={view}
      sources={sources}
      canonicalStudy={overview.canonicalStudy}
      documentPages={documentPageCounts(overview.preparation)}
      initialPreparation={overview.preparation}
    />
  );
}