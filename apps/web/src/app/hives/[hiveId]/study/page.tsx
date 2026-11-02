import { type GetStudyPreparationResponse, isActiveProcessingRunStatus } from "@hiveforyou/contracts";

import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { StudyPromptPreview } from "@/components/study/StudyPromptPreview";
import { TabEmptyState } from "@/components/tab-empty-state";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { getStudyPreparation } from "@/server/study-preparation/study-preparation";
import { createServerSupabaseClient } from "@/server/supabase/server-client";

type StudyPageProps = {
  params: Promise<{ hiveId: string }>;
};

type PreparationLoad =
  | { ok: true; state: GetStudyPreparationResponse }
  | { ok: false; message: string; correlationId: string };

async function loadPreparation(hiveId: string): Promise<PreparationLoad> {
  const correlationId = await requestCorrelationId();
  try {
    const client = await createServerSupabaseClient();
    const state = await getStudyPreparation(client, { hiveId, correlationId, includePreview: true });
    return { ok: true, state };
  } catch (error) {
    const safeMessage = (error as { safeMessage?: unknown } | null)?.safeMessage;
    return {
      ok: false,
      message: typeof safeMessage === "string" ? safeMessage : "We couldn't load this Hive's study prompt.",
      correlationId,
    };
  }
}

export default async function StudyPage({ params }: StudyPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/study`);
  const load = await loadPreparation(hive.id);

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      activeTab="study"
    >
      {!load.ok ? (
        <section role="alert" className="flex flex-col gap-2 rounded-card border border-line bg-paper px-8 py-10">
          <h2 className="m-0 font-brand text-[21px] font-medium text-ink">Study prompt unavailable</h2>
          <p className="m-0 text-[15px] leading-[1.55] text-ink-muted">{load.message}</p>
          <p className="m-0 font-mono text-[11px] text-ink-subtle">Support reference: {load.correlationId}</p>
        </section>
      ) : load.state.preview ? (
        <StudyPromptPreview
          preview={load.state.preview}
          staleness={load.state.staleness}
          activeRun={load.state.processingRun}
        />
      ) : load.state.processingRun && isActiveProcessingRunStatus(load.state.processingRun.status) ? (
        <section role="status" className="flex flex-col gap-2 rounded-card border border-line bg-paper px-8 py-10">
          <h2 className="m-0 font-brand text-[21px] font-medium text-ink">Your study prompt is being prepared</h2>
          <p className="m-0 text-[15px] leading-[1.55] text-ink-muted">
            Follow progress from the Documents tab. This page shows the prompt once it&apos;s ready.
          </p>
        </section>
      ) : (
        <TabEmptyState variant="study" />
      )}
    </HiveWorkspaceLayout>
  );
}
