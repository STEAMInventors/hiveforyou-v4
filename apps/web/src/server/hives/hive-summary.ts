import {
  assignCanonicalGapHolderTypes,
  buildFindingsOpenItems,
  buildStudyTabViewFromRpc,
  findingsOpenItemCount,
  type CanonicalStudy,
  type GapUploadLink,
  type GetHiveReportsResponse,
  type GetStudyPreparationResponse,
  hiveAttention,
  hiveBoardOpenChecklistCount,
  isActiveProcessingRunStatus,
  isActiveReportRunStatus,
  isStudyViewReport,
  normalizeGetStudyTabViewResponse,
  type HiveAttentionInput,
  type HiveAttentionResult,
  type StudyView,
  type StudyViewReferencedDocument,
  type StudyViewReport,
  type StudyViewSources,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { StateCounts } from "@/components/study/state-counts";
import type { DisplayState } from "@/components/study/status-state";
import { studyDocumentRequestCount, studyStateCounts, studyStateTargets } from "@/components/study/study-summary";
import { getHiveReports } from "@/server/reports/reports";
import { loadPackById, logPinnedPackNotFound } from "@/server/pipeline/pack-loader";
import { emitStructuredEvent } from "@/server/observability/logger";
import { getStudyPreparation, getStudyTabView } from "@/server/study-preparation/study-preparation";

export type StudyLoadError = {
  message: string;
  correlationId: string;
  retryable: boolean;
};

/** What the Hive page header and the My hives card show about a Hive. */
export type HiveIntakeCounts = {
  total: number;
  received: number;
};

export type HiveSummary = {
  documentCount: number;
  attention: HiveAttentionResult;
  intake: HiveIntakeCounts;
  study: {
    revisionNumber: number;
    acceptedAt: string;
    /** Null until a study view exists for this revision. */
    counts: StateCounts | null;
    targets: Record<DisplayState, string> | null;
    /** Open Findings items; matches the Findings page and rail badge. */
    toReviewCount: number | null;
  } | null;
};

export type HiveBoardMissingContext = {
  readonly referencedDocuments: readonly StudyViewReferencedDocument[];
  readonly gapUploads: readonly GapUploadLink[];
  readonly acceptedStudyRevisionId: string | null;
  readonly acceptedStudyRevisionAcceptedAt: string | null;
};

function boardOpenMissingCount(
  canonicalStudy: CanonicalStudy | null,
  context: HiveBoardMissingContext | null,
): number | null {
  if (!canonicalStudy || !context) return null;
  return hiveBoardOpenChecklistCount({
    canonicalStudy,
    referencedDocuments: context.referencedDocuments,
    gapUploads: context.gapUploads,
    acceptedStudyRevisionId: context.acceptedStudyRevisionId,
    acceptedStudyRevisionAcceptedAt: context.acceptedStudyRevisionAcceptedAt,
    documentsPath: "",
  });
}

export function buildHiveAttentionInput(
  preparation: GetStudyPreparationResponse,
  reports: GetHiveReportsResponse | null,
  studyTab: HiveOverview["studyTab"],
  canonicalStudy: CanonicalStudy | null,
  boardMissingContext: HiveBoardMissingContext | null = null,
): HiveAttentionInput {
  const eligibility = preparation.eligibility;
  const documentCount = eligibility.documents.length + eligibility.excluded.length;
  const unreadableDocumentCount = eligibility.excluded.filter((item) => item.reason === "UNREADABLE").length;
  const documentsNotReadCount = eligibility.excluded.filter(
    (item) => item.reason === "NOT_READ" || item.reason === "READ_FAILED",
  ).length;
  const documentsNotInStudyCount =
    preparation.studyRevision && preparation.staleness?.stale
      ? preparation.staleness.reasons.filter((reason) => reason.kind === "DOCUMENT_ADDED").length
      : 0;
  const run = preparation.processingRun;
  const processingRunFailed =
    run?.status === "FAILED" ||
    preparation.reportRuns.some((item) => item.status === "FAILED");
  const processingRunActive =
    (run !== null && isActiveProcessingRunStatus(run.status)) ||
    preparation.reportRuns.some((item) => isActiveReportRunStatus(item.status));
  const counts = studyTab?.view ? studyStateCounts(studyTab.view, preparation.studyRevision?.coverageGaps ?? []) : null;
  const openConflicts = canonicalStudy?.conflicts?.length ?? 0;
  const hasStudy = preparation.studyRevision !== null;
  const hasReport = preparation.reportRuns.some((item) => item.status === "SUCCEEDED");
  const boardOpenMissing = boardOpenMissingCount(canonicalStudy, boardMissingContext);
  return {
    documentCount,
    unreadableDocumentCount,
    documentsNotReadCount,
    activeReadCount: eligibility.activeReadCount,
    processingRunFailed,
    processingRunActive,
    documentsNotInStudyCount,
    openConflicts,
    openNeeds: counts?.needs ?? 0,
    openChanged: counts?.changed ?? 0,
    openMissing: boardOpenMissing ?? counts?.missing ?? 0,
    openChecked: counts?.checked ?? 0,
    hasStudy,
    hasReport,
  };
}

export type HiveOverview = {
  preparation: GetStudyPreparationResponse;
  reports: GetHiveReportsResponse | null;
  studyView: StudyViewReport | null;
  /** Built from `get_study_tab_view` for the Study tab (canonical + facts; narrative when a report exists). */
  studyTab: { view: StudyView; sources: StudyViewSources } | null;
  canonicalStudy: CanonicalStudy | null;
  referencedDocuments: readonly StudyViewReferencedDocument[];
  summary: HiveSummary;
  /** Set when `getStudyTabView` fails for a canonical-study-1 revision. */
  studyLoadError: StudyLoadError | null;
};

/** The study view of the current revision: the Customer report's view first, else the Pro one. */
export function latestStudyView(reports: GetHiveReportsResponse | null): StudyViewReport | null {
  const views = (reports?.latest ?? []).filter(isStudyViewReport);
  return views.find((report) => report.audience === "CUSTOMER") ?? views[0] ?? null;
}

/** Canonical tab view when available; otherwise the pinned report study view for read-only legacy revisions. */
export function workspaceStudyView(
  overview: Pick<HiveOverview, "studyTab" | "studyView">,
): { view: StudyView | null; sources: StudyViewSources | null } {
  if (overview.studyTab?.view) {
    return { view: overview.studyTab.view, sources: overview.studyTab.sources };
  }
  const fromReport = overview.studyView;
  if (fromReport) {
    return { view: fromReport.view, sources: fromReport.studyViewSources };
  }
  return { view: null, sources: null };
}

export function documentPageCounts(preparation: GetStudyPreparationResponse): Record<string, number> {
  return Object.fromEntries(
    preparation.eligibility.documents.map((document) => [document.sourceDocumentId, document.totalPhysicalPages]),
  );
}

export function hiveIntakeCounts(
  preparation: GetStudyPreparationResponse,
  studyTab: HiveOverview["studyTab"],
  attentionInput: HiveAttentionInput,
): HiveIntakeCounts {
  const documentCount = attentionInput.documentCount;
  if (documentCount === 0) {
    return { total: 0, received: 0 };
  }
  const view = studyTab?.view;
  const requestSlots = view ? studyDocumentRequestCount(view) : 0;
  if (requestSlots > 0) {
    const openMissing = attentionInput.openMissing;
    return { total: requestSlots, received: Math.max(0, requestSlots - openMissing) };
  }
  const readCount = Math.max(0, documentCount - attentionInput.documentsNotReadCount);
  return { total: documentCount, received: readCount };
}

export function summarizeHive(
  preparation: GetStudyPreparationResponse,
  reports: GetHiveReportsResponse | null,
  studyTab: HiveOverview["studyTab"],
  canonicalStudy: CanonicalStudy | null = null,
  boardMissingContext: HiveBoardMissingContext | null = null,
): HiveSummary {
  const revision = preparation.studyRevision;
  const studyView = revision ? latestStudyView(reports) : null;
  const countsView = studyTab?.view ?? studyView?.view ?? null;
  const attentionInput = buildHiveAttentionInput(
    preparation,
    reports,
    studyTab,
    canonicalStudy,
    boardMissingContext,
  );
  const boardOpenMissing = boardOpenMissingCount(canonicalStudy, boardMissingContext);
  const studyCounts = countsView ? studyStateCounts(countsView, revision?.coverageGaps ?? []) : null;
  const alignedCounts =
    studyCounts && boardOpenMissing !== null ? { ...studyCounts, missing: boardOpenMissing } : studyCounts;
  const toReviewCount =
    countsView && canonicalStudy ? findingsOpenItemCount(buildFindingsOpenItems(countsView, canonicalStudy)) : null;
  return {
    documentCount: attentionInput.documentCount,
    attention: hiveAttention(attentionInput),
    intake: hiveIntakeCounts(preparation, studyTab, attentionInput),
    study: revision
      ? {
          revisionNumber: revision.revisionNumber,
          acceptedAt: revision.createdAt,
          counts: alignedCounts,
          targets: countsView ? studyStateTargets(countsView) : null,
          toReviewCount,
        }
      : null,
  };
}

export async function loadHiveOverview(
  client: SupabaseClient,
  input: {
    hiveId: string;
    correlationId: string;
    includePreview?: boolean;
    gapUploads?: readonly GapUploadLink[];
  },
): Promise<HiveOverview> {
  const preparation = await getStudyPreparation(client, {
    hiveId: input.hiveId,
    correlationId: input.correlationId,
    includePreview: input.includePreview ?? false,
  });
  const reports = preparation.studyRevision
    ? await getHiveReports(client, { hiveId: input.hiveId, correlationId: input.correlationId })
    : null;
  const studyView = latestStudyView(reports);

  let studyTab: HiveOverview["studyTab"] = null;
  let canonicalStudy: CanonicalStudy | null = null;
  let referencedDocuments: readonly StudyViewReferencedDocument[] = [];
  let studyLoadError: StudyLoadError | null = null;
  if (preparation.studyRevision?.format === "canonical-study-1") {
    try {
      const raw = await getStudyTabView(client, { hiveId: input.hiveId, correlationId: input.correlationId });
      const tab = normalizeGetStudyTabViewResponse(raw);
      if (tab?.canonicalStudy) {
        canonicalStudy = assignCanonicalGapHolderTypes(tab.canonicalStudy);
        referencedDocuments = tab.referencedDocuments.map((r) => ({
          sourceDocumentId: r.sourceDocumentId,
          description: r.description,
          page: r.page,
          quote: r.quote,
        }));
      }
      const fileNames = new Map(
        preparation.eligibility.documents.map((document) => [document.sourceDocumentId.toLowerCase(), document.fileName]),
      );
      const packRef = tab?.canonicalStudy?.packRef;
      const pack = packRef != null ? loadPackById(packRef.id, packRef.version) : null;
      if (packRef != null && pack == null) {
        logPinnedPackNotFound({
          correlationId: input.correlationId,
          hiveId: input.hiveId,
          packId: packRef.id,
          packVersion: packRef.version,
          stage: "STUDY_TAB",
        });
      }
      const built = buildStudyTabViewFromRpc(raw, fileNames, pack);
      if (built.ok) {
        studyTab = { view: built.view, sources: built.sources };
      } else {
        studyLoadError = {
          message: "We couldn't load the study for this hive.",
          correlationId: input.correlationId,
          retryable: true,
        };
        emitStructuredEvent({
          eventName: "hive.study_tab.failed",
          severity: "ERROR",
          timestamp: new Date().toISOString(),
          component: "hive-summary",
          operation: "build_study_tab_view",
          correlationId: input.correlationId,
          hiveId: input.hiveId,
          retryable: true,
          errorCode: "INTERNAL_ERROR",
          diagnosticReason: "unexpected_exception",
          exceptionType: "StudyTabBuildFailed",
        });
      }
    } catch (error) {
      studyTab = null;
      studyLoadError = {
        message: "We couldn't load the study for this hive.",
        correlationId: input.correlationId,
        retryable: true,
      };
      emitStructuredEvent({
        eventName: "hive.study_tab.failed",
        severity: "ERROR",
        timestamp: new Date().toISOString(),
        component: "hive-summary",
        operation: "get_study_tab_view",
        correlationId: input.correlationId,
        hiveId: input.hiveId,
        retryable: true,
        errorCode: "INTERNAL_ERROR",
        diagnosticReason: "unexpected_exception",
        exceptionType: error instanceof Error ? error.name : "Unknown",
      });
    }
  }

  const boardMissingContext: HiveBoardMissingContext | null = canonicalStudy
    ? {
        referencedDocuments,
        gapUploads: input.gapUploads ?? [],
        acceptedStudyRevisionId: preparation.studyRevision?.id ?? null,
        acceptedStudyRevisionAcceptedAt: preparation.studyRevision?.createdAt ?? null,
      }
    : null;

  return {
    preparation,
    reports,
    studyView,
    studyTab,
    canonicalStudy,
    referencedDocuments,
    summary: summarizeHive(preparation, reports, studyTab, canonicalStudy, boardMissingContext),
    studyLoadError,
  };
}
