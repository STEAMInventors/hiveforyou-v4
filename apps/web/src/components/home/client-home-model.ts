import type { FindingsOpenItem, HiveBoardChecklistItem } from "@hiveforyou/contracts";

import { openItemForChecklistGap, stillToComeCount } from "@/components/hives/documents-page-model";
import { personFirstName } from "@/lib/hives/firm-board";

export function clientHomeLeadSentence(missingCount: number, staffDisplayName: string | null): string {
  if (missingCount > 0) {
    const noun = missingCount === 1 ? "thing" : "things";
    return `${missingCount} ${noun} left to send. Everything else is in.`;
  }
  const staffFirst = staffDisplayName?.trim() ? personFirstName(staffDisplayName) : "Your team";
  return `Everything we asked for is in. ${staffFirst} will be in touch.`;
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