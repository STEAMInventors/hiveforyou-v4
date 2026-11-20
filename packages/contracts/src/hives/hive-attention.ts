export const HIVE_KINDS = ["own", "client"] as const;
export type HiveKind = (typeof HIVE_KINDS)[number];

export type HiveAttentionLevel = "needs_you" | "in_progress" | "ready";

export type HiveAttentionReason =
  | "no_documents"
  | "unreadable"
  | "run_failed"
  | "reading"
  | "not_in_study"
  | "conflicts"
  | "to_review"
  | "missing"
  | "no_study"
  | "no_report"
  | "ready";

export type HiveAttentionCountKey = "needs" | "changed" | "missing" | "checked" | "unreadable";

export type HiveAttentionInput = {
  documentCount: number;
  unreadableDocumentCount: number;
  documentsNotReadCount: number;
  activeReadCount: number;
  processingRunFailed: boolean;
  processingRunActive: boolean;
  documentsNotInStudyCount: number;
  openConflicts: number;
  openNeeds: number;
  openChanged: number;
  openMissing: number;
  openChecked: number;
  hasStudy: boolean;
  hasReport: boolean;
};

export type HiveAttentionCounts = Partial<Record<HiveAttentionCountKey, number>>;

export type HiveAttentionResult = {
  level: HiveAttentionLevel;
  sentence: string;
  reason: HiveAttentionReason;
  counts: HiveAttentionCounts;
};

export type RankedHiveRef = {
  id: string;
  level: HiveAttentionLevel;
  lastActivityAt: string;
};

export type HiveListGroup = "review" | "reading" | "waiting" | "done";

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function nonZeroCounts(input: HiveAttentionInput): HiveAttentionCounts {
  const counts: HiveAttentionCounts = {};
  if (input.openNeeds > 0) counts.needs = input.openNeeds;
  if (input.openChanged > 0) counts.changed = input.openChanged;
  if (input.openMissing > 0) counts.missing = input.openMissing;
  if (input.openChecked > 0) counts.checked = input.openChecked;
  if (input.unreadableDocumentCount > 0) counts.unreadable = input.unreadableDocumentCount;
  return counts;
}

export function hiveAttention(input: HiveAttentionInput): HiveAttentionResult {
  const counts = nonZeroCounts(input);

  if (input.documentCount === 0) {
    return { level: "needs_you", sentence: "No documents yet.", reason: "no_documents", counts };
  }

  if (input.unreadableDocumentCount > 0) {
    return {
      level: "needs_you",
      sentence: `${plural(input.unreadableDocumentCount, "document could", "documents could")} not be read.`,
      reason: "unreadable",
      counts,
    };
  }

  if (input.processingRunFailed) {
    return {
      level: "needs_you",
      sentence: "The last run did not finish.",
      reason: "run_failed",
      counts,
    };
  }

  if (input.processingRunActive) {
    return { level: "in_progress", sentence: "Reading the documents.", reason: "reading", counts };
  }

  if (input.activeReadCount > 0 || input.documentsNotReadCount > 0) {
    return { level: "in_progress", sentence: "Reading the documents.", reason: "reading", counts };
  }

  if (input.documentsNotInStudyCount > 0) {
    return {
      level: "needs_you",
      sentence: `${plural(input.documentsNotInStudyCount, "document is", "documents are")} not yet in the study.`,
      reason: "not_in_study",
      counts,
    };
  }

  if (input.openConflicts > 0) {
    return {
      level: "needs_you",
      sentence: `${plural(input.openConflicts, "conflict to review", "conflicts to review")}.`,
      reason: "conflicts",
      counts,
    };
  }

  const needsYouItems = input.openNeeds + input.openChanged;
  if (needsYouItems > 0) {
    return {
      level: "needs_you",
      sentence: `${plural(needsYouItems, "item to review", "items to review")}.`,
      reason: "to_review",
      counts,
    };
  }

  if (input.openMissing > 0) {
    return {
      level: "needs_you",
      sentence: `${plural(input.openMissing, "item is", "items are")} missing.`,
      reason: "missing",
      counts,
    };
  }

  if (!input.hasStudy) {
    return { level: "needs_you", sentence: "No study yet.", reason: "no_study", counts };
  }

  if (!input.hasReport) {
    return { level: "needs_you", sentence: "No report yet.", reason: "no_report", counts };
  }

  return {
    level: "ready",
    sentence: "Everything is read and checked.",
    reason: "ready",
    counts,
  };
}

export function hiveListGroup(result: Pick<HiveAttentionResult, "reason">): HiveListGroup {
  if (result.reason === "reading") return "reading";
  if (result.reason === "no_documents" || result.reason === "missing") return "waiting";
  if (result.reason === "ready") return "done";
  return "review";
}

const LEVEL_RANK: Record<HiveAttentionLevel, number> = {
  needs_you: 0,
  in_progress: 1,
  ready: 2,
};

export function rankHives<T extends RankedHiveRef>(list: readonly T[]): T[] {
  const withIndex = list.map((item, index) => ({ item, index }));
  withIndex.sort((a, b) => {
    const levelDiff = LEVEL_RANK[a.item.level] - LEVEL_RANK[b.item.level];
    if (levelDiff !== 0) {
      return levelDiff;
    }
    const aTime = Date.parse(a.item.lastActivityAt);
    const bTime = Date.parse(b.item.lastActivityAt);
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);
    if (aValid && bValid && aTime !== bTime) {
      return bTime - aTime;
    }
    if (aValid !== bValid) {
      return aValid ? -1 : 1;
    }
    return a.index - b.index;
  });
  return withIndex.map((entry) => entry.item);
}

export function isHiveKind(value: unknown): value is HiveKind {
  return typeof value === "string" && (HIVE_KINDS as readonly string[]).includes(value);
}