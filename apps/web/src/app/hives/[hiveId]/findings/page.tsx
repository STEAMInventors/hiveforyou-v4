import Link from "next/link";

import { FindingsPageView } from "@/components/findings/FindingsPageView";
import { WORKSPACE_SECONDARY } from "@/components/button-classes";
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

const PAGE_SUBTITLE = "Explore what the documents show, the timeline, and items to review.";

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
  try {
    const client = await createServerSupabaseClient();
    overview = await loadHiveOverview(client, { hiveId: hive.id, correlationId, includePreview: true });
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
      <>
        <WorkspaceLoadError message={failure.message} correlationId={correlationId} retryable={failure.retryable} />
      </>
    );
  }

  const revision = overview.preparation.studyRevision;
  const built = overview.studyTab;
  if (!revision || !built?.view) {
    return (
      <>
        <div className="rounded-[14px] border border-line bg-paper p-[22px]">
          <h2 className="m-0 font-brand text-section font-semibold text-ink">Your Study builds once documents are read</h2>
          <Link href={hiveDocumentsPath(hive.id)} className={`${WORKSPACE_SECONDARY} mt-4`}>
            Go to Documents
          </Link>
        </div>
      </>
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
    <>
      <p className="m-0 mb-4 text-meta text-ink-3">{PAGE_SUBTITLE}</p>
      <FindingsPageView
        hiveId={hive.id}
        revisionNumber={revision.revisionNumber}
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
    </>
  );
}