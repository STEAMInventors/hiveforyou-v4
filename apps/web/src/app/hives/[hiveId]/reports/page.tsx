import type { GetHiveReportsResponse, ReportAudience } from "@hiveforyou/contracts";

import { ReportsPanel } from "@/components/reports/ReportsPanel";
import { WorkspaceError } from "@/components/workspace/WorkspaceError";
import { requestCorrelationId } from "@/server/auth/action-support";
import { documentPageCounts, loadHiveOverview, type HiveSummary } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { createServerSupabaseClient, requireAuthenticatedUser } from "@/server/supabase/server-client";

type ReportsPageProps = {
  params: Promise<{ hiveId: string }>;
  searchParams: Promise<{ audience?: string | string[] }>;
};

type ReportsLoad =
  | {
      ok: true;
      state: GetHiveReportsResponse;
      documentPages: Record<string, number>;
      summary: HiveSummary | null;
      canonicalStudy: import("@hiveforyou/contracts").CanonicalStudy | null;
      referencedDocuments: readonly import("@hiveforyou/contracts").StudyViewReferencedDocument[];
    }
  | { ok: false; message: string };

/** `?audience=pro` selects the Pro report; anything else is the Customer report. */
function audienceFromParam(value: string | string[] | undefined): ReportAudience {
  return (Array.isArray(value) ? value[0] : value)?.toLowerCase() === "pro" ? "PRO" : "CUSTOMER";
}

async function loadReports(hiveId: string, correlationId: string): Promise<ReportsLoad> {
  try {
    const client = await createServerSupabaseClient();
    const overview = await loadHiveOverview(client, { hiveId, correlationId, includePreview: false });
    const state = overview.reports;
    if (!state) {
      return { ok: false, message: "We couldn't load this hive's reports." };
    }
    return {
      ok: true,
      state,
      documentPages: documentPageCounts(overview.preparation),
      summary: overview.summary,
      canonicalStudy: overview.canonicalStudy,
      referencedDocuments: overview.referencedDocuments,
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
    <>
      <p className="m-0 mb-4 text-meta text-ink-3">Customer and professional reports from the accepted study.</p>
      {load.ok ? (
        <ReportsPanel
          hiveId={hive.id}
          initial={load.state}
          initialAudience={audienceFromParam(audience)}
          documentPages={load.documentPages}
          canonicalStudy={load.canonicalStudy}
          referencedDocuments={load.referencedDocuments}
        />
      ) : (
        <WorkspaceError message={load.message} correlationId={correlationId} />
      )}
    </>
  );
}
