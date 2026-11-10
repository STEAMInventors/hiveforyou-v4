/**
 * `hive.study-view/1`: narrative sections from `hive-write/1` plus deterministic blocks built from
 * `hive.canonical-study/1`. The model's answer is untrusted; `parseWriteOutput` is lenient and
 * `buildStudyView` never throws on content.
 */

import type { CanonicalStudy, SpineSource } from "./canonical-study-contracts";
import {
  buildDocumentRequestListData,
  DOCUMENT_REQUEST_LIST_COMPONENT,
  parseWriteDocumentRequestListProposal,
  type DocumentRequestItem,
  type DocumentRequestObservation,
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

export const STUDY_VIEW_BLOCK_NAMES = [
  "documents",
  "spine_table",
  "conflicts",
  "timeline",
  "outside_spine",
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
  readonly kind?: string | null;
  readonly date?: string | null;
  readonly asWritten?: string | null;
  readonly role?: string | null;
  readonly typeInPlainWords?: string | null;
  readonly version?: string | null;
  readonly chainPosition?: number | null;
  readonly relatedSpineIds?: readonly string[];
  readonly missing?: readonly string[];
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
  /** When the write model proposed forbidden fields, render a plain accessible list. */
  readonly fallback?: boolean;
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
};

/** Optional inputs beyond the canonical study; views built without them simply lack those fields. */
export type StudyViewContext = {
  readonly intent?: string;
  readonly referencedDocuments?: readonly StudyViewReferencedDocument[];
};

/**
 * Citation index stored next to a persisted study view: the page and quote of every fact the view
 * cites (sentences and block values) and the file name of every document it mentions.
 */
export type StudyViewSources = {
  readonly documents: Readonly<Record<string, { readonly fileName: string }>>;
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
): StudyViewValue[] {
  const out: StudyViewValue[] = [];
  for (const factId of factIds) {
    if (seen.has(factId)) continue;
    seen.add(factId);
    const fact = facts.get(factId);
    if (!fact) continue;
    out.push({
      factId: fact.id,
      valueAsWritten: fact.valueAsWritten,
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

function buildSpineBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>): StudyViewRow[] {
  return dedupeRows(
    study.spine.map((element) => {
      const seen = new Set<string>();
      return {
        id: element.id,
        label: element.label,
        kind: element.kind || null,
        status: element.status,
        missing: element.missing,
        values: [
          ...valuesForFactIds(element.supportingFactIds, facts, "supporting", seen),
          ...valuesForFactIds(element.contradictingFactIds, facts, "contradicting", seen),
          ...valuesForFactIds(element.updatingFactIds, facts, "updating", seen),
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
      values: valuesForFactIds(conflict.factIds, facts),
    })),
  );
}

function buildTimelineBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>): StudyViewRow[] {
  return study.timeline.map((entry, index) => ({
    id: `T${index + 1}`,
    date: entry.date,
    asWritten: entry.asWritten || null,
    statement: entry.statement,
    values: valuesForFactIds(entry.factIds, facts),
  }));
}

function buildOutsideSpineBlock(study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>): StudyViewRow[] {
  return dedupeRows(
    study.outsideSpine.map((item) => ({
      id: item.id,
      statement: item.statement,
      values: valuesForFactIds(item.factIds, facts),
    })),
  );
}

const BLOCK_BUILDERS: Record<
  StudyViewBlockName,
  (study: CanonicalStudy, facts: ReadonlyMap<string, WriteFactRecord>, context: StudyViewContext) => StudyViewRow[]
> = {
  documents: (study) => buildDocumentsBlock(study),
  spine_table: buildSpineBlock,
  conflicts: buildConflictsBlock,
  timeline: buildTimelineBlock,
  outside_spine: buildOutsideSpineBlock,
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
  const blocks: StudyViewBlock[] = order.map((name) => ({
    name,
    rows: BLOCK_BUILDERS[name](canonicalStudy, factMap, context),
  }));
  const referencedDocuments = context.referencedDocuments ?? [];
  const requestData = buildDocumentRequestListData(canonicalStudy, referencedDocuments);
  const structuralNote = structuralNoteFromStudy(canonicalStudy);
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
  if (wantsList && requestData.items.length > 0) {
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
      items: requestData.items,
      ...(intro ? { intro } : {}),
      ...(writeFallback ? { fallback: true } : {}),
      ...(requestData.legacyHint ? { legacyHint: true } : {}),
    });
  }

  const intent = context.intent?.trim() ?? "";
  const observations =
    requestData.observations.length > 0 ? requestData.observations : undefined;
  return {
    view: {
      schema: STUDY_VIEW_SCHEMA,
      sections,
      blocks,
      components,
      ...(observations ? { documentRequestObservations: observations } : {}),
      ...(structuralNote ? { structuralNote } : {}),
      ...(intent !== "" ? { intent } : {}),
      spineSource: canonicalStudy.spineSource,
    },
    drops: {
      sentencesDropped,
      unknownBlockNamesIgnored,
      unknownFactIdsStripped: unknownFactIdsStripped + extraUnknownFactIds,
      invalidWriteComponentsDropped,
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
  const documents: Record<string, { fileName: string }> = {};
  for (const id of documentIds) {
    documents[id] = { fileName: fileNames.get(id.toLowerCase()) ?? fileNames.get(id) ?? "Document" };
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
      if (isRecord(entry) && typeof entry.fileName === "string") documents[id] = { fileName: entry.fileName };
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
