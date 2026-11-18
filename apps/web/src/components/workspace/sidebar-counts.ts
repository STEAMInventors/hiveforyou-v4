import type { HiveSummary } from "@/server/hives/hive-summary";

export type HiveSidebarCounts = {
  toReviewCount: number | null;
  documents: number | null;
  reports: number | null;
  teamNotes: number | null;
};

/** Badge count for Findings. Hidden when nothing is waiting, so the rail does not show a zero. */
export function findingsToReviewCount(summary: HiveSummary | null): number | null {
  if (!summary?.study?.counts) return null;
  const total = summary.study.counts.needs + summary.study.counts.changed;
  return total > 0 ? total : null;
}

export function sidebarCounts(
  summary: HiveSummary | null,
  options: { reportCount: number | null; teamNotesCount: number | null },
): HiveSidebarCounts {
  if (!summary) {
    return { toReviewCount: null, documents: null, reports: null, teamNotes: null };
  }
  const documents = summary.documentCount > 0 ? summary.documentCount : null;
  const reports = options.reportCount !== null && options.reportCount > 0 ? options.reportCount : null;
  const teamNotes =
    options.teamNotesCount !== null && options.teamNotesCount > 0 ? options.teamNotesCount : null;
  return {
    toReviewCount: findingsToReviewCount(summary),
    documents,
    reports,
    teamNotes,
  };
}

export function countAccessibleLabel(count: number, label: string): string {
  return `${count} ${label}`;
}
