import type { HiveSummary } from "@/server/hives/hive-summary";

export type HiveSidebarCounts = {
  toReviewCount: number | null;
  documents: number | null;
  reports: number | null;
  teamNotes: number | null;
  /** Hive board: messages from others the viewer has not read. */
  unreadMessages: number | null;
};

/** Badge count for Findings. Hidden when nothing is waiting, so the rail does not show a zero. */
export function findingsToReviewCount(summary: HiveSummary | null): number | null {
  if (!summary?.study?.counts) return null;
  const total = summary.study.counts.needs + summary.study.counts.changed;
  return total > 0 ? total : null;
}

function positiveOrNull(count: number | null | undefined): number | null {
  return typeof count === "number" && count > 0 ? count : null;
}

export function sidebarCounts(
  summary: HiveSummary | null,
  options: { reportCount: number | null; teamNotesCount: number | null; unreadMessageCount?: number | null },
): HiveSidebarCounts {
  const unreadMessages = positiveOrNull(options.unreadMessageCount);
  if (!summary) {
    return { toReviewCount: null, documents: null, reports: null, teamNotes: null, unreadMessages };
  }
  return {
    toReviewCount: findingsToReviewCount(summary),
    documents: positiveOrNull(summary.documentCount),
    reports: positiveOrNull(options.reportCount),
    teamNotes: positiveOrNull(options.teamNotesCount),
    unreadMessages,
  };
}

export function countAccessibleLabel(count: number, label: string): string {
  return `${count} ${label}`;
}
