import type { StudyRevisionFormat } from "@hiveforyou/contracts";

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

/** Shown above timeline rows pinned to a saved report on a non-canonical revision. */
export function legacySavedReportTimelineNotice(revisionNumber: number): string {
  return `These dates are from your saved Study v${revisionNumber} report. They are not from the current canonical study view.`;
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
