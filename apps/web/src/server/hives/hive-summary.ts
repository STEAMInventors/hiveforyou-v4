import {
  type GetHiveReportsResponse,
  type GetStudyPreparationResponse,
  isStudyViewReport,
  type StudyViewReport,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { StateCounts } from "@/components/study/StateBar";
import type { DisplayState } from "@/components/study/StatusBadge";
import { studyStateCounts, studyStateTargets } from "@/components/study/study-summary";
import { getHiveReports } from "@/server/reports/reports";
import { getStudyPreparation } from "@/server/study-preparation/study-preparation";

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

export function summarizeHive(preparation: GetStudyPreparationResponse, reports: GetHiveReportsResponse | null): HiveSummary {
  const revision = preparation.studyRevision;
  const studyView = revision ? latestStudyView(reports) : null;
  return {
    documentCount: preparation.eligibility.documents.length + preparation.eligibility.excluded.length,
    study: revision
      ? {
          revisionNumber: revision.revisionNumber,
          acceptedAt: revision.createdAt,
          counts: studyView ? studyStateCounts(studyView.view, revision.coverageGaps) : null,
          targets: studyView ? studyStateTargets(studyView.view) : null,
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
  const reports =
    preparation.studyRevision?.format === "canonical-study-1"
      ? await getHiveReports(client, { hiveId: input.hiveId, correlationId: input.correlationId })
      : null;
  return { preparation, reports, studyView: latestStudyView(reports), summary: summarizeHive(preparation, reports) };
}
