import {
  buildStudyTabViewFromRpc,
  type GetHiveReportsResponse,
  type GetStudyPreparationResponse,
  isStudyViewReport,
  type StudyView,
  type StudyViewReport,
  type StudyViewSources,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { StateCounts } from "@/components/study/StateBar";
import type { DisplayState } from "@/components/study/StatusBadge";
import { studyStateCounts, studyStateTargets } from "@/components/study/study-summary";
import { getHiveReports } from "@/server/reports/reports";
import { getStudyPreparation, getStudyTabView } from "@/server/study-preparation/study-preparation";

/** What the Hive page header and the My hives card show about a Hive. */
export type HiveSummary = {
  documentCount: number;
  study: {
    revisionNumber: number;
    acceptedAt: string;
    /** Null until a study view exists for this revision. */
    counts: StateCounts | null;
    targets: Record<DisplayState, string> | null;
  } | null;
};

export type HiveOverview = {
  preparation: GetStudyPreparationResponse;
  reports: GetHiveReportsResponse | null;
  studyView: StudyViewReport | null;
  /** Built from `get_study_tab_view` for the Study tab (canonical + facts; narrative when a report exists). */
  studyTab: { view: StudyView; sources: StudyViewSources } | null;
  summary: HiveSummary;
};

/** The study view of the current revision: the Customer report's view first, else the Pro one. */
export function latestStudyView(reports: GetHiveReportsResponse | null): StudyViewReport | null {
  const views = (reports?.latest ?? []).filter(isStudyViewReport);
  return views.find((report) => report.audience === "CUSTOMER") ?? views[0] ?? null;
}

export function documentPageCounts(preparation: GetStudyPreparationResponse): Record<string, number> {
  return Object.fromEntries(
    preparation.eligibility.documents.map((document) => [document.sourceDocumentId, document.totalPhysicalPages]),
  );
}

export function summarizeHive(
  preparation: GetStudyPreparationResponse,
  reports: GetHiveReportsResponse | null,
  studyTab: HiveOverview["studyTab"],
): HiveSummary {
  const revision = preparation.studyRevision;
  const studyView = revision ? latestStudyView(reports) : null;
  const countsView = studyTab?.view ?? studyView?.view ?? null;
  return {
    documentCount: preparation.eligibility.documents.length + preparation.eligibility.excluded.length,
    study: revision
      ? {
          revisionNumber: revision.revisionNumber,
          acceptedAt: revision.createdAt,
          counts: countsView ? studyStateCounts(countsView, revision.coverageGaps) : null,
          targets: countsView ? studyStateTargets(countsView) : null,
        }
      : null,
  };
}

export async function loadHiveOverview(
  client: SupabaseClient,
  input: { hiveId: string; correlationId: string; includePreview?: boolean },
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
  if (preparation.studyRevision?.format === "canonical-study-1") {
    try {
      const raw = await getStudyTabView(client, { hiveId: input.hiveId, correlationId: input.correlationId });
      const fileNames = new Map(
        preparation.eligibility.documents.map((document) => [document.sourceDocumentId.toLowerCase(), document.fileName]),
      );
      const built = buildStudyTabViewFromRpc(raw, fileNames);
      if (built.ok) studyTab = { view: built.view, sources: built.sources };
    } catch {
      studyTab = null;
    }
  }

  return {
    preparation,
    reports,
    studyView,
    studyTab,
    summary: summarizeHive(preparation, reports, studyTab),
  };
}
