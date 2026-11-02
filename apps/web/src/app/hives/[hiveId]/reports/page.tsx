import type { GetHiveReportsResponse } from "@hiveforyou/contracts";

import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { ReportsPanel } from "@/components/reports/ReportsPanel";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { getHiveReports } from "@/server/reports/reports";
import { createServerSupabaseClient } from "@/server/supabase/server-client";

type ReportsPageProps = {
  params: Promise<{ hiveId: string }>;
};

type ReportsLoad =
  | { ok: true; state: GetHiveReportsResponse }
  | { ok: false; message: string; correlationId: string };

async function loadReports(hiveId: string): Promise<ReportsLoad> {
  const correlationId = await requestCorrelationId();
  try {
    const client = await createServerSupabaseClient();
    return { ok: true, state: await getHiveReports(client, { hiveId, correlationId }) };
  } catch (error) {
    const safeMessage = (error as { safeMessage?: unknown } | null)?.safeMessage;
    return {
      ok: false,
      message: typeof safeMessage === "string" ? safeMessage : "We couldn't load this Hive's reports.",
      correlationId,
    };
  }
}

export default async function ReportsPage({ params }: ReportsPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/reports`);
  const load = await loadReports(hive.id);

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      activeTab="reports"
    >
      {load.ok ? (
        <ReportsPanel hiveId={hive.id} initial={load.state} />
      ) : (
        <section role="alert" className="flex flex-col gap-2 rounded-card border border-line bg-paper px-8 py-10">
          <h2 className="m-0 font-brand text-[21px] font-medium text-ink">Reports unavailable</h2>
          <p className="m-0 text-[15px] leading-[1.55] text-ink-muted">{load.message}</p>
          <p className="m-0 font-mono text-[11px] text-ink-subtle">Support reference: {load.correlationId}</p>
        </section>
      )}
    </HiveWorkspaceLayout>
  );
}
