import Link from "next/link";

import { FindingsPageView } from "@/components/findings/FindingsPageView";
import { Button } from "@/components/ui/Button";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { WorkspaceLoadError } from "@/components/workspace/WorkspaceLoadError";
import {
  buildFindingsChainEvidence,
  buildFindingsGlanceMetrics,
  buildFindingsOpenItems,
  buildFindingsTopics,
  findingsOpenItemCount,
} from "@hiveforyou/contracts";
import { hiveDocumentsPath, hiveFindingsPath, hiveFindingsRedirectPath, parseFindingsTab, preservedQuery } from "@/lib/hive-routes";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { documentPageCounts, loadHiveOverview } from "@/server/hives/hive-summary";
import { loadPackById } from "@/server/pipeline/pack-loader";
import { emitStructuredEvent } from "@/server/observability/logger";
import { createServerSupabaseClient } from "@/server/supabase/server-client";
import { permanentRedirect } from "next/navigation";

const PAGE_SUBTITLE =
  "What the documents show, organized by topic. Every statement opens the page it comes from.";

function loadFailure(error: unknown): { message: string; retryable: boolean; errorCode: string } {
  const record =
    error && typeof error === "object"
      ? (error as { safeMessage?: unknown; retryable?: unknown; errorCode?: unknown })
      : null;
  const message =
    typeof record?.safeMessage === "string" && record.safeMessage.trim() !== ""
      ? record.safeMessage
      : "We couldn't load Findings.";
  return {
    message,
    retryable: record?.retryable === true,
    errorCode: typeof record?.errorCode === "string" && record.errorCode.trim() !== "" ? record.errorCode : "INTERNAL_ERROR",
  };
}

export default async function FindingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ hiveId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { hiveId } = await params;
  const query = searchParams ? await searchParams : {};
  const legacyTab = parseFindingsTab(query.tab);
  if (query.tab) {
    permanentRedirect(
      hiveFindingsRedirectPath(hiveId, { tab: legacyTab, queryString: preservedQuery(query, { tab: null }) }),
    );
  }
  const hive = await loadOwnedHiveOrNotFound(hiveId, hiveFindingsPath(hiveId));
  const correlationId = await requestCorrelationId();

  let overview: Awaited<ReturnType<typeof loadHiveOverview>>;
  let assistantName = "HiveForYou";
  try {
    const client = await createServerSupabaseClient();
  const [overviewResult, firmRow] = await Promise.all([
      loadHiveOverview(client, { hiveId: hive.id, correlationId, includePreview: true }),
      hive.firmId
        ? client.schema("hive").from("firms").select("assistant_name").eq("id", hive.firmId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    overview = overviewResult;
    const raw = (firmRow.data as { assistant_name?: string } | null)?.assistant_name;
    if (typeof raw === "string" && raw.trim() !== "") assistantName = raw.trim();
  } catch (error) {
    const failure = loadFailure(error);
    emitStructuredEvent({
      eventName: "hive.findings.load_failed",
      severity: "ERROR",
      timestamp: new Date().toISOString(),
      component: "hive-findings",
      operation: "load_overview",
      correlationId,
      hiveId: hive.id,
      retryable: failure.retryable,
      errorCode: failure.errorCode,
      exceptionType: error instanceof Error ? error.name : "Unknown",
    });
    return (
      <div className="mx-auto w-full max-w-col-read">
        <HivePageHead title="Findings" subtitle={PAGE_SUBTITLE} />
        <WorkspaceLoadError message={failure.message} correlationId={correlationId} retryable={failure.retryable} />
      </div>
    );
  }

  const revision = overview.preparation.studyRevision;
  const built = overview.studyTab;
  if (!revision || !built?.view) {
    return (
      <div className="mx-auto w-full max-w-col-read">
        <HivePageHead title="Findings" subtitle={PAGE_SUBTITLE} />
        <p className="m-0 text-body text-ink-2">Your Study builds once documents are read.</p>
        <Link href={hiveDocumentsPath(hive.id)} className="mt-3 inline-block">
          <Button variant="secondary" type="button">
            Go to Documents
          </Button>
        </Link>
      </div>
    );
  }

  const pack =
    overview.canonicalStudy?.packRef != null
      ? loadPackById(overview.canonicalStudy.packRef.id, overview.canonicalStudy.packRef.version)
      : null;
  const openItems = buildFindingsOpenItems(built.view, overview.canonicalStudy);
  const topicBundle = buildFindingsTopics({
    view: built.view,
    canonicalStudy: overview.canonicalStudy,
    pack,
    openItems,
  });

  return (
    <div className="mx-auto flex w-full flex-col gap-3">
      <div className="w-full max-w-col-read">
        <HivePageHead title="Findings" subtitle={PAGE_SUBTITLE} />
      </div>
      <FindingsPageView
        hiveId={hive.id}
        revisionNumber={revision.revisionNumber}
        acceptedAt={revision.createdAt}
        assistantName={assistantName}
        view={built.view}
        sources={built.sources}
        canonicalStudy={overview.canonicalStudy}
        pack={pack}
        topics={topicBundle.topics}
        otherOpenItems={topicBundle.otherOpenItems}
        glanceMetrics={buildFindingsGlanceMetrics({
          view: built.view,
          pack,
          canonicalStudy: overview.canonicalStudy,
          snapshotDocuments: overview.preparation.eligibility.documents,
          coverageGaps: revision.coverageGaps,
        })}
        chainEvidence={
          overview.canonicalStudy
            ? buildFindingsChainEvidence(overview.canonicalStudy, pack, built.view)
            : []
        }
        openItemCount={findingsOpenItemCount(openItems)}
        coverageGaps={revision.coverageGaps}
        documentPages={documentPageCounts(overview.preparation)}
        preparation={overview.preparation}
      />
    </div>
  );
}