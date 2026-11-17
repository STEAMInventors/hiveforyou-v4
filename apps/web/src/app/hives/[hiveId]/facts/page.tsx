import { isActiveProcessingRunStatus } from "@hiveforyou/contracts";

import { HiveAskInput } from "@/components/hive-ask-input";
import { PaneErrorBoundary } from "@/components/pane-error-boundary";
import { usesLegacyProgress } from "@/components/hives/study-preparation-progress";
import { StudyPromptPreview } from "@/components/study/StudyPromptPreview";
import { StudyTabPanel } from "@/components/study/StudyTabPanel";
import { StudyView } from "@/components/study/StudyView";
import { TabEmptyState } from "@/components/tab-empty-state";
import { Card } from "@/components/workspace/Card";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { WorkspaceError } from "@/components/workspace/WorkspaceError";
import { requestCorrelationId } from "@/server/auth/action-support";
import { documentPageCounts, type HiveOverview, loadHiveOverview } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";

type FactsPageProps = {
  params: Promise<{ hiveId: string }>;
};

async function loadPreparation(hiveId: string, correlationId: string) {
  try {
    const { createServerSupabaseClient } = await import("@/server/supabase/server-client");
    const client = await createServerSupabaseClient();
    const overview: HiveOverview = await loadHiveOverview(client, { hiveId, correlationId, includePreview: true });
    return { ok: true as const, overview };
  } catch (error) {
    const safeMessage = (error as { safeMessage?: unknown } | null)?.safeMessage;
    return {
      ok: false as const,
      message: typeof safeMessage === "string" ? safeMessage : "We couldn't load this hive's study.",
    };
  }
}

export default async function FactsPage({ params }: FactsPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/facts`);
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
  <>
      <HivePageHead title="Facts" subtitle="What the documents say, each tied to its page." />
      <div className="mb-4">
        <HiveAskInput hiveId={hive.id} />
      </div>
      {!load.ok ? (
        <WorkspaceError message={load.message} correlationId={correlationId} />
      ) : revision?.format === "canonical-study-1" ? (
        <div className="flex flex-col gap-4">
          {runActive ? (
            <p role="status" className="m-0 text-small text-graphite">
              A new study is being built. This page shows revision {revision.revisionNumber} until it&apos;s accepted.
            </p>
          ) : null}
          <PaneErrorBoundary hiveId={hive.id} supportReference={correlationId}>
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
                workspaceSurface="facts"
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
                workspaceSurface="facts"
              />
            )}
          </PaneErrorBoundary>
        </div>
      ) : revision ? (
        <PaneErrorBoundary hiveId={hive.id} supportReference={correlationId}>
          <StudyView hiveId={hive.id} revisionFormat={revision.format} view={null} sources={null} workspaceSurface="facts" />
          {legacyPreview && state ? (
            <StudyPromptPreview preview={legacyPreview} staleness={state.staleness} activeRun={run} />
          ) : null}
        </PaneErrorBoundary>
      ) : legacyPreview && state ? (
        <StudyPromptPreview preview={legacyPreview} staleness={state.staleness} activeRun={run} />
      ) : runActive ? (
        <Card title="Reading your documents">
          <p className="m-0 text-small text-graphite">
            This usually takes a few minutes. Follow progress from Documents; the study appears here once it&apos;s accepted.
          </p>
        </Card>
      ) : (
        <TabEmptyState variant="study" hiveId={hive.id} />
      )}
    </>
  );
}