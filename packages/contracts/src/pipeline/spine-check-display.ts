import type { CanonicalStudy, SpineElement } from "./canonical-study-contracts";
import type { Pack, PackCheck } from "./pack-contracts";
import type { CanonicalChecklistItem } from "./pack-canonicalize";
import { checklistVerdictLabel } from "./check-verdict-display";
import { inferGapSettlesCheckIds } from "./document-gap-reconcile";

const ISSUE_VERDICTS = new Set(["NOT_SHOWN", "PARTLY_SHOWN", "CONFLICT"]);

const VERDICT_ISSUE_PREFIX: Record<string, string> = {
  NOT_SHOWN: "Not shown",
  PARTLY_SHOWN: "Partly shown",
  CONFLICT: "Conflict",
};

const VERDICT_RANK: Record<string, number> = {
  CONFLICT: 0,
  NOT_SHOWN: 1,
  PARTLY_SHOWN: 2,
};

function checkById(pack: Pack): Map<string, PackCheck> {
  return new Map(pack.checks.map((check) => [check.id, check]));
}

function checklistById(study: CanonicalStudy): Map<string, CanonicalChecklistItem> {
  return new Map((study.checklist ?? []).map((item) => [item.checkId, item]));
}

export function formatCheckIssueLine(
  verdict: string,
  note: string | undefined,
  checkText: string,
): string {
  const key = verdict.trim().toUpperCase();
  const prefix = VERDICT_ISSUE_PREFIX[key] ?? checklistVerdictLabel(verdict) ?? "Not shown";
  const trimmedNote = note?.replace(/\s+/g, " ").trim() ?? "";
  const check = checkText.replace(/\s+/g, " ").trim();
  if (trimmedNote !== "") return `${prefix}: ${trimmedNote}`;
  if (check === "") return `${prefix}:`;
  return `${prefix}: These documents don't show: ${check}`;
}

export function checkIdsLinkedToSpine(study: CanonicalStudy, pack: Pack, spineId: string): string[] {
  const checkIds = new Set<string>();
  for (const gap of study.gaps) {
    if (!gap.relatedSpineIds.includes(spineId)) continue;
    for (const id of inferGapSettlesCheckIds(gap, pack)) checkIds.add(id);
  }
  return [...checkIds];
}

export function worstCheckVerdict(verdicts: readonly string[]): string | null {
  let best: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const verdict of verdicts) {
    const key = verdict.trim().toUpperCase();
    if (!ISSUE_VERDICTS.has(key)) continue;
    const rank = VERDICT_RANK[key] ?? 99;
    if (rank < bestRank) {
      bestRank = rank;
      best = key;
    }
  }
  return best;
}

export type SpineCheckAnnotation = {
  readonly issueLines: readonly string[];
  readonly displayVerdict: string | null;
};

export function spineCheckAnnotation(
  study: CanonicalStudy,
  pack: Pack,
  element: SpineElement,
): SpineCheckAnnotation {
  const checks = checkById(pack);
  const checklist = checklistById(study);
  const linked = checkIdsLinkedToSpine(study, pack, element.id);
  const issueLines: string[] = [];
  const verdicts: string[] = [];
  const seenIssue = new Set<string>();

  for (const checkId of linked) {
    const item = checklist.get(checkId);
    if (!item || !ISSUE_VERDICTS.has(item.verdict)) continue;
    const def = checks.get(checkId);
    const line = formatCheckIssueLine(item.verdict, item.note, def?.check ?? checkId);
    const key = line.toLowerCase();
    if (seenIssue.has(key)) continue;
    seenIssue.add(key);
    issueLines.push(line);
    verdicts.push(item.verdict);
  }

  return { issueLines, displayVerdict: worstCheckVerdict(verdicts) };
}
