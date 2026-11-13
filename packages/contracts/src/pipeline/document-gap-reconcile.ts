/**
 * Pack-driven document gaps: one request per document, drop uploaded corpus matches,
 * intake prompts for conditional rows, and record-style reasons from the pack checklist.
 */

import type { CanonicalGap, CanonicalStudy } from "./canonical-study-contracts";
import type { Pack, PackAudience, PackCheck, PackDocumentExpectation } from "./pack-contracts";
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

function recordReasonText(pack: Pack, checkId: string, audience: PackAudience | "professional" = "professional"): string {
  const def = checksById(pack).get(checkId);
  if (!def) return "";
  const text = (audience === "customer" ? def.question || def.check : def.check).replace(/\s+/g, " ").trim();
  return text;
}

export function recordReasonForCheck(pack: Pack, checkId: string, audience: PackAudience | "professional" = "professional"): string {
  const text = recordReasonText(pack, checkId, audience);
  return text === "" ? "" : `These documents don't show: ${text}`;
}

/** One lead line plus check texts for request-list bullets (no repeated lead). */
export function recordReasonsForChecks(
  pack: Pack,
  checkIds: readonly string[],
  audience: PackAudience | "professional" = "professional",
): { lead: string; bullets: string[] } {
  const lead = "These documents don't show:";
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const checkId of checkIds) {
    const text = recordReasonText(pack, checkId, audience);
    if (text === "") continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(text);
  }
  return { lead, bullets };
}

export function formatRecordReasonsForChecks(
  pack: Pack,
  checkIds: readonly string[],
  audience: PackAudience | "professional" = "professional",
): string {
  const { lead, bullets } = recordReasonsForChecks(pack, checkIds, audience);
  if (bullets.length === 0) return "";
  if (bullets.length === 1) return `${lead} ${bullets[0]}`;
  return `${lead}\n${bullets.map((line) => `• ${line}`).join("\n")}`;
}

/** Parses multi-check reasons produced by {@link formatRecordReasonsForChecks}. */
export function parseDocumentRequestWhy(why: string): { lead: string; bullets: string[] } | { plain: string } {
  const text = why.replace(/\r\n/g, "\n").trim();
  if (text === "") return { plain: "" };
  const lead = "These documents don't show:";
  if (!text.startsWith(lead)) return { plain: text };
  const rest = text.slice(lead.length).trim();
  const lines = text.includes("\n")
    ? text
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/^\s*[•\-]\s*/, "").trim())
        .filter((line) => line !== "")
    : [];
  if (lines.length > 0) return { lead, bullets: lines };
  if (rest !== "") return { lead, bullets: [rest] };
  return { plain: text };
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

/** Model gap title tokens are contained in the pack row name (generic; no domain terms). */
export function findPackRowForModelGap(gap: CanonicalGap, pack: Pack): PackDocumentExpectation | undefined {
  const exact = packRowForTitle(pack, gap.title || gap.statement);
  if (exact) return exact;
  const probe = (gap.title || gap.statement).trim();
  if (probe === "") return undefined;
  const gapTokens = matchTokens(probe);
  if (gapTokens.length === 0) return undefined;
  const gapSettles = gap.settlesCheckIds ?? [];
  let best: PackDocumentExpectation | undefined;
  let bestScore = 0;
  for (const row of pack.documentsUsuallyNeeded) {
    const rowHaystack = row.document.toLowerCase();
    if (gapSettles.length > 0 && gapSettles.some((checkId) => row.settlesCheckIds.includes(checkId))) {
      if (gapTokens.some((token) => rowHaystack.includes(token))) return row;
    }
    const shared = gapTokens.filter((token) => rowHaystack.includes(token)).length;
    if (shared === 0) continue;
    const score = shared / gapTokens.length;
    if (score > bestScore || (score === bestScore && row.document.length < (best?.document.length ?? Number.MAX_SAFE_INTEGER))) {
      bestScore = score;
      best = row;
    }
    if (shared === gapTokens.length && gapTokens.every((token) => rowHaystack.includes(token))) {
      return row;
    }
  }
  return bestScore >= 0.6 ? best : undefined;
}

export function inferGapSettlesCheckIds(gap: CanonicalGap, pack: Pack): string[] {
  if ((gap.settlesCheckIds?.length ?? 0) > 0) return [...gap.settlesCheckIds!];
  const row = packRowForTitle(pack, gap.title || gap.statement) ?? findPackRowForModelGap(gap, pack);
  return row ? [...row.settlesCheckIds] : [];
}

const GENERIC_WHY = /may help show whether the related item is supported|what the checklist asks for/i;

function isMoreSpecificWhy(candidate: string, fallback: string): boolean {
  const a = candidate.replace(/\s+/g, " ").trim();
  const b = fallback.replace(/\s+/g, " ").trim();
  if (a === "" || GENERIC_WHY.test(a)) return false;
  if (b === "" || GENERIC_WHY.test(b)) return true;
  return a.length > b.length + 8;
}

function gapFromPackRow(row: PackDocumentExpectation, pack: Pack, id: string, unsettled: Set<string>): CanonicalGap | null {
  const settles = row.settlesCheckIds.filter((checkId) => unsettled.has(checkId));
  if (settles.length === 0) return null;
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
  const why = formatRecordReasonsForChecks(pack, settles);
  return {
    id,
    statement: `The case does not include: ${title}.`,
    relatedSpineIds: [],
    kind,
    title,
    why: why || `These documents don't show what the checklist asks for (${settles[0]}).`,
    holder: row.holder,
    holderType,
    when: row.when || null,
    basisType: "USUALLY_EXPECTED",
    relatedFactIds: [],
    settlesCheckIds: settles,
  };
}

function splitDocumentParts(documentName: string): string[] {
  return documentName
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function corpusDocumentTypes(study: CanonicalStudy): readonly string[] {
  return study.documents.map((document) => document.typeInPlainWords.trim()).filter((text) => text !== "");
}

function corpusText(study: CanonicalStudy): string {
  return corpusDocumentTypes(study).join(" ").toLowerCase();
}

function uploadRowForExpectation(study: CanonicalStudy, expectation: string) {
  const key = normalizeGapTitle(expectation);
  return (study.uploadSatisfaction ?? []).find((row) => normalizeGapTitle(row.document) === key);
}

function partSatisfiedByUpload(study: CanonicalStudy, part: string, expectation: string): boolean {
  const row = uploadRowForExpectation(study, expectation);
  if (!row) return false;
  const match = row.parts.find((item) => item.part.trim().toLowerCase() === part.trim().toLowerCase());
  return match !== undefined && match.satisfiedBy !== null && match.factId !== null;
}

/** Whether the uploaded inventory already covers this expectation (whole or in part). */
export function documentExpectationCoverage(
  expectation: string,
  study: CanonicalStudy,
): { satisfied: boolean; remainingTitle?: string } {
  const parts = splitDocumentParts(expectation);
  if (parts.length === 0) return { satisfied: false };
  if ((study.uploadSatisfaction ?? []).length > 0) {
    const missing = parts.filter((part) => !partSatisfiedByUpload(study, part, expectation));
    if (missing.length === 0) return { satisfied: true };
    if (missing.length === parts.length) return { satisfied: false };
    return { satisfied: false, remainingTitle: missing.join("; ") };
  }
  return { satisfied: false, remainingTitle: expectation };
}

/** @deprecated Token overlap removed; kept for tests calling legacy API. */
export function documentPartSatisfied(_part: string, _study: CanonicalStudy): boolean {
  return false;
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

function isAskLaterWhen(when: string | null | undefined): boolean {
  const text = when?.trim().toLowerCase() ?? "";
  return text.includes("later") || text.startsWith("if ") || text.startsWith("each ");
}

function documentIdentityKey(gap: CanonicalGap, pack: Pack): string {
  const row = packRowForTitle(pack, gap.title) ?? findPackRowForModelGap(gap, pack);
  const title = (row?.document ?? gap.title ?? gap.statement).trim();
  return normalizeGapTitle(title);
}

function mergeDocumentPair(a: CanonicalGap, b: CanonicalGap, pack: Pack, packGapIds: ReadonlySet<string>): CanonicalGap {
  const rowA = packRowForTitle(pack, a.title) ?? findPackRowForModelGap(a, pack);
  const rowB = packRowForTitle(pack, b.title) ?? findPackRowForModelGap(b, pack);
  const packRow = rowA ?? rowB;
  const fromPack = packGapIds.has(a.id) ? a : packGapIds.has(b.id) ? b : a;
  const fromModel = fromPack === a ? b : a;
  const title = (packRow?.document ?? fromPack.title ?? fromModel.title).trim();
  const settles = [...new Set([...inferGapSettlesCheckIds(fromPack, pack), ...inferGapSettlesCheckIds(fromModel, pack)])];
  const packWhy = fromPack.why;
  const modelWhy = fromModel.why;
  const why = isMoreSpecificWhy(modelWhy, packWhy) ? modelWhy : isMoreSpecificWhy(packWhy, modelWhy) ? packWhy : mergeReasons(modelWhy, packWhy);
  const when =
    !isAskLaterWhen(fromPack.when) || isAskLaterWhen(fromModel.when) ? fromPack.when ?? fromModel.when : fromModel.when;
  return {
    ...fromPack,
    id: fromPack.id || fromModel.id,
    title,
    statement: fromPack.statement || fromModel.statement,
    why,
    holder: (packRow?.holder ?? fromPack.holder) || fromModel.holder,
    holderType: fromPack.holderType ?? fromModel.holderType,
    when: when ?? null,
    settlesCheckIds: settles,
  };
}

function consolidateByDocumentTitle(gaps: CanonicalGap[], pack: Pack, packGapIds: ReadonlySet<string>): CanonicalGap[] {
  const buckets = new Map<string, CanonicalGap[]>();
  for (const gap of gaps) {
    const key = documentIdentityKey(gap, pack);
    if (key === "") {
      const lone = buckets.get("__none__") ?? [];
      lone.push(gap);
      buckets.set("__none__", lone);
      continue;
    }
    const list = buckets.get(key) ?? [];
    list.push(gap);
    buckets.set(key, list);
  }
  const out: CanonicalGap[] = [];
  for (const [key, list] of buckets) {
    if (key === "__none__" || list.length === 1) {
      out.push(...list);
      continue;
    }
    let merged = list[0]!;
    for (let i = 1; i < list.length; i++) {
      merged = mergeDocumentPair(merged, list[i]!, pack, packGapIds);
    }
    out.push(merged);
  }
  return out;
}

function enrichModelGap(gap: CanonicalGap, pack: Pack): CanonicalGap {
  const row = findPackRowForModelGap(gap, pack) ?? packRowForTitle(pack, gap.title || gap.statement);
  const settlesCheckIds = inferGapSettlesCheckIds({
    ...gap,
    ...(row ? { title: row.document, settlesCheckIds: gap.settlesCheckIds ?? row.settlesCheckIds } : {}),
  }, pack);
  const whyFromChecks = formatRecordReasonsForChecks(pack, settlesCheckIds);
  const why =
    gap.why.trim() !== "" && !GENERIC_WHY.test(gap.why) ? gap.why : whyFromChecks;
  return {
    ...gap,
    ...(row ? { title: row.document, holder: gap.holder.trim() !== "" ? gap.holder : row.holder, when: gap.when ?? row.when ?? null } : {}),
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

  const packGapIds = new Set<string>();
  let nextId = study.gaps.length + 1;
  const packGaps: CanonicalGap[] = [];
  const addedPackRows = new Set<string>();

  for (const row of pack.documentsUsuallyNeeded) {
    const settlesUnsettled = row.settlesCheckIds.filter((checkId) => unsettled.has(checkId));
    if (settlesUnsettled.length === 0) continue;
    const rowKey = normalizeGapTitle(row.document);
    if (isIntakeWhen(row.when)) {
      intakePrompts.push({ id: `I-${promptId++}`, text: row.document.trim() });
      continue;
    }
    if (addedPackRows.has(rowKey)) continue;
    const coverage = documentExpectationCoverage(row.document, study);
    if (coverage.satisfied) continue;
    const gap = gapFromPackRow(
      coverage.remainingTitle && coverage.remainingTitle !== row.document
        ? { ...row, document: coverage.remainingTitle }
        : row,
      pack,
      `X${nextId++}`,
      unsettled,
    );
    if (!gap) continue;
    packGapIds.add(gap.id);
    addedPackRows.add(rowKey);
    packGaps.push(gap);
  }

  const consolidated = consolidateByDocumentTitle([...requestGaps, ...packGaps], pack, packGapIds);
  const filtered = dropSatisfiedExpectations(consolidated, study);

  return {
    study: { ...study, gaps: [...observations, ...filtered] },
    intakePrompts,
  };
}

/** Merge pack-driven gaps; dedupe by document identity, not by check. */
export function mergePackSettlesGaps(
  study: CanonicalStudy,
  pack: Pack,
  checklist: readonly CanonicalChecklistItem[],
): CanonicalStudy {
  void checklist;
  return reconcilePackDocumentGaps(study, pack).study;
}
