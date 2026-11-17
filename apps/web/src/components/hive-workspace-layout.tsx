import type { HiveSummary } from "@/server/hives/hive-summary";

/** Meta line for hive list cards (documents · attention sentence). */
export function hiveMetaLine(summary: HiveSummary): string {
  const documents = `${summary.documentCount} ${summary.documentCount === 1 ? "document" : "documents"}`;
  return `${documents} · ${summary.attention.sentence}`;
}