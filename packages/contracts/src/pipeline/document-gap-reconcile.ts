/**
 * Pack-driven document gaps: dedupe by settles check, drop uploaded corpus matches,
 * intake prompts for conditional rows, and record-style reasons from the pack checklist.
 */

import type { CanonicalGap, CanonicalStudy } from "./canonical-study-contracts";
import type { Pack, PackCheck, PackDocumentExpectation } from "./pack-contracts";
import type { CanonicalChecklistItem } from "./pack-canonicalize";
import { inferGapHolderType } from "./canonical-gap-holders";
import { normalizeGapTitle } from "./gap-fill";

import type { DocumentIntakePrompt } from "./document-request-list-contracts";

const UNSETTLED = new Set(["NOT_SHOWN", "PARTLY_SHOWN"]);

const matchTokens = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length >= 3 || /\d/.test(token));

function tokenOverlapShare(needles: readonly string[], haystack: string): number {
  const hay = new Set(matchTokens(haystack));
  const need = matchTokens(needles.join(" "));
  if (need.length === 0) return 0;
  const shared = need.filter((token) => hay.has(token)).length;
  return shared / need.length;
}

function checksById(pack: Pack): Map<string, PackCheck> {
  return new Map(pack.checks.map((check) => [check.id, check]));
}

function unsettledCheckIds(checklist: readonly CanonicalChecklistItem[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const item of checklist ?? []) {
    if (UNSETTLED.has(item.verdict)) out.add(item.checkId);
  }
  return out;
}

export function recordReasonForCheck(pack: Pack, checkId: string): string {
  const def = checksById(pack).get(checkId);
  if (!def?.check) return "";
  const text = def.check.trim();
  return text === "" ? "" : `These documents don't show: ${text}`;
}

function mergeReasons(...parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const text = part.replace(/\s+/g, " ").trim();
    if (text === "" || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out.join(" ");
}

function packRowForTitle(pack: Pack, title: string): PackDocumentExpectation | undefined {
  const key = normalizeGapTitle(title);
  return pack.documentsUsuallyNeeded.find((row) => normalizeGapTitle(row.document) === key);
}

export function inferGapSettlesCheckIds(gap: CanonicalGap, pack: Pack): string[] {
  if ((gap.settlesCheckIds?.length ?? 0) > 0) return [...gap.settlesCheckIds!];
  const row = packRowForTitle(pack, gap.title || gap.statement);
  return row ? [...row.settlesCheckIds] : [];
}

function gapFromPackRow(row: PackDocumentExpectation, checkId: string, pack: Pack, id: string): CanonicalGap | null {
  if (!row.settlesCheckIds.includes(checkId)) return null;
  const title = row.document.trim();
  if (title === "") return null;
  const kind = row.gapKind;
  const holderType =
    kind === "REQUESTABLE_DOCUMENT"
      ? row.holderType ??
        inferGapHolderType({
          kind,
          holder: row.holder,
          title,
          statement: title,
          holderType: row.holderType,
        })
      : null;
  const why = recordReasonForCheck(pack, checkId);
  return {
    id,
    statement: `The case does not include: ${title}.`,
    relatedSpineIds: [],
    kind,
    title,
    why: why || `These documents don't show what the checklist asks for (${checkId}).`,
    holder: row.holder,
    holderType,
    when: row.when || null,
    basisType: "USUALLY_EXPECTED",
    relatedFactIds: [],
    settlesCheckIds: [...row.settlesCheckIds],
  };
}

function splitDocumentParts(documentName: string): string[] {
  return documentName
    .split(/\s*;\s*|\s+and\s+/i)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function corpusText(study: CanonicalStudy): string {
  return study.documents.map((document) => document.typeInPlainWords.trim()).join(" ").toLowerCase();
}

/** Whether the uploaded inventory already covers this expectation (whole or in part). */
export function documentExpectationCoverage(
  expectation: string,
  study: CanonicalStudy,
): { satisfied: boolean; remainingTitle?: string } {
  const corpus = corpusText(study);
  if (corpus.trim() === "") return { satisfied: false };
  const parts = splitDocumentParts(expectation);
  if (parts.length === 0) return { satisfied: false };
  const missing = parts.filter((part) => tokenOverlapShare([part], corpus) < 0.55);
  if (missing.length === 0) return { satisfied: true };
  if (missing.length === parts.length) return { satisfied: false };
  return { satisfied: false, remainingTitle: missing.join("; ") };
}

function dropSatisfiedExpectations(gaps: CanonicalGap[], study: CanonicalStudy): CanonicalGap[] {
  const out: CanonicalGap[] = [];
  for (const gap of gaps) {
    if (gap.kind !== "REQUESTABLE_DOCUMENT") {
      out.push(gap);
      continue;
    }
    const title = gap.title.trim() !== "" ? gap.title : gap.statement;
    const coverage = documentExpectationCoverage(title, study);
    if (coverage.satisfied) continue;
    if (coverage.remainingTitle && coverage.remainingTitle !== title) {
      out.push({
        ...gap,
        title: coverage.remainingTitle,
        statement: `The case does not include: ${coverage.remainingTitle}.`,
      });
      continue;
    }
    out.push(gap);
  }
  return out;
}

function isIntakeWhen(when: string): boolean {
  return when.trim().toLowerCase().startsWith("if any");
}

function shareCheck(a: CanonicalGap, b: CanonicalGap, pack: Pack): boolean {
  const aChecks = new Set(inferGapSettlesCheckIds(a, pack));
  const bChecks = new Set(inferGapSettlesCheckIds(b, pack));
  if (aChecks.size === 0 || bChecks.size === 0) {
    const aTitle = normalizeGapTitle(a.title || a.statement);
    const bTitle = normalizeGapTitle(b.title || b.statement);
    return aTitle !== "" && aTitle === bTitle;
  }
  return [...aChecks].some((id) => bChecks.has(id));
}

function mergeGapPair(a: CanonicalGap, b: CanonicalGap, pack: Pack, preferPackTitle: boolean): CanonicalGap {
  const aPackRow = !!packRowForTitle(pack, a.title);
  const bPackRow = !!packRowForTitle(pack, b.title);
  const packGap = preferPackTitle || bPackRow ? (bPackRow ? b : a) : a;
  const other = packGap === a ? b : a;
  const settles = [...new Set([...inferGapSettlesCheckIds(packGap, pack), ...inferGapSettlesCheckIds(other, pack)])];
  const title =
    packRowForTitle(pack, packGap.title)?.document.trim() ||
    packRowForTitle(pack, other.title)?.document.trim() ||
  packGap.title.trim() ||
    other.title.trim();
  return {
    ...packGap,
    id: packGap.id || other.id,
    title,
    statement: packGap.statement || other.statement,
    why: mergeReasons(packGap.why, other.why),
    holder: packGap.holder || other.holder,
    holderType: packGap.holderType ?? other.holderType,
    settlesCheckIds: settles,
  };
}

function consolidateBySettlesChecks(gaps: CanonicalGap[], pack: Pack, packGapIds: ReadonlySet<string>): CanonicalGap[] {
  let list = [...gaps];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (!shareCheck(a, b, pack)) continue;
        const preferPack = packGapIds.has(b.id) && !packGapIds.has(a.id);
        const merged = mergeGapPair(a, b, pack, preferPack);
        list = list.filter((_, index) => index !== i && index !== j);
        list.push(merged);
        changed = true;
        break outer;
      }
    }
  }
  return list;
}

function enrichModelGap(gap: CanonicalGap, pack: Pack): CanonicalGap {
  const settlesCheckIds = inferGapSettlesCheckIds(gap, pack);
  const row = packRowForTitle(pack, gap.title || gap.statement);
  const whyFromChecks = settlesCheckIds.map((checkId) => recordReasonForCheck(pack, checkId));
  const why =
    gap.why.trim() !== "" && !/may help show whether the related item is supported/i.test(gap.why)
      ? gap.why
      : mergeReasons(...whyFromChecks);
  return {
    ...gap,
    ...(row && gap.title.trim() === "" ? { title: row.document, holder: gap.holder || row.holder } : {}),
    why,
    ...(settlesCheckIds.length > 0 ? { settlesCheckIds } : {}),
  };
}

export function reconcilePackDocumentGaps(
  study: CanonicalStudy,
  pack: Pack,
): { study: CanonicalStudy; intakePrompts: DocumentIntakePrompt[] } {
  const unsettled = unsettledCheckIds(study.checklist);
  const intakePrompts: DocumentIntakePrompt[] = [];
  let promptId = 1;

  const observations = study.gaps.filter((gap) => gap.kind === "OBSERVATION");
  const requestGaps = study.gaps.filter((gap) => gap.kind !== "OBSERVATION").map((gap) => enrichModelGap(gap, pack));

  const occupiedChecks = new Set<string>();
  for (const gap of requestGaps) {
    for (const id of inferGapSettlesCheckIds(gap, pack)) occupiedChecks.add(id);
  }

  const packGapIds = new Set<string>();
  let nextId = study.gaps.length + 1;
  const packGaps: CanonicalGap[] = [];

  for (const item of study.checklist ?? []) {
    if (!unsettled.has(item.checkId)) continue;
    for (const row of pack.documentsUsuallyNeeded) {
      if (!row.settlesCheckIds.includes(item.checkId)) continue;
      if (isIntakeWhen(row.when)) {
        intakePrompts.push({ id: `I-${promptId++}`, text: row.document.trim() });
        continue;
      }
      const already = [...row.settlesCheckIds].every((id) => !unsettled.has(id) || occupiedChecks.has(id));
      if (already && row.settlesCheckIds.includes(item.checkId) && occupiedChecks.has(item.checkId)) continue;
      if (occupiedChecks.has(item.checkId)) continue;
      const gap = gapFromPackRow(row, item.checkId, pack, `X${nextId++}`);
      if (!gap) continue;
      packGapIds.add(gap.id);
      for (const id of row.settlesCheckIds) occupiedChecks.add(id);
      packGaps.push(gap);
    }
  }

  const consolidated = consolidateBySettlesChecks([...requestGaps, ...packGaps], pack, packGapIds);
  const filtered = dropSatisfiedExpectations(consolidated, study);

  return {
    study: { ...study, gaps: [...observations, ...filtered] },
    intakePrompts,
  };
}

/** Merge pack-driven gaps for unsettled checks; dedupe by settles check, not document title. */
export function mergePackSettlesGaps(
  study: CanonicalStudy,
  pack: Pack,
  checklist: readonly CanonicalChecklistItem[],
): CanonicalStudy {
  void checklist;
  return reconcilePackDocumentGaps(study, pack).study;
}
