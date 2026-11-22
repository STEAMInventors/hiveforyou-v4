import type { StudyRevisionFormat, TimelineReportAttribution } from "@hiveforyou/contracts";

import type { StudyLoadError } from "@/server/hives/hive-summary";

export type StudyAvailability =
  | { kind: "none" }
  | { kind: "older"; revisionNumber: number }
  | { kind: "load_error"; error: StudyLoadError }
  | { kind: "canonical" };

export function studyAvailability(input: {
  revision: { revisionNumber: number; format?: StudyRevisionFormat } | null;
  hasCanonicalView: boolean;
  studyLoadError: StudyLoadError | null;
}): StudyAvailability {
  if (!input.revision) return { kind: "none" };
  if (input.studyLoadError) return { kind: "load_error", error: input.studyLoadError };
  const format = input.revision.format;
  if (format !== "canonical-study-1" || !input.hasCanonicalView) {
    return { kind: "older", revisionNumber: input.revision.revisionNumber };
  }
  return { kind: "canonical" };
}

export const OLDER_STUDY_NOTICE =
  "This hive was read with an earlier version of HiveForYou. Rebuild the study to see what the documents show and what is still missing.";

const REPORT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatReportSavedDate(createdAt: string): string | null {
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return null;
  return REPORT_DATE_FORMAT.format(new Date(ms));
}

function reportAudienceLabel(audience: TimelineReportAttribution["audience"]): string {
  return audience === "PRO" ? "Pro" : "Customer";
}

/** Shown above timeline rows pinned to a saved report on a non-canonical revision. */
export function legacySavedReportTimelineNotice(
  revisionNumber: number,
  report?: TimelineReportAttribution | null,
): string {
  if (!report) {
    return `These dates are from your saved Study v${revisionNumber} report. They are not from the current canonical study view.`;
  }
  const audience = reportAudienceLabel(report.audience);
  const title = report.title.trim();
  const savedDate = formatReportSavedDate(report.createdAt);
  const details: string[] = [];
  if (title) details.push(`“${title}”`);
  if (savedDate) details.push(`saved ${savedDate}`);
  const detailSuffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  if (report.fromHistory) {
    return `Showing dates from an earlier saved Study v${report.revisionNumber} ${audience} report${detailSuffix} because the latest reports for this revision do not include a timeline. They are not from the current canonical study view.`;
  }
  return `These dates are from your saved Study v${report.revisionNumber} ${audience} report${detailSuffix}. They are not from the current canonical study view.`;
}

export function legacySavedReportTimelineEmpty(revisionNumber: number): string {
  return `No dated events in the saved Study v${revisionNumber} report.`;
}

/**
 * Idle copy on Timeline when an older revision has no timeline rows (rebuild UI is separate for firm staff).
 */
export function timelineOlderStudyIdleLine(input: {
  staffView: boolean;
  viewerIsClient: boolean;
  staffDisplayName: string | null;
}): string {
  if (input.viewerIsClient) {
    const staffFirst = input.staffDisplayName?.trim()
      ? input.staffDisplayName.trim().split(/\s+/)[0]
      : null;
    return staffFirst
      ? `${staffFirst}'s team is still reviewing your documents.`
      : "Your documents are still being reviewed.";
  }
  if (input.staffView) return "";
  return "This hive has an accepted study from an earlier version of HiveForYou. Open Documents to rebuild when you want the updated study view.";
}
