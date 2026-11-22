/**
 * P0.4-A — Deterministic timeline rows for workspace surfaces.
 * Canonical `hive.study-view/1` timeline blocks take precedence; otherwise bound `Timeline` events
 * from saved `hive-application-view/1` reports. No synthesis from narrative or loose dates.
 */

import { parseCalendarDateToken } from "../analysis/canonical-finding-resolver";
import { isValidUuid } from "./hive-contracts";
import {
  APPLICATION_VIEW_SCHEMA,
  type ApplicationView,
  type ApplicationViewComponent,
  type BoundRef,
} from "../reports/application-view-contracts";
import { type ApplicationViewReport, type HiveReport, isStudyViewReport } from "../reports/report-contracts";
import { isStudyView, type StudyView, type StudyViewRow, type StudyViewValue } from "../pipeline/study-view-contracts";

function timelineBlockRows(view: StudyView | null): readonly StudyViewRow[] {
  return view?.blocks.find((block) => block.name === "timeline")?.rows ?? [];
}

function isResolvableRef(ref: BoundRef): boolean {
  const documentId = ref.sourceDocumentId.trim().toLowerCase();
  return isValidUuid(documentId) && Number.isInteger(ref.pageNumber) && ref.pageNumber >= 1 && ref.fileName.trim() !== "";
}

function authorizedDocumentIdSet(ids: readonly string[] | null | undefined): ReadonlySet<string> | null {
  if (!ids?.length) return null;
  return new Set(ids.map((id) => id.trim().toLowerCase()).filter((id) => isValidUuid(id)));
}

function isAuthorizedRef(ref: BoundRef, authorizedIds: ReadonlySet<string> | null): boolean {
  if (!isResolvableRef(ref)) return false;
  if (!authorizedIds || authorizedIds.size === 0) return true;
  return authorizedIds.has(ref.sourceDocumentId.trim().toLowerCase());
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
): StudyViewRow | null {
  const event = component.events[eventIndex];
  if (!event) return null;
  const statement = event.text.trim();
  if (statement === "") return null;
  const isoDate = parseCalendarDateToken(event.date);
  if (!isoDate) return null;
  const refs = event.refs.filter((ref) => isAuthorizedRef(ref, authorizedIds));
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
  options?: { readonly authorizedSourceDocumentIds?: readonly string[] },
): StudyViewRow[] {
  if (view.schema !== APPLICATION_VIEW_SCHEMA || !Array.isArray(view.components)) return [];
  const authorizedIds = authorizedDocumentIdSet(options?.authorizedSourceDocumentIds);
  const rows: StudyViewRow[] = [];
  view.components.forEach((component, componentIndex) => {
    if (component.component !== "Timeline") return;
    component.events.forEach((_, eventIndex) => {
      const row = eventRow(component, componentIndex, eventIndex, authorizedIds);
      if (row) rows.push(row);
    });
  });
  rows.sort((a, b) => {
    const byDate = (a.date ?? "").localeCompare(b.date ?? "");
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
  return rows;
}

function latestApplicationViewReport(reports: readonly HiveReport[] | null | undefined): ApplicationView | null {
  if (!reports?.length) return null;
  const saved = reports.filter((report): report is ApplicationViewReport => !isStudyViewReport(report));
  const customer = saved.find((report) => report.audience === "CUSTOMER");
  const pick = customer ?? saved[0] ?? null;
  return pick?.view ?? null;
}

/**
 * Timeline rows for Hive workspace: canonical study-view block when present, else saved report
 * Timeline components only when there is no study-view to display.
 */
export function resolveWorkspaceTimelineRows(input: {
  studyView: StudyView | null;
  reports: readonly HiveReport[] | null | undefined;
  authorizedSourceDocumentIds?: readonly string[];
}): StudyViewRow[] {
  if (input.studyView && isStudyView(input.studyView)) {
    return [...timelineBlockRows(input.studyView)];
  }
  const appView = latestApplicationViewReport(input.reports);
  if (!appView) return [];
  return projectApplicationViewTimeline(appView, {
    authorizedSourceDocumentIds: input.authorizedSourceDocumentIds,
  });
}