import { isValidUuid } from "../hives/hive-contracts";
import type { ContractValidation } from "../source-documents/source-document-contracts";
import {
  normalizeReportRun,
  normalizeStudyRevisionSummary,
  type ReportRun,
  type StudyRevisionSummary,
} from "../study-preparation/study-preparation-contracts";
import {
  isStudyView,
  normalizeStudyViewSources,
  type StudyView,
  type StudyViewSources,
} from "../pipeline/study-view-contracts";
import { APPLICATION_VIEW_SCHEMA, type ApplicationView } from "./application-view-contracts";
import { REPORT_AUDIENCES, type ReportAudience, SCENARIO_ANALYSIS_SCHEMA, type ScenarioAnalysis } from "./writer-report-contracts";

/** Owner-facing report records. Both audiences are freely readable; there is no entitlement check. */
export type ReportSummary = {
  id: string;
  reportRunId: string;
  studyRevisionId: string;
  revisionNumber: number;
  audience: ReportAudience;
  title: string;
  createdAt: string;
};

/** A report on an `investigation-1` revision: A2UI view plus code-computed scenarios. */
export type ApplicationViewReport = ReportSummary & {
  view: ApplicationView;
  scenarioAnalysis: ScenarioAnalysis;
  modelAlias: string | null;
};

/** A report on a `canonical-study-1` revision: `hive.study-view/1` plus its citation index. */
export type StudyViewReport = ReportSummary & {
  view: StudyView;
  studyViewSources: StudyViewSources;
  modelAlias: string | null;
};

export type HiveReport = ApplicationViewReport | StudyViewReport;

export function isStudyViewReport(report: HiveReport): report is StudyViewReport {
  return isStudyView(report.view);
}

export type GetHiveReportsResponse = {
  studyRevision: StudyRevisionSummary | null;
  reportRuns: ReportRun[];
  /** Latest saved report per audience for the current revision. */
  latest: HiveReport[];
  history: ReportSummary[];
};

export type GenerateHiveReportRequest = {
  clientRequestId: string;
  studyRevisionId: string;
  audience: ReportAudience;
};

function isAudience(value: unknown): value is ReportAudience {
  return typeof value === "string" && (REPORT_AUDIENCES as readonly string[]).includes(value);
}

export function normalizeReportSummary(raw: unknown): ReportSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const ids = [record.id, record.reportRunId, record.studyRevisionId];
  if (ids.some((id) => typeof id !== "string" || !isValidUuid(id.toLowerCase()))) return null;
  if (
    !isAudience(record.audience) ||
    typeof record.title !== "string" ||
    typeof record.revisionNumber !== "number" ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: (record.id as string).toLowerCase(),
    reportRunId: (record.reportRunId as string).toLowerCase(),
    studyRevisionId: (record.studyRevisionId as string).toLowerCase(),
    revisionNumber: record.revisionNumber,
    audience: record.audience,
    title: record.title,
    createdAt: record.createdAt,
  };
}

export function normalizeHiveReport(raw: unknown): HiveReport | null {
  const summary = normalizeReportSummary(raw);
  if (!summary) return null;
  const record = raw as Record<string, unknown>;
  const modelAlias = typeof record.modelAlias === "string" ? record.modelAlias : null;
  if (isStudyView(record.view)) {
    return { ...summary, view: record.view, studyViewSources: normalizeStudyViewSources(record.studyViewSources), modelAlias };
  }
  const view = record.view as ApplicationView | undefined;
  const scenarioAnalysis = record.scenarioAnalysis as ScenarioAnalysis | undefined;
  if (
    !view ||
    view.schema !== APPLICATION_VIEW_SCHEMA ||
    view.audience !== summary.audience ||
    !Array.isArray(view.components) ||
    !scenarioAnalysis ||
    scenarioAnalysis.schema !== SCENARIO_ANALYSIS_SCHEMA ||
    !Array.isArray(scenarioAnalysis.scenarios)
  ) {
    return null;
  }
  return { ...summary, view, scenarioAnalysis, modelAlias };
}

export function normalizeGetHiveReportsResponse(raw: unknown): GetHiveReportsResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.reportRuns) || !Array.isArray(record.latest) || !Array.isArray(record.history)) return null;
  return {
    studyRevision: normalizeStudyRevisionSummary(record.studyRevision),
    reportRuns: record.reportRuns.map(normalizeReportRun).filter((run): run is ReportRun => run !== null),
    latest: record.latest.map(normalizeHiveReport).filter((report): report is HiveReport => report !== null),
    history: record.history.map(normalizeReportSummary).filter((report): report is ReportSummary => report !== null),
  };
}

export function validateGenerateHiveReportInput(body: unknown): ContractValidation<GenerateHiveReportRequest> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Request body must be a JSON object.", diagnosticReason: "invalid_payload_shape" };
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "clientRequestId" && key !== "studyRevisionId" && key !== "audience") {
      return { ok: false, message: `Unexpected field: ${key}.`, diagnosticReason: "unexpected_field" };
    }
  }
  const clientRequestId = typeof record.clientRequestId === "string" ? record.clientRequestId.trim().toLowerCase() : "";
  const studyRevisionId = typeof record.studyRevisionId === "string" ? record.studyRevisionId.trim().toLowerCase() : "";
  if (!isValidUuid(clientRequestId)) {
    return { ok: false, message: "clientRequestId must be a valid UUID.", diagnosticReason: "invalid_client_request_id" };
  }
  if (!isValidUuid(studyRevisionId)) {
    return { ok: false, message: "studyRevisionId must be a valid UUID.", diagnosticReason: "invalid_payload_shape" };
  }
  if (!isAudience(record.audience)) {
    return { ok: false, message: "audience must be CUSTOMER or PRO.", diagnosticReason: "invalid_payload_shape" };
  }
  return { ok: true, value: { clientRequestId, studyRevisionId, audience: record.audience } };
}
