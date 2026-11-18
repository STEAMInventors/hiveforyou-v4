import Link from "next/link";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { PaneErrorBoundary } from "@/components/pane-error-boundary";
import type { StudyWorkspaceSurface } from "@/components/study/study-surface";
import { StudyView } from "@/components/study/StudyView";
import { Card } from "@/components/workspace/Card";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { StatusDot } from "@/components/workspace/StatusDot";
import { WorkspaceLoadError } from "@/components/workspace/WorkspaceLoadError";
import { WorkspacePageSkeleton } from "@/components/workspace/WorkspacePageSkeleton";
import {
  FINDINGS_TAB_LABELS,
  hiveDocumentsPath,
  hiveFindingsPath,
  parseFindingsTab,
  type FindingsTab,
} from "@/lib/hive-routes";
import { requestCorrelationId } from "@/server/auth/action-support";
import {
  documentsReadCount,
  documentsReadLabel,
  findingsItemCount,
  findingsToReviewCount,
} from "@/server/hives/findings-summary";
import { documentPageCounts, loadHiveOverview, type HiveOverview } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { emitStructuredEvent } from "@/server/observability/logger";
import { createServerSupabaseClient } from "@/server/supabase/server-client";

const TAB_SURFACE: Record<FindingsTab, StudyWorkspaceSurface> = {
  known: "facts",
  gaps: "missing",
  timeline: "timeline",
  review: "review",
};

const TABS: readonly FindingsTab[] = ["known", "gaps", "timeline", "review"];

const PAGE_SUBTITLE = "What the documents show, what's missing, and what to review.";

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
  const tab = parseFindingsTab(query.tab);
  const hive = await loadOwnedHiveOrNotFound(hiveId, hiveFindingsPath(hiveId, tab));
  const correlationId = await requestCorrelationId();

  let overview: HiveOverview;
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
        <HivePageHead title="Findings" subtitle={PAGE_SUBTITLE} />
        <WorkspaceLoadError message={failure.message} correlationId={correlationId} retryable={failure.retryable} />
      </>
    );
  }

  const revision = overview.preparation.studyRevision;
  const built = overview.studyTab;
  if (!revision || !built?.view) {
    return (
      <>
        <HivePageHead title="Findings" subtitle={PAGE_SUBTITLE} />
        <Card title="Your Study builds once documents are read">
          <Link href={hiveDocumentsPath(hive.id)} className={WORKSPACE_SECONDARY}>
            Go to Documents
          </Link>
        </Card>
      </>
    );
  }

  const read = documentsReadCount(overview.preparation);
  const items = findingsItemCount(built.view);
  const review = findingsToReviewCount(overview.summary.study?.counts);

  return (
    <>
      <HivePageHead title="Findings" subtitle={PAGE_SUBTITLE} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[900px]:grid-cols-3" data-testid="findings-summary">
        <Card testId="findings-documents-read">
          <p className="m-0 text-caption text-graphite">Documents read</p>
          <p className="m-0 mt-1 font-brand text-section font-semibold text-ink">{documentsReadLabel(read)}</p>
        </Card>
        <Card testId="findings-item-count">
          <p className="m-0 text-caption text-graphite">Findings</p>
          <p className="m-0 mt-1 font-brand text-section font-semibold text-ink">{items}</p>
        </Card>
        <Card testId="findings-to-review">
          <p className="m-0 text-caption text-graphite">To review</p>
          <div className="m-0 mt-1 font-brand text-section font-semibold text-ink">
            {review > 0 ? <StatusDot state="changed" label={String(review)} /> : <span className="text-graphite">0</span>}
          </div>
        </Card>
      </div>
      <nav aria-label="Findings sections" className="overflow-x-auto" data-testid="findings-tabs">
        <ul className="m-0 flex w-max min-w-full flex-nowrap gap-4 border-b border-line p-0">
          {TABS.map((item) => {
            const current = item === tab;
            return (
              <li key={item} className="list-none">
                <Link
                  href={hiveFindingsPath(hive.id, item)}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-1 text-small font-medium no-underline ${
                    current ? "border-cell-blue-deep text-cell-blue-deep" : "border-transparent text-graphite hover:text-ink"
                  }`}
                >
                  {FINDINGS_TAB_LABELS[item]}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <PaneErrorBoundary hiveId={hive.id} supportReference={correlationId} fallback={<WorkspacePageSkeleton variant="study" />}>
        <StudyView
          hiveId={hive.id}
          revisionFormat={revision.format}
          view={built.view}
          sources={built.sources}
          revisionNumber={revision.revisionNumber}
          coverageGaps={revision.coverageGaps}
          documentPages={documentPageCounts(overview.preparation)}
          workspaceSurface={TAB_SURFACE[tab]}
        />
      </PaneErrorBoundary>
    </>
  );
}
