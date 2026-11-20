import type { HiveAttentionResult } from "@hiveforyou/contracts";

export type HiveListSentenceCounts = {
  review: number;
  waiting: number;
  reading: number;
};

export function hiveListSentence(counts: HiveListSentenceCounts): string {
  const parts: string[] = [];
  if (counts.review > 0) {
    const noun = counts.review === 1 ? "hive has" : "hives have";
    parts.push(`${counts.review} ${noun} things to review.`);
  }
  if (counts.waiting > 0) {
    const verb = counts.waiting === 1 ? "is" : "are";
    parts.push(`${counts.waiting} ${verb} waiting on documents.`);
  }
  if (counts.reading > 0) {
    const verb = counts.reading === 1 ? "is" : "are";
    parts.push(`${counts.reading} ${verb} being read.`);
  }
  if (parts.length === 0) return "Everything is up to date.";
  return parts.join(" ");
}

export type HiveRowStatus = {
  state: "needs" | "changed" | "missing" | "unreadable" | "grey" | "leaf";
  label: string;
};

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sentenceWithoutStop(sentence: string): string {
  return sentence.replace(/\.\s*$/, "");
}

export function hiveRowStatuses(summary: HiveAttentionResult | undefined): HiveRowStatus[] {
  if (!summary) return [];
  const { counts, reason, sentence } = summary;
  const rows: HiveRowStatus[] = [];

  if (counts.needs && counts.needs > 0) {
    rows.push({ state: "needs", label: `${countLabel(counts.needs, "to review", "to review")}` });
  }
  if (counts.changed && counts.changed > 0) {
    rows.push({ state: "changed", label: `${countLabel(counts.changed, "changed", "changed")}` });
  }
  if (counts.missing && counts.missing > 0) {
    rows.push({ state: "missing", label: `${countLabel(counts.missing, "missing", "missing")}` });
  }
  if (counts.unreadable && counts.unreadable > 0) {
    rows.push({ state: "unreadable", label: `${countLabel(counts.unreadable, "unreadable", "unreadable")}` });
  }

  if (rows.length > 0) return rows;

  if (reason === "reading") {
    return [{ state: "grey", label: "Reading the documents" }];
  }
  if (reason === "no_documents") {
    return [{ state: "grey", label: "No documents yet" }];
  }
  if (reason === "run_failed" || reason === "no_study" || reason === "no_report") {
    return [{ state: "grey", label: sentenceWithoutStop(sentence) }];
  }
  if (reason === "ready") {
    return [{ state: "leaf", label: "Up to date" }];
  }

  return [{ state: "grey", label: sentenceWithoutStop(sentence) }];
}