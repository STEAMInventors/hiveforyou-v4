import {
  type GetHiveReportsResponse,
  type GetStudyPreparationResponse,
  isActiveProcessingRunStatus,
  isStudyViewReport,
  type StudyViewReport,
} from "@hiveforyou/contracts";

import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { usesLegacyProgress } from "@/components/hives/study-preparation-progress";
import { StudyPromptPreview } from "@/components/study/StudyPromptPreview";
import { StudyView } from "@/components/study/StudyView";
import { TabEmptyState } from "@/components/tab-empty-state";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { getHiveReports } from "@/server/reports/reports";
import { getStudyPreparation } from "@/server/study-preparation/study-preparation";
import { createServerSupabaseClient } from "@/server/supabase/server-client";

type StudyPageProps = {
  params: Promise<{ hiveId: string }>;
};

type PreparationLoad =
  | { ok: true; state: GetStudyPreparationResponse; reports: GetHiveReportsResponse | null }
  | { ok: false; message: string; correlationId: string };

async function loadPreparation(hiveId: string): Promise<PreparationLoad> {
  const correlationId = await requestCorrelationId();
  try {
    const client = await createServerSupabaseClient();
    const state = await getStudyPreparation(client, { hiveId, correlationId, includePreview: true });
    const reports =
      state.studyRevision?.format === "canonical-study-1" ? await getHiveReports(client, { hiveId, correlationId }) : null;
    return { ok: true, state, reports };
  } catch (error) {
    const safeMessage = (error as { safeMessage?: unknown } | null)?.safeMessage;
    return {
      ok: false,
      message: typeof safeMessage === "string" ? safeMessage : "We couldn't load this Hive's study.",
      correlationId,
    };
  }
}

/** The study view of the current revision: the Customer report's view first, else the Pro one. */
function latestStudyView(reports: GetHiveReportsResponse | null): StudyViewReport | null {
  const views = (reports?.latest ?? []).filter(isStudyViewReport);
  return views.find((report) => report.audience === "CUSTOMER") ?? views[0] ?? null;
}

const STATUS_CLASS = "flex flex-col gap-2 rounded-card border border-line bg-paper px-8 py-10";

export default async function StudyPage({ params }: StudyPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/study`);
  const load = await loadPreparation(hive.id);

  const run = load.ok ? load.state.processingRun : null;
  const runActive = !!run && isActiveProcessingRunStatus(run.status);
  const legacyRun = !!run && usesLegacyProgress(run);
  const revision = load.ok ? load.state.studyRevision : null;
  const legacyPreview = load.ok && load.state.preview && (!run || legacyRun) ? load.state.preview : null;
  const studyView = load.ok ? latestStudyView(load.reports) : null;

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      activeTab="study"
    >
      {!load.ok ? (
        <section role="alert" className={STATUS_CLASS}>
          <h2 className="m-0 font-brand text-[21px] font-medium text-ink">Study unavailable</h2>
          <p className="m-0 text-[15px] leading-[1.55] text-ink-muted">{load.message}</p>
          <p className="m-0 font-mono text-[11px] text-ink-subtle">Support reference: {load.correlationId}</p>
        </section>
      ) : revision?.format === "canonical-study-1" ? (
        <div className="flex flex-col gap-4">
          {runActive ? (
            <p role="status" className="m-0 rounded-control bg-cell-blue-wash px-4 py-3 text-[14px] text-cell-blue-deep">
              A new study is being built. This page shows revision {revision.revisionNumber} until it&apos;s accepted.
            </p>
          ) : null}
          <StudyView
            hiveId={hive.id}
            revisionFormat={revision.format}
            view={studyView?.view ?? null}
            sources={studyView?.studyViewSources ?? null}
          />
        </div>
      ) : revision ? (
        <div className="flex flex-col gap-4">
          <StudyView hiveId={hive.id} revisionFormat={revision.format} view={null} sources={null} />
          {legacyPreview ? (
            <StudyPromptPreview preview={legacyPreview} staleness={load.state.staleness} activeRun={run} />
          ) : null}
        </div>
      ) : legacyPreview ? (
        <StudyPromptPreview preview={legacyPreview} staleness={load.state.staleness} activeRun={run} />
      ) : runActive ? (
        <section role="status" className={STATUS_CLASS}>
          <h2 className="m-0 font-brand text-[21px] font-medium text-ink">Your study is being built</h2>
          <p className="m-0 text-[15px] leading-[1.55] text-ink-muted">
            Follow progress from the Documents tab. This page shows the study once it&apos;s accepted.
          </p>
        </section>
      ) : (
        <TabEmptyState variant="study" />
      )}
    </HiveWorkspaceLayout>
  );
}
