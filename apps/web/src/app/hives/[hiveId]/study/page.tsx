import { isActiveProcessingRunStatus } from "@hiveforyou/contracts";

import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { usesLegacyProgress } from "@/components/hives/study-preparation-progress";
import { StudyPromptPreview } from "@/components/study/StudyPromptPreview";
import { StudyTabPanel } from "@/components/study/StudyTabPanel";
import { StudyView } from "@/components/study/StudyView";
import { TabEmptyState } from "@/components/tab-empty-state";
import { requestCorrelationId } from "@/server/auth/action-support";
import { documentPageCounts, type HiveOverview, loadHiveOverview } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { createServerSupabaseClient } from "@/server/supabase/server-client";

type StudyPageProps = {
  params: Promise<{ hiveId: string }>;
};

type PreparationLoad = { ok: true; overview: HiveOverview } | { ok: false; message: string };

async function loadPreparation(hiveId: string, correlationId: string): Promise<PreparationLoad> {
  try {
    const client = await createServerSupabaseClient();
    return { ok: true, overview: await loadHiveOverview(client, { hiveId, correlationId, includePreview: true }) };
  } catch (error) {
    const safeMessage = (error as { safeMessage?: unknown } | null)?.safeMessage;
    return { ok: false, message: typeof safeMessage === "string" ? safeMessage : "We couldn't load this hive's study." };
  }
}

const STATUS_CLASS = "flex flex-col gap-2 rounded-card border border-line bg-paper p-7";

export default async function StudyPage({ params }: StudyPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/study`);
  const correlationId = await requestCorrelationId();
  const load = await loadPreparation(hive.id, correlationId);

  const state = load.ok ? load.overview.preparation : null;
  const run = state?.processingRun ?? null;
  const runActive = !!run && isActiveProcessingRunStatus(run.status);
  const legacyRun = !!run && usesLegacyProgress(run);
  const revision = state?.studyRevision ?? null;
  const legacyPreview = state?.preview && (!run || legacyRun) ? state.preview : null;
  const built = load.ok ? load.overview.studyTab : null;

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      activeTab="study"
      summary={load.ok ? load.overview.summary : null}
      supportReference={correlationId}
    >
      {!load.ok ? (
        <section role="alert" className={STATUS_CLASS}>
          <h2 className="m-0 font-brand text-section font-semibold text-ink">Study unavailable</h2>
          <p className="m-0 text-body text-graphite">{load.message}</p>
          <p className="m-0 font-mono text-[12px] text-quiet">Support reference: {correlationId}</p>
        </section>
      ) : revision?.format === "canonical-study-1" ? (
        <div className="flex flex-col gap-5">
          {runActive ? (
            <p role="status" className="m-0 rounded-control border border-line bg-paper px-4 py-3 text-small text-graphite">
              A new study is being built. This page shows revision {revision.revisionNumber} until it&apos;s accepted.
            </p>
          ) : null}
          {built?.view ? (
            <StudyTabPanel
              hiveId={hive.id}
              revisionFormat={revision.format}
              view={built.view}
              sources={built.sources}
              revisionNumber={revision.revisionNumber}
              coverageGaps={revision.coverageGaps}
              documentPages={state ? documentPageCounts(state) : undefined}
              initialPreparation={state ?? undefined}
              canonicalStudy={load.overview.canonicalStudy}
              referencedDocuments={load.overview.referencedDocuments}
            />
          ) : (
            <StudyView
              hiveId={hive.id}
              revisionFormat={revision.format}
              view={null}
              sources={null}
              revisionNumber={revision.revisionNumber}
              coverageGaps={revision.coverageGaps}
              documentPages={state ? documentPageCounts(state) : undefined}
            />
          )}
        </div>
      ) : revision ? (
        <div className="flex flex-col gap-5">
          <StudyView hiveId={hive.id} revisionFormat={revision.format} view={null} sources={null} />
          {legacyPreview && state ? (
            <StudyPromptPreview preview={legacyPreview} staleness={state.staleness} activeRun={run} />
          ) : null}
        </div>
      ) : legacyPreview && state ? (
        <StudyPromptPreview preview={legacyPreview} staleness={state.staleness} activeRun={run} />
      ) : runActive ? (
        <section role="status" className={STATUS_CLASS}>
          <h2 className="m-0 font-brand text-section font-semibold text-ink">Reading your documents</h2>
          <p className="m-0 text-body text-graphite">
            This usually takes a few minutes. Follow progress from Documents; the study appears here once it&apos;s
            accepted.
          </p>
        </section>
      ) : (
        <TabEmptyState variant="study" hiveId={hive.id} />
      )}
    </HiveWorkspaceLayout>
  );
}
