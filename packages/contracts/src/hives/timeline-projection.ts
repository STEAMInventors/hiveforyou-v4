/**
 * P0.4-A / P0.5-A — Deterministic timeline rows for workspace surfaces.
 * Canonical `hive.study-view/1` timeline blocks take precedence; otherwise bound `Timeline` events
 * from saved `hive-application-view/1` reports for the SAME accepted study revision (latest
 * Customer, then latest Pro, then newest same-revision historical report). No synthesis from
 * narrative or loose dates.
 */

import { parseCalendarDateToken } from "../analysis/canonical-finding-resolver";
import { isValidUuid } from "./hive-contracts";
import {
  APPLICATION_VIEW_SCHEMA,
  type ApplicationView,
  type ApplicationViewComponent,
  type BoundRef,
} from "../reports/application-view-contracts";
import {
  type ApplicationViewReport,
  type HiveReport,
  isStudyViewReport,
  type ReportSummary,
} from "../reports/report-contracts";
import type { ReportAudience } from "../reports/writer-report-contracts";
import { isStudyView, type StudyView, type StudyViewRow, type StudyViewValue } from "../pipeline/study-view-contracts";

export type TimelineReportAttribution = {
  readonly reportId: string;
  readonly studyRevisionId: string;
  readonly revisionNumber: number;
  readonly audience: ReportAudience;
  readonly title: string;
  readonly createdAt: string;
  /** True when loaded from report history because neither latest Customer nor latest Pro had valid Timeline events. */
  readonly fromHistory: boolean;
};

export type ResolvedWorkspaceTimeline = {
  readonly rows: StudyViewRow[];
  readonly source: "canonical" | "latest_report" | "historical_report" | "none";
  readonly report: TimelineReportAttribution | null;
};

export type ProjectApplicationViewTimelineOptions = {
  readonly authorizedSourceDocumentIds?: readonly string[];
  readonly authorizedDocumentPages?: Readonly<Record<string, number>>;
};

const DEFAULT_MAX_HISTORY_LOOKUPS = 25;

function timelineBlockRows(view: StudyView | null): readonly StudyViewRow[] {
  return view?.blocks.find((block) => block.name === "timeline")?.rows ?? [];
}

function isResolvableRef(ref: BoundRef): boolean {
  if (!ref || typeof ref.sourceDocumentId !== "string" || typeof ref.fileName !== "string") return false;
  const documentId = ref.sourceDocumentId.trim().toLowerCase();
  return isValidUuid(documentId) && Number.isInteger(ref.pageNumber) && ref.pageNumber >= 1 && ref.fileName.trim() !== "";
}

function authorizedDocumentIdSet(ids: readonly string[] | null | undefined): ReadonlySet<string> | null {
  if (ids === undefined || ids === null) return null;
  return new Set(ids.map((id) => id.trim().toLowerCase()).filter((id) => isValidUuid(id)));
}

function authorizedDocumentPageMap(
  pages: Readonly<Record<string, number>> | null | undefined,
): ReadonlyMap<string, number> | null {
  if (!pages) return null;
  const map = new Map<string, number>();
  for (const [id, count] of Object.entries(pages)) {
    const normalized = id.trim().toLowerCase();
    if (!isValidUuid(normalized)) continue;
    if (typeof count === "number" && Number.isInteger(count) && count >= 1) {
      map.set(normalized, count);
    }
  }
  return map.size > 0 ? map : null;
}

function isAuthorizedRef(
  ref: BoundRef,
  authorizedIds: ReadonlySet<string> | null,
  authorizedPages: ReadonlyMap<string, number> | null,
): boolean {
  if (!isResolvableRef(ref)) return false;
  const documentId = ref.sourceDocumentId.trim().toLowerCase();
  if (authorizedIds !== null && !authorizedIds.has(documentId)) return false;
  const maxPages = authorizedPages?.get(documentId);
  if (maxPages !== undefined && ref.pageNumber > maxPages) return false;
  return true;
}

function valuesFromRefs(
  refs: readonly BoundRef[],
  factIdPrefix: string,
): StudyViewValue[] {
  const values: StudyViewValue[] = [];
  refs.forEach((ref, refIndex) => {
    if (!isResolvableRef(ref)) return;
    values.push({
      factId: `${factIdPrefix}:r${refIndex}`,
      valueAsWritten: ref.fileName.trim(),
      sourceRef: {
        sourceDocumentId: ref.sourceDocumentId.trim().toLowerCase(),
        pageNumber: ref.pageNumber,
        quote: "",
      },
    });
  });
  return values;
}

function eventRow(
  component: Extract<ApplicationViewComponent, { component: "Timeline" }>,
  componentIndex: number,
  eventIndex: number,
  authorizedIds: ReadonlySet<string> | null,
  authorizedPages: ReadonlyMap<string, number> | null,
): StudyViewRow | null {
  const event = component.events[eventIndex];
  if (!event || typeof event.text !== "string" || typeof event.date !== "string" || !Array.isArray(event.refs)) {
    return null;
  }
  const statement = event.text.trim();
  if (statement === "") return null;
  const isoDate = parseCalendarDateToken(event.date);
  if (!isoDate) return null;
  const refs = event.refs.filter((ref) => isAuthorizedRef(ref, authorizedIds, authorizedPages));
  if (refs.length === 0) return null;
  const values = valuesFromRefs(refs, `AV-T${componentIndex}-E${eventIndex}`);
  if (values.length === 0) return null;
  const componentId = component.id?.trim() || `c${componentIndex}`;
  return {
    id: `AV-${componentId}-E${eventIndex + 1}`,
    date: isoDate,
    asWritten: event.date.trim() || null,
    statement,
    values,
  };
}

/** Projects bound Timeline components from one saved application view (no narrative synthesis). */
export function projectApplicationViewTimeline(
  view: ApplicationView,
  options?: ProjectApplicationViewTimelineOptions,
): StudyViewRow[] {
  if (!view || view.schema !== APPLICATION_VIEW_SCHEMA || !Array.isArray(view.components)) return [];
  const authorizedIds = authorizedDocumentIdSet(options?.authorizedSourceDocumentIds);
  const authorizedPages = authorizedDocumentPageMap(options?.authorizedDocumentPages);
  const rows: StudyViewRow[] = [];
  view.components.forEach((component, componentIndex) => {
    if (component.component !== "Timeline" || !Array.isArray(component.events)) return;
    component.events.forEach((_, eventIndex) => {
      const row = eventRow(component, componentIndex, eventIndex, authorizedIds, authorizedPages);
      if (row) rows.push(row);
    });
  });
  rows.sort((a, b) => {
    const byDate = (a.date ?? "").localeCompare(b.date ?? "");
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
  return rows;
}

function normalizeRevisionUuid(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isValidUuid(normalized) ? normalized : null;
}

function attributionFromReport(report: ApplicationViewReport, fromHistory: boolean): TimelineReportAttribution {
  return {
    reportId: report.id.trim().toLowerCase(),
    studyRevisionId: report.studyRevisionId.trim().toLowerCase(),
    revisionNumber: report.revisionNumber,
    audience: report.audience,
    title: report.title,
    createdAt: report.createdAt,
    fromHistory,
  };
}

function orderedLatestApplicationReports(
  reports: readonly HiveReport[] | null | undefined,
  acceptedStudyRevisionId: string | null | undefined,
): ApplicationViewReport[] {
  if (!reports?.length) return [];
  const filterByRevision = acceptedStudyRevisionId !== undefined && acceptedStudyRevisionId !== null;
  const targetRevisionId = filterByRevision ? normalizeRevisionUuid(acceptedStudyRevisionId) : null;
  if (filterByRevision && !targetRevisionId) return [];

  const saved = reports.filter((report): report is ApplicationViewReport => {
    if (isStudyViewReport(report)) return false;
    if (targetRevisionId && report.studyRevisionId.trim().toLowerCase() !== targetRevisionId) return false;
    return true;
  });

  const customer = saved.filter((report) => report.audience === "CUSTOMER");
  const pro = saved.filter((report) => report.audience === "PRO");
  const other = saved.filter((report) => report.audience !== "CUSTOMER" && report.audience !== "PRO");
  return [...customer, ...pro, ...other];
}

function compareReportNewestFirst(a: Pick<ReportSummary, "createdAt" | "id">, b: Pick<ReportSummary, "createdAt" | "id">): number {
  const timeA = Date.parse(a.createdAt);
  const timeB = Date.parse(b.createdAt);
  if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
    return timeB - timeA;
  }
  const byCreatedAt = b.createdAt.localeCompare(a.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return b.id.trim().toLowerCase().localeCompare(a.id.trim().toLowerCase());
}

/**
 * Selects earlier saved report summaries eligible for legacy Timeline compatibility fallback:
 * strictly the same accepted study revision, excluding reports already inspected in `latest`,
 * ordered newest first (`createdAt DESC, id DESC`).
 */
export function selectSameRevisionHistoricalReportCandidates(input: {
  readonly acceptedStudyRevisionId: string | null | undefined;
  readonly latest: readonly HiveReport[] | null | undefined;
  readonly history: readonly ReportSummary[] | null | undefined;
}): ReportSummary[] {
  const targetRevisionId = normalizeRevisionUuid(input.acceptedStudyRevisionId);
  if (!targetRevisionId || !input.history?.length) return [];

  const excluded = new Set(
    (input.latest ?? []).map((report) => report.id.trim().toLowerCase()).filter((id) => isValidUuid(id)),
  );
  const seen = new Set<string>();
  const candidates: ReportSummary[] = [];

  for (const summary of input.history) {
    const id = summary.id.trim().toLowerCase();
    const revisionId = summary.studyRevisionId.trim().toLowerCase();
    if (!isValidUuid(id) || revisionId !== targetRevisionId) continue;
    if (excluded.has(id) || seen.has(id)) continue;
    seen.add(id);
    candidates.push(summary);
  }

  candidates.sort(compareReportNewestFirst);
  return candidates;
}

/**
 * Resolves workspace Timeline rows and attribution synchronously from canonical study-view
 * or latest Customer / Pro application-view reports for the accepted revision.
 */
export function resolveWorkspaceTimeline(input: {
  readonly studyView: StudyView | null;
  readonly reports: readonly HiveReport[] | null | undefined;
  readonly acceptedStudyRevisionId?: string | null;
  readonly authorizedSourceDocumentIds?: readonly string[];
  readonly authorizedDocumentPages?: Readonly<Record<string, number>>;
}): ResolvedWorkspaceTimeline {
  if (input.studyView && isStudyView(input.studyView)) {
    return {
      rows: [...timelineBlockRows(input.studyView)],
      source: "canonical",
      report: null,
    };
  }
  const candidates = orderedLatestApplicationReports(input.reports, input.acceptedStudyRevisionId);
  for (const report of candidates) {
    const rows = projectApplicationViewTimeline(report.view, {
      authorizedSourceDocumentIds: input.authorizedSourceDocumentIds,
      authorizedDocumentPages: input.authorizedDocumentPages,
    });
    if (rows.length > 0) {
      return {
        rows,
        source: "latest_report",
        report: attributionFromReport(report, false),
      };
    }
  }
  return { rows: [], source: "none", report: null };
}

/**
 * Timeline rows for Hive workspace: canonical study-view block when present, else saved report
 * Timeline components (latest Customer, then latest Pro) only when there is no study-view to display.
 */
export function resolveWorkspaceTimelineRows(input: {
  studyView: StudyView | null;
  reports: readonly HiveReport[] | null | undefined;
  acceptedStudyRevisionId?: string | null;
  authorizedSourceDocumentIds?: readonly string[];
  authorizedDocumentPages?: Readonly<Record<string, number>>;
}): StudyViewRow[] {
  return resolveWorkspaceTimeline(input).rows;
}

/**
 * Resolves workspace Timeline with same-revision historical report fallback for legacy studies:
 * 1. Canonical study-view Timeline takes strict precedence (never falls back when a study view exists).
 * 2. Latest Customer, then latest Pro application-view reports for the accepted revision.
 * 3. Newest saved historical report for the SAME accepted study revision with valid Timeline events.
 */
export async function resolveWorkspaceTimelineWithHistory(input: {
  readonly studyView: StudyView | null;
  readonly acceptedStudyRevisionId: string | null | undefined;
  readonly latest: readonly HiveReport[] | null | undefined;
  readonly history: readonly ReportSummary[] | null | undefined;
  readonly authorizedSourceDocumentIds?: readonly string[];
  readonly authorizedDocumentPages?: Readonly<Record<string, number>>;
  readonly loadHistoricalReport: (reportId: string) => Promise<HiveReport | null>;
  readonly maxHistoryLookups?: number;
}): Promise<ResolvedWorkspaceTimeline> {
  const immediate = resolveWorkspaceTimeline({
    studyView: input.studyView,
    reports: input.latest,
    acceptedStudyRevisionId: input.acceptedStudyRevisionId,
    authorizedSourceDocumentIds: input.authorizedSourceDocumentIds,
    authorizedDocumentPages: input.authorizedDocumentPages,
  });
  if (immediate.source === "canonical" || immediate.rows.length > 0) {
    return immediate;
  }

  const targetRevisionId = normalizeRevisionUuid(input.acceptedStudyRevisionId);
  if (!targetRevisionId) return immediate;

  const limit =
    typeof input.maxHistoryLookups === "number" && Number.isInteger(input.maxHistoryLookups) && input.maxHistoryLookups >= 0
      ? input.maxHistoryLookups
      : DEFAULT_MAX_HISTORY_LOOKUPS;
  const candidates = selectSameRevisionHistoricalReportCandidates({
    acceptedStudyRevisionId: targetRevisionId,
    latest: input.latest,
    history: input.history,
  }).slice(0, limit);

  for (const candidate of candidates) {
    const report = await input.loadHistoricalReport(candidate.id);
    if (!report || isStudyViewReport(report)) continue;
    if (report.id.trim().toLowerCase() !== candidate.id.trim().toLowerCase()) continue;
    if (report.studyRevisionId.trim().toLowerCase() !== targetRevisionId) continue;

    const rows = projectApplicationViewTimeline(report.view, {
      authorizedSourceDocumentIds: input.authorizedSourceDocumentIds,
      authorizedDocumentPages: input.authorizedDocumentPages,
    });
    if (rows.length > 0) {
      return {
        rows,
        source: "historical_report",
        report: attributionFromReport(report, true),
      };
    }
  }

  return { rows: [], source: "none", report: null };
}