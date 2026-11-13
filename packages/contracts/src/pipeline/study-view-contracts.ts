/**
 * `hive.study-view/1`: narrative sections from `hive-write/1` plus deterministic blocks built from
 * `hive.canonical-study/1`. The model's answer is untrusted; `parseWriteOutput` is lenient and
 * `buildStudyView` never throws on content.
 */

import type { CanonicalStudy, SpineElement, SpineSource } from "./canonical-study-contracts";
import type { Pack, PackAudience } from "./pack-contracts";
import {
  buildChainBlockRows,
  buildChecklistRows,
  buildGeneralNotesRows,
  buildPersonaCoverageCard,
  buildQuestionRows,
  buildTermsRows,
  buildUnansweredRows,
  redactCustomerPackBlockRows,
  packStudyViewMeta,
  type PersonaCoverageCardRow,
  type PackStudyViewMeta,
} from "./pack-study-view";
import { capCustomerQuestions } from "./pack-write";
import { assemblePackReportSections, type StudyViewPackSection } from "./pack-report-view";
import { primarySubjectFirstName } from "./primary-subject";
import { formatRecordReasonsForChecks, reconcilePackDocumentGaps } from "./document-gap-reconcile";
import { spineCheckAnnotation } from "./spine-check-display";
import { displayValueForWrittenText } from "./fact-display-value";
import {
  buildDocumentRequestListData,
  DOCUMENT_REQUEST_LIST_COMPONENT,
  parseWriteDocumentRequestListProposal,
  type DocumentRequestItem,
  type DocumentRequestListData,
  type DocumentRequestObservation,
  type LegacyDocumentLine,
  type StudyViewReferencedDocument,
  type StudyViewSourceRef,
  type WriteDocumentRequestListProposal,
} from "./document-request-list-contracts";

export { matchReferencedDocuments } from "./study-view-reference-match";
export type { StudyViewReferencedDocument, StudyViewSourceRef } from "./document-request-list-contracts";
export {
  buildDocumentRequestListData,
  DOCUMENT_REQUEST_LIST_COMPONENT,
  draftRequestPlainText,
  parseWriteDocumentRequestListProposal,
  requestableDocumentCount,
  type DocumentRequestItem,
  type DocumentRequestListData,
  type DocumentRequestObservation,
  type WriteDocumentRequestListProposal,
} from "./document-request-list-contracts";

export const STUDY_VIEW_SCHEMA = "hive.study-view/1";
export const WRITE_PROMPT_ID = "hive-write/1";
export const WRITE_PROMPT_ID_V2 = "hive-write/2";

export const STUDY_VIEW_BLOCK_NAMES = [
  "documents",
  "spine_table",
  "conflicts",
  "timeline",
  "outside_spine",
  "checklist",
  "chains",
  "questions",
  "unanswered",
  "terms",
  "general_notes",
] as const;
export type StudyViewBlockName = (typeof STUDY_VIEW_BLOCK_NAMES)[number];

export const DEFAULT_STUDY_VIEW_BLOCK_ORDER: readonly StudyViewBlockName[] = STUDY_VIEW_BLOCK_NAMES;

const BLOCK_NAME_SET = new Set<string>(STUDY_VIEW_BLOCK_NAMES);

export type WriteFactRecord = {
  readonly id: string;
  readonly subject: string;
  readonly attribute: string;
  readonly valueAsWritten: string;
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly quote: string;
};

/** How a spine value relates to its element; absent on other blocks and on views saved before it existed. */
export type StudyViewValueRelation = "supporting" | "contradicting" | "updating";

export type StudyViewValue = {
  readonly factId: string;
  readonly valueAsWritten: string;
  readonly sourceRef: StudyViewSourceRef;
  readonly relation?: StudyViewValueRelation;
};

export type StudyViewRow = {
  readonly id: string;
  readonly label?: string | null;
  readonly statement?: string | null;
  readonly status?: string | null;
  /** Checklist only: regulation or reference text for Professional renders. */
  readonly authority?: string | null;
  readonly kind?: string | null;
  readonly date?: string | null;
  readonly asWritten?: string | null;
  readonly role?: string | null;
  readonly typeInPlainWords?: string | null;
  readonly version?: string | null;
  readonly chainPosition?: number | null;
  readonly relatedSpineIds?: readonly string[];
  readonly missing?: readonly string[];
  /** Pack spine rows: checklist issue lines with verdict prefixes. */
  readonly issues?: readonly string[];
  /** Gaps only: pages of supplied documents that refer to the missing document. */
  readonly referencedBy?: readonly StudyViewSourceRef[];
  readonly values: readonly StudyViewValue[];
};

export type StudyViewSentence = {
  readonly text: string;
  readonly factIds: readonly string[];
};

export type StudyViewSection = {
  readonly heading: string;
  readonly paragraphs: readonly { readonly sentences: readonly StudyViewSentence[] }[];
};

export type StudyViewBlock = {
  readonly name: StudyViewBlockName;
  readonly rows: readonly StudyViewRow[];
};

export type StudyViewDocumentRequestList = {
  readonly name: typeof DOCUMENT_REQUEST_LIST_COMPONENT;
  readonly intro?: StudyViewSentence;
  readonly items: readonly DocumentRequestItem[];
  readonly intakePrompts?: readonly import("./document-request-list-contracts").DocumentIntakePrompt[];
  readonly courtRecordCount: number;
  /** When the write model proposed forbidden fields, render a plain accessible list. */
  readonly fallback?: boolean;
  /** Statement-only gaps shown as a plain list under the rebuild hint. */
  readonly legacyLines?: readonly LegacyDocumentLine[];
  /** Statement-only canonical gaps; show rebuild guidance in the list chrome. */
  readonly legacyHint?: boolean;
};

export type StudyViewComponent = StudyViewDocumentRequestList;

export type StudyView = {
  readonly schema: typeof STUDY_VIEW_SCHEMA;
  readonly sections: readonly StudyViewSection[];
  readonly blocks: readonly StudyViewBlock[];
  readonly components: readonly StudyViewComponent[];
  readonly documentRequestObservations?: readonly DocumentRequestObservation[];
  /** When no single document organizes the case, a one-line note from the canonical study. */
  readonly structuralNote?: string | null;
  /** The owner's intent the view was written for, when the builder was given it. */
  readonly intent?: string;
  readonly spineSource?: SpineSource | null;
  readonly packMeta?: PackStudyViewMeta;
  readonly personaCoverageCard?: readonly PersonaCoverageCardRow[];
  readonly writtenFor?: string;
  readonly packSections?: readonly StudyViewPackSection[];
};

/** Optional inputs beyond the canonical study; views built without them simply lack those fields. */
export type StudyViewContext = {
  readonly intent?: string;
  readonly referencedDocuments?: readonly StudyViewReferencedDocument[];
  readonly pack?: Pack;
  readonly reportAudience?: PackAudience;
};

/**
 * Citation index stored next to a persisted study view: the page and quote of every fact the view
 * cites (sentences and block values) and the file name of every document it mentions.
 */
export type StudyViewSources = {
  readonly documents: Readonly<Record<string, { readonly fileName: string; readonly typeInPlainWords?: string | null }>>;
  readonly facts: Readonly<Record<string, StudyViewSourceRef>>;
};

export type WriteOutput = {
  readonly sections: readonly WriteSection[];
  readonly blocks: readonly StudyViewBlockName[];
  readonly components?: readonly WriteDocumentRequestListProposal[];
};

export type WriteSection = {
  readonly heading: string;
  readonly paragraphs: readonly { readonly sentences: readonly { readonly text: string; readonly factIds: readonly string[] }[] }[];
};

export type StudyViewDrops = {
  readonly sentencesDropped: number;
  readonly unknownBlockNamesIgnored: number;
  readonly unknownFactIdsStripped: number;
  readonly invalidWriteComponentsDropped: number;
  readonly packSectionsOmitted?: number;
  readonly packBlocksSkippedNotBuilt?: number;
  readonly packBlocksUnknown?: number;
};

export type WriteOutputParse =
  | { ok: true; value: WriteOutput; malformed: Record<string, number> }
  | { ok: false; reason: "write_root_invalid"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown): string[] => [...new Set(arr(value).map(str).filter((item) => item !== ""))];

class Tally {
  readonly counts: Record<string, number> = {};
  count(reason: string): void {
    this.counts[reason] = (this.counts[reason] ?? 0) + 1;
  }
}

function blockName(value: unknown): StudyViewBlockName | null {
  const text = typeof value === "string" ? value.trim() : "";
  return BLOCK_NAME_SET.has(text) ? (text as StudyViewBlockName) : null;
}

/** Lenient parse of one `hive-write/1` answer. Never throws. */
export function parseWriteOutput(raw: unknown): WriteOutputParse {
  if (!isRecord(raw)) {
    return { ok: false, reason: "write_root_invalid", message: "The answer is not a JSON object." };
  }
  const tally = new Tally();
  const sections: WriteSection[] = [];
  for (const section of arr(raw.sections)) {
    if (!isRecord(section)) {
      tally.count("section_not_object");
      continue;
    }
    const heading = str(section.heading);
    if (heading === "") {
      tally.count("section_heading_missing");
      continue;
    }
    const paragraphs: WriteSection["paragraphs"][number][] = [];
    for (const paragraph of arr(section.paragraphs)) {
      if (!isRecord(paragraph)) {
        tally.count("paragraph_not_object");
        continue;
      }
      const sentences: { text: string; factIds: string[] }[] = [];
      for (const sentence of arr(paragraph.sentences)) {
        if (!isRecord(sentence)) {
          tally.count("sentence_not_object");
          continue;
        }
        const text = str(sentence.text);
        if (text === "") {
          tally.count("sentence_text_missing");
          continue;
        }
        sentences.push({ text, factIds: strings(sentence.factIds) });
      }
      if (sentences.length > 0) paragraphs.push({ sentences });
    }
    if (paragraphs.length > 0) sections.push({ heading, paragraphs });
  }
  const blocks: StudyViewBlockName[] = [];
  const seenBlocks = new Set<string>();
  for (const item of arr(raw.blocks)) {
    const text = typeof item === "string" ? item.trim() : "";
    if (text === "gaps") {
      tally.count("block_name_deprecated");
      continue;
    }
    const name = blockName(item);
    if (name === null) {
      tally.count("block_name_unknown");
      continue;
    }
    if (seenBlocks.has(name)) {
      tally.count("block_name_duplicate");
      continue;
    }
    seenBlocks.add(name);
    blocks.push(name);
  }
  const components: WriteDocumentRequestListProposal[] = [];
  const seenComponents = new Set<string>();
  for (const item of arr(raw.components)) {
    const parsed = parseWriteDocumentRequestProposal(item, tally);
    if (!parsed) continue;
    if (seenComponents.has(parsed.name)) {
      tally.count("component_name_duplicate");
      continue;
    }
    seenComponents.add(parsed.name);
    components.push(parsed);
  }
  return { ok: true, value: { sections, blocks, components }, malformed: tally.counts };
}

function parseWriteDocumentRequestProposal(
  raw: unknown,
  tally: Tally,
): WriteDocumentRequestListProposal | null {
  const proposal = parseWriteDocumentRequestListProposal(raw, tally);
  if (!proposal) return null;
  if (proposal.name !== DOCUMENT_REQUEST_LIST_COMPONENT) {
    tally.count("component_name_unknown");
    return null;
  }
  return proposal;
}

function valuesForFactIds(
  factIds: readonly string[],
  facts: ReadonlyMap<string, WriteFactRecord>,
  relation?: StudyViewValueRelation,
  seen: Set<string> = new Set<string>(),
  spine: readonly SpineElement[] = [],
): StudyViewValue[] {
  const out: StudyViewValue[] = [];
  for (const factId of factIds) {
    if (seen.has(factId)) continue;
    seen.add(factId);
    const fact = facts.get(factId);
    if (!fact) continue;
    out.push({
      factId: fact.id,
      valueAsWritten: displayValueForWrittenText(fact.valueAsWritten, fact.subject, spine),
      sourceRef: { sourceDocumentId: fact.sourceDocumentId, pageNumber: fact.pageNumber, quote: fact.quote },
      ...(relation ? { relation } : {}),
    });
  }
  return out;
}

const NO_ANCHOR_SPINE_SOURCES = new Set<SpineSource>(["TIMELINE", "PARTIES_AND_OBLIGATIONS"]);

function structuralNoteFromStudy(study: CanonicalStudy): string | null {
  const first = study.gaps[0];
  if (!first || !study.spineSource || !NO_ANCHOR_SPINE_SOURCES.has(study.spineSource)) return null;
  if (first.relatedSpineIds.length > 0) return null;
  const statement = first.statement.trim();
  return statement !== "" ? statement : null;
}

function dedupeRows(rows: StudyViewRow[]): StudyViewRow[] {
  const seen = new Set<string>();
  const out: StudyViewRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function buildDocumentsBlock(study: CanonicalStudy): StudyViewRow[] {
  return dedupeRows(
    study.documents.map((doc) => ({
      id: doc.sourceDocumentId,
      role: doc.role,
      typeInPlainWords: doc.typeInPlainWords || null,
      date: doc.date,
      version: doc.version,
      chainPosition: doc.chainPosition,
      values: [],
    })),
  );
}

function buildSpineBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>, context: StudyViewContext): StudyViewRow[] {
  const pack = context.pack;
  return dedupeRows(
    study.spine.map((element) => {
      const seen = new Set<string>();
      const annotation = pack && !pack.briefOnly ? spineCheckAnnotation(study, pack, element) : null;
      const status =
        pack && !pack.briefOnly
          ? annotation?.displayVerdict ?? null
          : element.status;
      return {
        id: element.id,
        label: element.label,
        kind: element.kind || null,
        status,
        missing: element.missing,
        ...(annotation && annotation.issueLines.length > 0 ? { issues: annotation.issueLines } : {}),
        values: [
          ...valuesForFactIds(element.supportingFactIds, facts, "supporting", seen, study.spine),
          ...valuesForFactIds(element.contradictingFactIds, facts, "contradicting", seen, study.spine),
          ...valuesForFactIds(element.updatingFactIds, facts, "updating", seen, study.spine),
        ],
      };
    }),
  );
}

function buildConflictsBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>): StudyViewRow[] {
  return dedupeRows(
    study.conflicts.map((conflict) => ({
      id: conflict.id,
      statement: conflict.statement,
      values: valuesForFactIds(conflict.factIds, facts, undefined, new Set(), study.spine),
    })),
  );
}

function buildTimelineBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>): StudyViewRow[] {
  return study.timeline.map((entry, index) => ({
    id: `T${index + 1}`,
    date: entry.date,
    asWritten: entry.asWritten || null,
    statement: entry.statement,
    values: valuesForFactIds(entry.factIds, facts, undefined, new Set(), study.spine),
  }));
}

function buildOutsideSpineBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>): StudyViewRow[] {
  return dedupeRows(
    study.outsideSpine.map((item) => ({
      id: item.id,
      statement: item.statement,
      values: valuesForFactIds(item.factIds, facts, undefined, new Set(), study.spine),
    })),
  );
}

function buildChecklistBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>, context: StudyViewContext): StudyViewRow[] {
  if (!context.pack) return [];
  const audience = context.reportAudience ?? "professional";
  return buildChecklistRows(study, context.pack, facts, audience);
}

function buildChainsBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>, context: StudyViewContext): StudyViewRow[] {
  if (!context.pack) return [];
  return buildChainBlockRows(study, context.pack, facts).flatMap((chain) =>
    chain.rows.map((row) => ({
      ...row,
      id: `${chain.chainId}:${row.id}`,
      label: `${chain.label} · ${row.label ?? ""}`.trim(),
    })),
  );
}

function buildQuestionsBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>, context: StudyViewContext): StudyViewRow[] {
  if (!context.pack) return [];
  const audience = context.reportAudience ?? "professional";
  const rows = buildQuestionRows(study, context.pack, facts, audience);
  return [...capCustomerQuestions(rows, audience)];
}

function buildUnansweredBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>, context: StudyViewContext): StudyViewRow[] {
  if (!context.pack || !context.reportAudience) return [];
  return buildUnansweredRows(study, context.pack, context.reportAudience, facts);
}

function buildTermsBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>, context: StudyViewContext): StudyViewRow[] {
  if (!context.pack) return [];
  return buildTermsRows(context.pack, [...facts.values()]);
}

function buildGeneralNotesBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>, context: StudyViewContext): StudyViewRow[] {
  if (!context.pack) return [];
  return buildGeneralNotesRows(context.pack);
}

const BLOCK_BUILDERS: Record<
  StudyViewBlockName,
  (study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>, context: StudyViewContext) => StudyViewRow[]
> = {
  documents: (study) => buildDocumentsBlock(study),
  spine_table: (study, facts, context) => buildSpineBlock(study, facts, context),
  conflicts: buildConflictsBlock,
  timeline: buildTimelineBlock,
  outside_spine: buildOutsideSpineBlock,
  checklist: buildChecklistBlock,
  chains: buildChainsBlock,
  questions: buildQuestionsBlock,
  unanswered: buildUnansweredBlock,
  terms: buildTermsBlock,
  general_notes: buildGeneralNotesBlock,
};

function filterSections(
  sections: readonly WriteSection[],
  knownFactIds: ReadonlySet<string>,
): { sections: StudyViewSection[]; sentencesDropped: number; unknownFactIdsStripped: number } {
  let sentencesDropped = 0;
  let unknownFactIdsStripped = 0;
  const out: StudyViewSection[] = [];
  for (const section of sections) {
    const paragraphs: StudyViewSection["paragraphs"][number][] = [];
    for (const paragraph of section.paragraphs) {
      const sentences: StudyViewSentence[] = [];
      for (const sentence of paragraph.sentences) {
        if (sentence.factIds.length === 0) {
          sentencesDropped += 1;
          continue;
        }
        const kept = sentence.factIds.filter((id) => knownFactIds.has(id));
        unknownFactIdsStripped += sentence.factIds.length - kept.length;
        if (kept.length === 0) {
          sentencesDropped += 1;
          continue;
        }
        sentences.push({ text: sentence.text, factIds: kept });
      }
      if (sentences.length > 0) paragraphs.push({ sentences });
    }
    if (paragraphs.length > 0) out.push({ heading: section.heading, paragraphs });
  }
  return { sections: out, sentencesDropped, unknownFactIdsStripped };
}

/** The model's block order first, then every block it left out: the view always carries the whole study. */
function resolveBlockOrder(requested: readonly StudyViewBlockName[]): StudyViewBlockName[] {
  const requestedSet = new Set(requested);
  return [...requested, ...DEFAULT_STUDY_VIEW_BLOCK_ORDER.filter((name) => !requestedSet.has(name))];
}

/**
 * Merges verified canonical study data with the write model's narrative. Drops uncited sentences,
 * builds every block from canonical ids, and ignores unknown block names from the parse step.
 */
export function buildStudyView(
  canonicalStudy: CanonicalStudy,
  writeOutput: WriteOutput,
  facts: readonly WriteFactRecord[],
  parseMalformed: Record<string, number> = {},
  context: StudyViewContext = {},
): { view: StudyView; drops: StudyViewDrops } {
  const factMap = new Map(facts.map((fact) => [fact.id, fact]));
  const knownFactIds = new Set(factMap.keys());
  const { sections, sentencesDropped, unknownFactIdsStripped } = filterSections(writeOutput.sections, knownFactIds);
  const order = resolveBlockOrder(writeOutput.blocks);
  const unknownBlockNamesIgnored =
    (parseMalformed.block_name_unknown ?? 0) + (parseMalformed.block_name_deprecated ?? 0);
  const packAudience = context.reportAudience;
  const referencedDocuments = context.referencedDocuments ?? [];
  const reconciled =
    context.pack && !context.pack.briefOnly
      ? reconcilePackDocumentGaps(canonicalStudy, context.pack)
      : { study: canonicalStudy, intakePrompts: [] as import("./document-request-list-contracts").DocumentIntakePrompt[] };
  const studyForBlocks = reconciled.study;
  const blocks: StudyViewBlock[] = order.map((name) => {
    const rows = BLOCK_BUILDERS[name](studyForBlocks, factMap, context);
    const sanitized =
      packAudience === "customer" && context.pack
        ? redactCustomerPackBlockRows(name, rows, context.pack)
        : rows;
    return { name, rows: sanitized };
  });
  const requestData: DocumentRequestListData = {
    ...buildDocumentRequestListData(reconciled.study, referencedDocuments),
    ...(reconciled.intakePrompts.length > 0 ? { intakePrompts: reconciled.intakePrompts } : {}),
  };
  const structuralNote = structuralNoteFromStudy(studyForBlocks);
  const components: StudyViewComponent[] = [];
  let invalidWriteComponentsDropped = 0;
  let extraUnknownFactIds = 0;
  const writeComponents = writeOutput.components ?? [];
  const wantsList =
    writeComponents.some((component) => component.name === DOCUMENT_REQUEST_LIST_COMPONENT) || writeComponents.length === 0;
  const writeFallback =
    (parseMalformed.component_items_forbidden ?? 0) > 0 ||
    (parseMalformed.component_actions_forbidden ?? 0) > 0 ||
    (parseMalformed.component_field_forbidden ?? 0) > 0;
  const gapById = new Map(studyForBlocks.gaps.map((gap) => [gap.id, gap]));
  const requestItems =
    context.pack && packAudience === "customer"
      ? requestData.items.map((item) => {
          const settles = gapById.get(item.id)?.settlesCheckIds ?? [];
          if (settles.length === 0) return item;
          const why = formatRecordReasonsForChecks(context.pack!, settles, "customer");
          return why.trim() !== "" ? { ...item, why } : item;
        })
      : requestData.items;

  if (wantsList && (requestItems.length > 0 || requestData.legacyLines.length > 0)) {
    const proposal = writeComponents.find((component) => component.name === DOCUMENT_REQUEST_LIST_COMPONENT);
    let intro: StudyViewSentence | undefined;
    if (proposal?.intro && !writeFallback) {
      const kept = proposal.intro.factIds.filter((id) => knownFactIds.has(id));
      extraUnknownFactIds += proposal.intro.factIds.length - kept.length;
      if (kept.length > 0) intro = { text: proposal.intro.text, factIds: kept };
      else invalidWriteComponentsDropped += 1;
    }
    if (writeFallback) invalidWriteComponentsDropped += 1;
    components.push({
      name: DOCUMENT_REQUEST_LIST_COMPONENT,
      items: requestItems,
      courtRecordCount: requestData.courtRecordCount,
      ...(intro ? { intro } : {}),
      ...(writeFallback ? { fallback: true } : {}),
      ...(requestData.legacyLines.length > 0 ? { legacyLines: requestData.legacyLines, legacyHint: true } : {}),
      ...(requestData.intakePrompts && requestData.intakePrompts.length > 0 ? { intakePrompts: requestData.intakePrompts } : {}),
    });
  }

  const intent = context.intent?.trim() ?? "";
  const observations =
    requestData.observations.length > 0 ? requestData.observations : undefined;
  const packMeta = context.pack ? packStudyViewMeta(context.pack) : undefined;
  const personaCoverageCard = context.pack
    ? buildPersonaCoverageCard(studyForBlocks, context.pack, factMap)
    : undefined;
  const writtenFor =
    context.reportAudience && context.pack
      ? context.pack.personas.find((p) => p.audience === context.reportAudience)?.who
      : undefined;

  let packSections: StudyViewPackSection[] | undefined;
  let packSectionsOmitted: number | undefined;
  let packBlocksSkippedNotBuilt: number | undefined;
  let packBlocksUnknown: number | undefined;
  if (context.pack && !context.pack.briefOnly && context.reportAudience) {
    const prebuilt = new Map(blocks.map((block) => [block.name, block.rows] as const));
    const firstName = primarySubjectFirstName(studyForBlocks, facts);
    const assembled = assemblePackReportSections({
      pack: context.pack,
      audience: context.reportAudience,
      study: studyForBlocks,
      facts,
      writeSections: writeOutput.sections,
      prebuilt,
      context,
      documentRequestList: components.find((component) => component.name === DOCUMENT_REQUEST_LIST_COMPONENT),
      firstName,
    });
    packSections = assembled.sections;
    packSectionsOmitted = assembled.drops.packSectionsOmitted;
    packBlocksSkippedNotBuilt = assembled.drops.packBlocksSkippedNotBuilt;
    packBlocksUnknown = assembled.drops.packBlocksUnknown;
  }

  return {
    view: {
      schema: STUDY_VIEW_SCHEMA,
      sections,
      blocks,
      components,
      ...(observations ? { documentRequestObservations: observations } : {}),
      ...(structuralNote ? { structuralNote } : {}),
      ...(intent !== "" ? { intent } : {}),
      spineSource: studyForBlocks.spineSource,
      ...(packMeta ? { packMeta } : {}),
      ...(personaCoverageCard && personaCoverageCard.length > 0 ? { personaCoverageCard } : {}),
      ...(writtenFor ? { writtenFor } : {}),
      ...(packSections && packSections.length > 0 ? { packSections } : {}),
    },
    drops: {
      sentencesDropped,
      unknownBlockNamesIgnored,
      unknownFactIdsStripped: unknownFactIdsStripped + extraUnknownFactIds,
      invalidWriteComponentsDropped,
      ...(packSectionsOmitted !== undefined ? { packSectionsOmitted } : {}),
      ...(packBlocksSkippedNotBuilt !== undefined ? { packBlocksSkippedNotBuilt } : {}),
      ...(packBlocksUnknown !== undefined ? { packBlocksUnknown } : {}),
    },
  };
}

/** Builds the citation index for a built view. Only facts the view actually cites are included. */
export function buildStudyViewSources(
  view: StudyView,
  facts: readonly WriteFactRecord[],
  fileNames: ReadonlyMap<string, string>,
): StudyViewSources {
  const factMap = new Map(facts.map((fact) => [fact.id, fact]));
  const cited: Record<string, StudyViewSourceRef> = {};
  const documentIds = new Set<string>();
  const cite = (factId: string) => {
    const fact = factMap.get(factId);
    if (!fact || cited[factId]) return;
    cited[factId] = { sourceDocumentId: fact.sourceDocumentId, pageNumber: fact.pageNumber, quote: fact.quote };
    documentIds.add(fact.sourceDocumentId);
  };
  for (const section of view.sections) {
    for (const paragraph of section.paragraphs) {
      for (const sentence of paragraph.sentences) sentence.factIds.forEach(cite);
    }
  }
  for (const block of view.blocks) {
    for (const row of block.rows) {
      row.values.forEach((value) => cite(value.factId));
      row.referencedBy?.forEach((ref) => documentIds.add(ref.sourceDocumentId));
      if (block.name === "documents") documentIds.add(row.id);
    }
  }
  for (const component of view.components ?? []) {
    component.intro?.factIds.forEach(cite);
    if (component.name === DOCUMENT_REQUEST_LIST_COMPONENT) {
      for (const item of component.items) {
        if (item.basis.type === "MENTIONED") {
          item.basis.sourceRefs.forEach((ref) => documentIds.add(ref.sourceDocumentId));
        }
      }
    }
  }
  const typeInPlainWordsByDoc = new Map<string, string>();
  const collectType = (sourceDocumentId: string, typeInPlainWords: string | null | undefined) => {
    const text = typeInPlainWords?.trim() ?? "";
    if (text !== "") typeInPlainWordsByDoc.set(sourceDocumentId.toLowerCase(), text);
  };
  for (const block of view.blocks) {
    if (block.name !== "documents") continue;
    for (const row of block.rows) collectType(row.id, row.typeInPlainWords);
  }
  if (view.packSections) {
    for (const section of view.packSections) {
      for (const block of section.blocks) {
        if (block.name !== "documents") continue;
        for (const row of block.rows) collectType(row.id, row.typeInPlainWords);
      }
      for (const paragraph of section.paragraphs) {
        for (const sentence of paragraph.sentences) sentence.factIds.forEach(cite);
      }
      for (const block of section.blocks) {
        for (const row of block.rows) row.values.forEach((value) => cite(value.factId));
      }
      const gapsList = section.documentRequestList;
      if (gapsList) {
        for (const item of gapsList.items) {
          if (item.basis.type === "MENTIONED") {
            item.basis.sourceRefs.forEach((ref) => documentIds.add(ref.sourceDocumentId));
          }
        }
      }
    }
  }
  const documents: Record<string, { fileName: string; typeInPlainWords?: string | null }> = {};
  const fileNameFor = (id: string) => fileNames.get(id.toLowerCase()) ?? fileNames.get(id) ?? "";
  for (const id of documentIds) {
    const key = id.toLowerCase();
    const typeInPlainWords = typeInPlainWordsByDoc.get(key) ?? null;
    const fallbackName = fileNameFor(id) || id;
    documents[id] = {
      fileName: fallbackName,
      ...(typeInPlainWords ? { fileName: typeInPlainWords, typeInPlainWords } : {}),
    };
  }
  return { documents, facts: cited };
}

export function isStudyView(value: unknown): value is StudyView {
  return (
    isRecord(value) &&
    value.schema === STUDY_VIEW_SCHEMA &&
    Array.isArray(value.sections) &&
    Array.isArray(value.blocks) &&
    (value.components === undefined || Array.isArray(value.components))
  );
}

/** Lenient read of a stored citation index; malformed entries are skipped, never invented. */
export function normalizeStudyViewSources(raw: unknown): StudyViewSources {
  const documents: Record<string, { fileName: string }> = {};
  const facts: Record<string, StudyViewSourceRef> = {};
  if (!isRecord(raw)) return { documents, facts };
  if (isRecord(raw.documents)) {
    for (const [id, entry] of Object.entries(raw.documents)) {
      if (isRecord(entry) && typeof entry.fileName === "string") {
        const typeInPlainWords = typeof entry.typeInPlainWords === "string" ? entry.typeInPlainWords : null;
        documents[id] = { fileName: entry.fileName, ...(typeInPlainWords ? { typeInPlainWords } : {}) };
      }
    }
  }
  if (isRecord(raw.facts)) {
    for (const [id, entry] of Object.entries(raw.facts)) {
      if (
        isRecord(entry) &&
        typeof entry.sourceDocumentId === "string" &&
        typeof entry.pageNumber === "number" &&
        Number.isInteger(entry.pageNumber) &&
        entry.pageNumber > 0 &&
        typeof entry.quote === "string"
      ) {
        facts[id] = { sourceDocumentId: entry.sourceDocumentId, pageNumber: entry.pageNumber, quote: entry.quote };
      }
    }
  }
  return { documents, facts };
}
