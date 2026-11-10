import { isValidUuid } from "../hives/hive-contracts";
import { parseCanonicalStudy, type CanonicalStudy } from "../pipeline/canonical-study-contracts";
import {
  buildStudyView,
  buildStudyViewSources,
  DEFAULT_STUDY_VIEW_BLOCK_ORDER,
  parseWriteOutput,
  type StudyView,
  type StudyViewBlockName,
  type StudyViewReferencedDocument,
  type StudyViewSources,
  type WriteFactRecord,
  type WriteOutput,
} from "../pipeline/study-view-contracts";

const BLOCK_NAME_SET = new Set<string>(DEFAULT_STUDY_VIEW_BLOCK_ORDER);

/** One row from `public.get_study_tab_view`: a cited fact with provenance for `buildStudyView`. */
export type StudyTabViewFactRow = {
  readonly id: string;
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly quote: string;
  readonly valueAsWritten: string;
  readonly subject: string;
  readonly attribute: string;
};

/** Referenced-but-not-supplied document (minimal fields for `StudyViewContext`). */
export type StudyTabViewReferencedRow = {
  readonly sourceDocumentId: string;
  readonly description: string;
  readonly page: number;
  readonly quote: string;
};

export type GetStudyTabViewResponse = {
  readonly revision: { readonly id: string; readonly revisionNumber: number; readonly format: string } | null;
  readonly canonicalStudy: CanonicalStudy | null;
  readonly intent: string | null;
  readonly facts: readonly StudyTabViewFactRow[];
  readonly referencedDocuments: readonly StudyTabViewReferencedRow[];
  /** hive.write-run/1 when a study-view report exists for this revision (metadata; narrative is in narrativeSections). */
  readonly writerOutput: unknown | null;
  readonly narrativeSections: WriteOutput["sections"] | null;
  readonly narrativeBlockNames: readonly StudyViewBlockName[] | null;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableStr(value: unknown): string | null {
  const text = str(value);
  return text === "" ? null : text;
}

function normalizeFactRow(raw: unknown): StudyTabViewFactRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = str(record.id);
  const sourceDocumentId = str(record.sourceDocumentId).toLowerCase();
  if (!isValidUuid(sourceDocumentId) || id === "") return null;
  const pageNumber = typeof record.pageNumber === "number" && Number.isInteger(record.pageNumber) ? record.pageNumber : 0;
  return {
    id,
    sourceDocumentId,
    pageNumber,
    quote: typeof record.quote === "string" ? record.quote : "",
    valueAsWritten: typeof record.valueAsWritten === "string" ? record.valueAsWritten : "",
    subject: typeof record.subject === "string" ? record.subject : "",
    attribute: typeof record.attribute === "string" ? record.attribute : "",
  };
}

function normalizeReferencedRow(raw: unknown): StudyTabViewReferencedRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const sourceDocumentId = str(record.sourceDocumentId).toLowerCase();
  if (!isValidUuid(sourceDocumentId)) return null;
  const description = str(record.description);
  if (description === "") return null;
  const page = typeof record.page === "number" && Number.isInteger(record.page) && record.page >= 1 ? record.page : 1;
  const quote = typeof record.quote === "string" ? record.quote : "";
  return { sourceDocumentId, description, page, quote };
}

export function normalizeGetStudyTabViewResponse(raw: unknown): GetStudyTabViewResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  let revision: GetStudyTabViewResponse["revision"] = null;
  if (record.revision != null) {
    if (typeof record.revision !== "object" || Array.isArray(record.revision)) return null;
    const rev = record.revision as Record<string, unknown>;
    const id = str(rev.id).toLowerCase();
    const format = str(rev.format);
    if (!isValidUuid(id) || typeof rev.revisionNumber !== "number" || !Number.isInteger(rev.revisionNumber)) return null;
    revision = { id, revisionNumber: rev.revisionNumber, format };
  }

  let canonicalStudy: CanonicalStudy | null = null;
  if (record.canonicalStudy != null) {
    const parsed = parseCanonicalStudy(record.canonicalStudy);
    if (!parsed.ok) return null;
    canonicalStudy = parsed.value;
  }

  const factsRaw = record.facts;
  const facts = Array.isArray(factsRaw) ? factsRaw.map(normalizeFactRow).filter((row): row is StudyTabViewFactRow => row !== null) : [];

  const refRaw = record.referencedDocuments;
  const referencedDocuments = Array.isArray(refRaw)
    ? refRaw.map(normalizeReferencedRow).filter((row): row is StudyTabViewReferencedRow => row !== null)
    : [];

  const narrativeSections =
    record.narrativeSections == null
      ? null
      : Array.isArray(record.narrativeSections)
        ? (record.narrativeSections as WriteOutput["sections"])
        : null;

  let narrativeBlockNames: readonly StudyViewBlockName[] | null = null;
  if (Array.isArray(record.narrativeBlockNames)) {
    const names = record.narrativeBlockNames
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((name): name is StudyViewBlockName => BLOCK_NAME_SET.has(name));
    narrativeBlockNames = names.length > 0 ? names : [...DEFAULT_STUDY_VIEW_BLOCK_ORDER];
  }

  return {
    revision,
    canonicalStudy,
    intent: nullableStr(record.intent),
    facts,
    referencedDocuments,
    writerOutput: record.writerOutput ?? null,
    narrativeSections,
    narrativeBlockNames,
  };
}

function factsToWriteRecords(facts: readonly StudyTabViewFactRow[]): WriteFactRecord[] {
  return facts.map((fact) => ({
    id: fact.id,
    sourceDocumentId: fact.sourceDocumentId,
    pageNumber: fact.pageNumber,
    quote: fact.quote,
    valueAsWritten: fact.valueAsWritten,
    subject: fact.subject,
    attribute: fact.attribute,
  }));
}

function referencedToStudyView(refs: readonly StudyTabViewReferencedRow[]): StudyViewReferencedDocument[] {
  return refs.map((r) => ({
    sourceDocumentId: r.sourceDocumentId,
    description: r.description,
    page: r.page,
    quote: r.quote,
  }));
}

/** Builds study-view blocks from the canonical study; merges narrative sections when present. */
export function buildStudyTabViewPayload(
  tab: GetStudyTabViewResponse,
  fileNames: ReadonlyMap<string, string>,
): { view: StudyView; sources: StudyViewSources } | null {
  if (!tab.canonicalStudy) return null;

  const writeShape: WriteOutput =
    tab.narrativeSections != null
      ? {
          sections: tab.narrativeSections,
          blocks: [...(tab.narrativeBlockNames ?? DEFAULT_STUDY_VIEW_BLOCK_ORDER)],
          components: [],
        }
      : { sections: [], blocks: [...DEFAULT_STUDY_VIEW_BLOCK_ORDER], components: [] };

  const parsed = parseWriteOutput(writeShape);
  if (!parsed.ok) return null;

  const factRecords = factsToWriteRecords(tab.facts);
  const context =
    tab.referencedDocuments.length > 0 || tab.intent
      ? {
          ...(tab.intent ? { intent: tab.intent } : {}),
          ...(tab.referencedDocuments.length > 0 ? { referencedDocuments: referencedToStudyView(tab.referencedDocuments) } : {}),
        }
      : {};

  const { view } = buildStudyView(tab.canonicalStudy, parsed.value, factRecords, parsed.malformed, context);
  const sources = buildStudyViewSources(view, factRecords, fileNames);
  return { view, sources };
}

export type StudyTabViewBuild =
  | { ok: true; tab: GetStudyTabViewResponse; view: StudyView; sources: StudyViewSources }
  | { ok: false; tab: GetStudyTabViewResponse | null; reason: string };

/** Full pipeline: normalize RPC JSON, parse canonical study leniently for diagnostics, build view. */
export function buildStudyTabViewFromRpc(
  raw: unknown,
  fileNames: ReadonlyMap<string, string>,
): StudyTabViewBuild {
  const tab = normalizeGetStudyTabViewResponse(raw);
  if (!tab) return { ok: false, tab: null, reason: "response_shape" };
  if (!tab.canonicalStudy) return { ok: false, tab, reason: "no_canonical_study" };
  const built = buildStudyTabViewPayload(tab, fileNames);
  if (!built) return { ok: false, tab, reason: "build_failed" };
  return { ok: true, tab, view: built.view, sources: built.sources };
}
