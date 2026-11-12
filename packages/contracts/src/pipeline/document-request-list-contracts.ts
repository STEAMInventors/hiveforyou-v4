/**
 * `DocumentRequestList` for `hive.study-view/1`: code-built items from canonical gaps; the write model may
 * only include or omit the component and supply an optional cited intro sentence.
 */

import type { CanonicalGap, CanonicalStudy } from "./canonical-study-contracts";
import { type GapHolderType, inferGapHolderType } from "./canonical-gap-holders";
import { matchReferencedDocuments } from "./study-view-reference-match";

/**
 * Pipeline vocabulary that describes how a study was organized, not a document someone can supply.
 * Matched on gap statement, title, and why.
 */
const PIPELINE_GAP_LANGUAGE = String.raw`\b(?:anchor|spine|timeline|canonical|extraction|extractable)\b|page could not`;

export function gapTextMentionsPipelineTerms(text: string): boolean {
  return new RegExp(PIPELINE_GAP_LANGUAGE, "i").test(text);
}

export function canonicalGapMentionsPipelineTerms(gap: Pick<CanonicalGap, "statement" | "title" | "why">): boolean {
  return [gap.statement, gap.title, gap.why].some((part) => gapTextMentionsPipelineTerms(part));
}

/** Drops gaps whose text uses pipeline vocabulary. The caller logs the count; the text is not returned. */
export function dropPipelineLanguageGaps(study: CanonicalStudy): { study: CanonicalStudy; dropped: number } {
  let dropped = 0;
  const gaps = study.gaps.filter((gap) => {
    if (!canonicalGapMentionsPipelineTerms(gap)) return true;
    dropped += 1;
    return false;
  });
  return { study: dropped === 0 ? study : { ...study, gaps }, dropped };
}

export type StudyViewSourceRef = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly quote: string;
};

export type StudyViewReferencedDocument = {
  readonly sourceDocumentId: string;
  readonly description: string;
  readonly page: number;
  readonly quote: string;
};

export const DOCUMENT_REQUEST_LIST_COMPONENT = "DocumentRequestList" as const;
export type StudyViewAllowlistedComponentName = typeof DOCUMENT_REQUEST_LIST_COMPONENT;

export const DOCUMENT_REQUEST_KINDS = ["REQUESTABLE_DOCUMENT", "FUTURE_RECORD", "OBSERVATION"] as const;
export type DocumentRequestKind = (typeof DOCUMENT_REQUEST_KINDS)[number];

export const DOCUMENT_REQUEST_BASIS_TYPES = ["MENTIONED", "USUALLY_EXPECTED"] as const;
export type DocumentRequestBasisType = (typeof DOCUMENT_REQUEST_BASIS_TYPES)[number];

export type DocumentRequestBasis =
  | { readonly type: "MENTIONED"; readonly sourceRefs: readonly StudyViewSourceRef[] }
  | { readonly type: "USUALLY_EXPECTED" };

export type DocumentRequestItem = {
  readonly id: string;
  readonly kind: "REQUESTABLE_DOCUMENT" | "FUTURE_RECORD";
  readonly title: string;
  readonly why: string;
  readonly holder: string;
  readonly holderType: GapHolderType | null;
  readonly basis: DocumentRequestBasis;
  readonly when?: string;
};

export type DocumentRequestObservation = {
  readonly id: string;
  readonly text: string;
  readonly relatedSpineIds: readonly string[];
  readonly relatedFactIds: readonly string[];
};

/** Statement-only gap kept for older studies: one line, not an upload slot. */
export type LegacyDocumentLine = {
  readonly id: string;
  readonly text: string;
};

export type DocumentIntakePrompt = { readonly id: string; readonly text: string };

export type DocumentRequestListData = {
  readonly items: readonly DocumentRequestItem[];
  readonly observations: readonly DocumentRequestObservation[];
  /** Pack rows with "if any" timing — optional intake, not upload slots. */
  readonly intakePrompts?: readonly DocumentIntakePrompt[];
  /** REQUESTABLE_DOCUMENT gaps held by the court (not upload slots). */
  readonly courtRecordCount: number;
  /** Statement-only gaps that are still worth showing, under a rebuild hint. */
  readonly legacyLines: readonly LegacyDocumentLine[];
  /** Gaps canonicalized before structured request fields existed; show a rebuild hint. */
  readonly legacyHint?: boolean;
};

export const DOCUMENT_REQUEST_LIST_LEGACY_HINT = "Rebuild the study for a clearer list." as const;

/** Statement-only gaps from older canonicalize output (no kind/title/why/holder). */
export function isLegacyCanonicalGap(gap: CanonicalGap): boolean {
  return (
    gap.kind === null &&
    gap.title.trim() === "" &&
    gap.why.trim() === "" &&
    gap.holder.trim() === "" &&
    gap.statement.trim() !== ""
  );
}

const FUTURE_RECORD_GAP =
  /\b(?:confirmation hearing|court ruling|will be held|hearing on confirmation|trial date|scheduled hearing|court will|judge will)\b/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map(str).filter((item) => item !== ""))] : [];

function oneOf<T extends string>(options: readonly T[], value: unknown): T | null {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (options as readonly string[]).includes(text) ? (text as T) : null;
}

function defaultTitle(statement: string): string {
  const trimmed = statement.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 72) return trimmed;
  const cut = trimmed.lastIndexOf(" ", 69);
  return `${trimmed.slice(0, cut > 40 ? cut : 69)}…`;
}

function inferKind(gap: CanonicalGap): DocumentRequestKind {
  if (gap.kind) return gap.kind;
  if (FUTURE_RECORD_GAP.test(gap.statement)) return "FUTURE_RECORD";
  return "REQUESTABLE_DOCUMENT";
}

function mentionedRefs(
  gap: CanonicalGap,
  referencedDocuments: readonly StudyViewReferencedDocument[],
): StudyViewSourceRef[] {
  const probe = gap.title.trim() !== "" ? gap.title : gap.statement;
  const seen = new Set<string>();
  return matchReferencedDocuments(probe, referencedDocuments).flatMap((reference) => {
    const key = `${reference.sourceDocumentId}:${reference.page}`;
    if (seen.has(key) || reference.page < 1) return [];
    seen.add(key);
    return [{ sourceDocumentId: reference.sourceDocumentId, pageNumber: reference.page, quote: reference.quote }];
  });
}

function basisForGap(gap: CanonicalGap, referencedDocuments: readonly StudyViewReferencedDocument[]): DocumentRequestBasis {
  const requested = oneOf(DOCUMENT_REQUEST_BASIS_TYPES, gap.basisType);
  if (requested === "USUALLY_EXPECTED") return { type: "USUALLY_EXPECTED" };
  const sourceRefs = mentionedRefs(gap, referencedDocuments);
  if (sourceRefs.length > 0) return { type: "MENTIONED", sourceRefs };
  return { type: "USUALLY_EXPECTED" };
}

/**
 * Views saved before legacy lines were split stored the statement as both title and why, with a blank holder.
 * Only used when the component itself is marked as a legacy list.
 */
export function isPersistedLegacyRequestItem(
  item: Pick<DocumentRequestItem, "kind" | "title" | "why" | "holder" | "basis">,
): boolean {
  return (
    item.kind === "REQUESTABLE_DOCUMENT" &&
    item.holder.trim() === "" &&
    item.basis.type === "USUALLY_EXPECTED" &&
    item.title.trim() !== "" &&
    item.title.trim() === item.why.trim()
  );
}

export function partitionDocumentRequests(component: {
  readonly items: readonly DocumentRequestItem[];
  readonly legacyLines?: readonly LegacyDocumentLine[];
  readonly legacyHint?: boolean;
}): { items: readonly DocumentRequestItem[]; legacyLines: readonly LegacyDocumentLine[] } {
  if (component.legacyLines) {
    return {
      items: component.items,
      legacyLines: component.legacyLines.filter((line) => line.text.trim() !== "" && !gapTextMentionsPipelineTerms(line.text)),
    };
  }
  if (!component.legacyHint) return { items: component.items, legacyLines: [] };
  const items: DocumentRequestItem[] = [];
  const legacyLines: LegacyDocumentLine[] = [];
  for (const item of component.items) {
    if (!isPersistedLegacyRequestItem(item)) {
      items.push(item);
      continue;
    }
    if (gapTextMentionsPipelineTerms(item.title) || gapTextMentionsPipelineTerms(item.why)) continue;
    legacyLines.push({ id: item.id, text: item.title.trim() });
  }
  return { items, legacyLines };
}

export function documentRequestListHasContent(component: {
  readonly items: readonly DocumentRequestItem[];
  readonly legacyLines?: readonly LegacyDocumentLine[];
  readonly legacyHint?: boolean;
}): boolean {
  const parts = partitionDocumentRequests(component);
  return parts.items.length > 0 || parts.legacyLines.length > 0;
}

export function buildDocumentRequestListData(
  study: CanonicalStudy,
  referencedDocuments: readonly StudyViewReferencedDocument[] = [],
): DocumentRequestListData {
  const items: DocumentRequestItem[] = [];
  const observations: DocumentRequestObservation[] = [];
  const legacyLines: LegacyDocumentLine[] = [];
  for (const gap of study.gaps) {
    if (isLegacyCanonicalGap(gap)) {
      if (canonicalGapMentionsPipelineTerms(gap)) continue;
      legacyLines.push({ id: gap.id, text: gap.statement.trim() });
      continue;
    }
    const kind = inferKind(gap);
    if (kind === "OBSERVATION") {
      observations.push({
        id: gap.id,
        text: gap.why.trim() !== "" ? gap.why : gap.statement,
        relatedSpineIds: gap.relatedSpineIds,
        relatedFactIds: gap.relatedFactIds,
      });
      continue;
    }
    if (kind !== "REQUESTABLE_DOCUMENT" && kind !== "FUTURE_RECORD") continue;
    const title = gap.title.trim() !== "" ? gap.title : defaultTitle(gap.statement);
    const why = gap.why.trim() !== "" ? gap.why : gap.statement;
    const holder = gap.holder.trim();
    const holderType = kind === "REQUESTABLE_DOCUMENT" ? (gap.holderType ?? inferGapHolderType(gap)) : null;
    const when = gap.when?.trim() ?? "";
    items.push({
      id: gap.id,
      kind,
      title,
      why,
      holder,
      holderType,
      basis: basisForGap(gap, referencedDocuments),
      ...(when !== "" ? { when } : {}),
    });
  }
  const courtRecordCount = items.filter(
    (item) => item.kind === "REQUESTABLE_DOCUMENT" && item.holderType === "COURT_RECORD",
  ).length;
  return {
    items,
    observations,
    courtRecordCount,
    legacyLines,
    ...(legacyLines.length > 0 ? { legacyHint: true } : {}),
  };
}

/** Ask-now upload slots (excludes court records and later records), unique by title. */
export function askNowDocumentRequestCount(data: DocumentRequestListData): number {
  const seen = new Set<string>();
  let count = 0;
  for (const item of data.items) {
    if (item.kind !== "REQUESTABLE_DOCUMENT" || item.holderType === "COURT_RECORD") continue;
    const key = item.title.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

/** Uploadable missing documents only (excludes court-register items and future records). */
export function requestableDocumentCount(data: DocumentRequestListData): number {
  return askNowDocumentRequestCount(data);
}

export type WriteDocumentRequestListProposal = {
  readonly name: typeof DOCUMENT_REQUEST_LIST_COMPONENT;
  readonly intro?: { readonly text: string; readonly factIds: readonly string[] };
};

const FORBIDDEN_WRITE_KEYS = new Set(["items", "actions", "action", "url", "urls", "id", "title", "holder", "why", "when", "basis"]);

/** Rejects model-authored list content; only name and optional intro are kept. */
export function parseWriteDocumentRequestListProposal(
  raw: unknown,
  tally?: { count(reason: string): void },
): WriteDocumentRequestListProposal | null {
  if (!isRecord(raw)) {
    tally?.count("component_not_object");
    return null;
  }
  const name = str(raw.name);
  if (name !== DOCUMENT_REQUEST_LIST_COMPONENT) {
    tally?.count("component_name_unknown");
    return null;
  }
  if (raw.items !== undefined) {
    tally?.count("component_items_forbidden");
    return null;
  }
  if (raw.actions !== undefined || raw.action !== undefined) {
    tally?.count("component_actions_forbidden");
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (key !== "name" && key !== "intro" && FORBIDDEN_WRITE_KEYS.has(key)) {
      tally?.count("component_field_forbidden");
      return null;
    }
    if (key !== "name" && key !== "intro" && !FORBIDDEN_WRITE_KEYS.has(key)) {
      tally?.count("component_field_unknown");
    }
  }
  let intro: WriteDocumentRequestListProposal["intro"];
  if (raw.intro !== undefined) {
    if (!isRecord(raw.intro)) {
      tally?.count("component_intro_not_object");
    } else {
      const text = str(raw.intro.text);
      const factIds = strings(raw.intro.factIds);
      if (text === "" || factIds.length === 0) tally?.count("component_intro_incomplete");
      else intro = { text, factIds };
    }
  }
  return { name: DOCUMENT_REQUEST_LIST_COMPONENT, ...(intro ? { intro } : {}) };
}

export function draftRequestPlainText(items: readonly DocumentRequestItem[], selectedIds: ReadonlySet<string>): string {
  const lines: string[] = [];
  for (const item of items) {
    if (item.kind !== "REQUESTABLE_DOCUMENT" || item.holderType === "COURT_RECORD" || !selectedIds.has(item.id)) continue;
    lines.push(`${item.title}\n${item.why}`);
  }
  return lines.join("\n\n");
}
