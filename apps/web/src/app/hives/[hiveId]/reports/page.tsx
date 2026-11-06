import type { GetHiveReportsResponse, ReportAudience } from "@hiveforyou/contracts";

import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { ReportsPanel } from "@/components/reports/ReportsPanel";
import { requestCorrelationId } from "@/server/auth/action-support";
import { documentPageCounts, type HiveSummary, summarizeHive } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { getHiveReports } from "@/server/reports/reports";
import { getStudyPreparation } from "@/server/study-preparation/study-preparation";
import { createServerSupabaseClient } from "@/server/supabase/server-client";

type ReportsPageProps = {
  params: Promise<{ hiveId: string }>;
  searchParams: Promise<{ audience?: string | string[] }>;
};

type ReportsLoad =
  | { ok: true; state: GetHiveReportsResponse; documentPages: Record<string, number>; summary: HiveSummary | null }
  | { ok: false; message: string };

/** `?audience=pro` selects the Pro report; anything else is the Customer report. */
function audienceFromParam(value: string | string[] | undefined): ReportAudience {
  return (Array.isArray(value) ? value[0] : value)?.toLowerCase() === "pro" ? "PRO" : "CUSTOMER";
}

async function loadReports(hiveId: string, correlationId: string): Promise<ReportsLoad> {
  try {
    const client = await createServerSupabaseClient();
    const state = await getHiveReports(client, { hiveId, correlationId });
    const preparation = await getStudyPreparation(client, { hiveId, correlationId, includePreview: false }).catch(() => null);
    return {
      ok: true,
      state,
      documentPages: preparation ? documentPageCounts(preparation) : {},
      summary: preparation ? summarizeHive(preparation, state) : null,
    };
  } catch (error) {
    const safeMessage = (error as { safeMessage?: unknown } | null)?.safeMessage;
    return { ok: false, message: typeof safeMessage === "string" ? safeMessage : "We couldn't load this hive's reports." };
  }
}

export default async function ReportsPage({ params, searchParams }: ReportsPageProps) {
  const { hiveId } = await params;
  const { audience } = await searchParams;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/reports`);
  const correlationId = await requestCorrelationId();
  const load = await loadReports(hive.id, correlationId);

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      activeTab="reports"
      summary={load.ok ? load.summary : null}
      supportReference={correlationId}
    >
      {load.ok ? (
        <ReportsPanel
          hiveId={hive.id}
          initial={load.state}
          initialAudience={audienceFromParam(audience)}
          documentPages={load.documentPages}
        />
      ) : (
        <section role="alert" className="flex flex-col gap-2 rounded-card border border-line bg-paper p-7">
          <h2 className="m-0 font-brand text-section font-semibold text-ink">Reports unavailable</h2>
          <p className="m-0 text-body text-graphite">{load.message}</p>
          <p className="m-0 font-mono text-[12px] text-quiet">Support reference: {correlationId}</p>
        </section>
      )}
    </HiveWorkspaceLayout>
  );
}
