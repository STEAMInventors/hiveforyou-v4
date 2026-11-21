import type { FindingsOpenItem, FindingsTopic, HiveBoardChecklistItem } from "@hiveforyou/contracts";

import { openItemForChecklistGap, stillToComeCount } from "@/components/hives/documents-page-model";
import { personFirstName } from "@/lib/hives/firm-board";

export type ClientHomeProgress = { in: number; total: number };

export function hiveStatementCount(topics: readonly FindingsTopic[]): number {
  return topics.reduce((sum, topic) => sum + topic.statements.length, 0);
}

export function clientHomeLeadSentence(
  progress: ClientHomeProgress | null,
  missingCount: number,
  staffDisplayName: string | null,
): string {
  const meterRemaining =
    progress && progress.total > 0 ? Math.max(0, progress.total - progress.in) : null;
  const outstanding = meterRemaining != null && meterRemaining > 0 ? meterRemaining : missingCount;
  if (outstanding > 0) {
    const noun = outstanding === 1 ? "thing" : "things";
    return `${outstanding} ${noun} left to send. Everything else is in.`;
  }
  const staffFirst = staffDisplayName?.trim() ? personFirstName(staffDisplayName) : "Your team";
  return `Everything we asked for is in. ${staffFirst} will be in touch.`;
}

/** Client-facing line when the accepted study is not on canonical view yet — no staff actions. */
export function clientHomeOlderStudyLine(staffDisplayName: string | null): string {
  const staffFirst = staffDisplayName?.trim() ? personFirstName(staffDisplayName) : null;
  return staffFirst
    ? `${staffFirst}'s team is still reviewing your documents.`
    : "Your team is still reviewing your documents.";
}

export function stillToSendSectionCount(checklist: readonly HiveBoardChecklistItem[]): number {
  return stillToComeCount(checklist);
}

export function rowWhyDetail(item: HiveBoardChecklistItem, openItems: readonly FindingsOpenItem[]): string {
  const linked = openItemForChecklistGap(item.gapId, openItems);
  const why = linked?.question?.trim();
  if (why && why !== item.title.trim()) return why;
  const text = item.statusText.trim();
  return text && text !== "Not in yet." ? text : "";
}