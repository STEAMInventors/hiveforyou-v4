/**
 * `hive.canonical-study/1`: the output of `hive-canonicalize/1` (prompts/hive-canonicalize/HiveForYou-Canonicalize-v1.md).
 * The model's answer is untrusted candidate JSON. `parseCanonicalStudy` is lenient: unknown keys are
 * ignored, a malformed item is dropped and counted, and only a missing or non-object root is fatal.
 * Code assigns every spine, outside-spine, conflict and gap id; the model's ids are used only to
 * resolve `gaps[].relatedSpineIds`. `verifyCanonicalStudy` then checks fact ids against the case.
 */

import type { GapHolderType } from "./canonical-gap-holders";
import { normalizeGapHolderType } from "./canonical-gap-holders";
import type {
  CanonicalChainItem,
  CanonicalChecklistItem,
  CanonicalStandingQuestionItem,
  PersonaCoverageItem,
} from "./pack-canonicalize";

export const CANONICAL_STUDY_SCHEMA = "hive.canonical-study/1";
export const CANONICALIZE_PROMPT_ID = "hive-canonicalize/1";
export const CANONICALIZE_PROMPT_ID_V2 = "hive-canonicalize/2";

export const DOCUMENT_ROLES = ["ANCHOR", "SUPPORTING", "REFERENCE"] as const;
export type DocumentRole = (typeof DOCUMENT_ROLES)[number];

export const SPINE_SOURCES = ["ANCHOR", "ANCHOR_CHAIN", "TIMELINE", "PARTIES_AND_OBLIGATIONS"] as const;
export type SpineSource = (typeof SPINE_SOURCES)[number];

export const SPINE_STATUSES = ["CURRENT", "SUPERSEDED", "SUPPORTED", "CONFLICTED", "UNSUPPORTED", "OPEN"] as const;
export type SpineStatus = (typeof SPINE_STATUSES)[number];

export type CanonicalDocument = {
  sourceDocumentId: string;
  role: DocumentRole;
  typeInPlainWords: string;
  date: string | null;
  version: string | null;
  /** 1 = earliest version in an anchor chain; null outside a chain. */
  chainPosition: number | null;
};

export type SpineElement = {
  id: string;
  label: string;
  kind: string;
  status: SpineStatus | null;
  supportingFactIds: string[];
  contradictingFactIds: string[];
  updatingFactIds: string[];
  missing: string[];
};

export type OutsideSpineItem = { id: string; statement: string; factIds: string[] };
export type CanonicalConflict = { id: string; statement: string; factIds: string[] };
export type TimelineEntry = { date: string | null; asWritten: string; statement: string; factIds: string[] };
export const CANONICAL_GAP_KINDS = ["REQUESTABLE_DOCUMENT", "FUTURE_RECORD", "OBSERVATION"] as const;
export type CanonicalGapKind = (typeof CANONICAL_GAP_KINDS)[number];
export const CANONICAL_GAP_BASIS_TYPES = ["MENTIONED", "USUALLY_EXPECTED"] as const;
export type CanonicalGapBasisType = (typeof CANONICAL_GAP_BASIS_TYPES)[number];

export type { GapHolderType };

export type CanonicalGap = {
  id: string;
  statement: string;
  relatedSpineIds: string[];
  kind: CanonicalGapKind | null;
  title: string;
  why: string;
  holder: string;
  /** Code-validated holder category for requestable documents (set at canonicalize). */
  holderType: GapHolderType | null;
  when: string | null;
  basisType: CanonicalGapBasisType | null;
  relatedFactIds: string[];
};

export type CanonicalStudy = {
  schema: typeof CANONICAL_STUDY_SCHEMA;
  documents: CanonicalDocument[];
  spineSource: SpineSource | null;
  spine: SpineElement[];
  outsideSpine: OutsideSpineItem[];
  conflicts: CanonicalConflict[];
  timeline: TimelineEntry[];
  gaps: CanonicalGap[];
  domainLabel: string;
  checklist?: CanonicalChecklistItem[];
  chains?: CanonicalChainItem[];
  personaCoverage?: PersonaCoverageItem[];
  standingQuestions?: CanonicalStandingQuestionItem[];
  questionOrder?: string[];
  studyDate?: string;
  packRef?: { id: string; version: number };
};

export type CanonicalStudyParse =
  | {
      ok: true;
      value: CanonicalStudy;
      /** Malformed items dropped or repaired before verification, by reason. */
      malformed: Record<string, number>;
    }
  | { ok: false; reason: "canonical_root_invalid"; message: string };

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const nullableStr = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const strings = (value: unknown): string[] => [...new Set(arr(value).map(str).filter((item) => item !== ""))];
const isoDate = (value: unknown): string | null => {
  const text = nullableStr(value);
  return text !== null && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | null => {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (options as readonly string[]).includes(text) ? (text as T) : null;
};

class Tally {
  readonly counts: Record<string, number> = {};
  count(reason: string): void {
    this.counts[reason] = (this.counts[reason] ?? 0) + 1;
  }
  drop(reason: string): null {
    this.count(reason);
    return null;
  }
}

function document(value: unknown, tally: Tally): CanonicalDocument | null {
  if (!isRecord(value)) return tally.drop("document_not_object");
  const sourceDocumentId = str(value.sourceDocumentId);
  if (sourceDocumentId === "") return tally.drop("document_id_missing");
  const role = oneOf(DOCUMENT_ROLES, value.role);
  if (role === null) return tally.drop("document_role_invalid");
  const position = value.chainPosition;
  return {
    sourceDocumentId,
    role,
    typeInPlainWords: str(value.typeInPlainWords),
    date: isoDate(value.date),
    version: nullableStr(value.version),
    chainPosition: typeof position === "number" && Number.isInteger(position) && position >= 1 ? position : null,
  };
}

/**
 * Lenient structural parse of one model answer. Assigns ids in output order (`S1…`, `O1…`, `C1…`, `X1…`)
 * and rewrites `gaps[].relatedSpineIds` from the model's spine ids to the assigned ones; a reference to
 * no spine element is dropped and counted.
 */
export function parseCanonicalStudy(raw: unknown): CanonicalStudyParse {
  if (!isRecord(raw)) {
    return { ok: false, reason: "canonical_root_invalid", message: "The answer is not a JSON object." };
  }
  const tally = new Tally();
  const spineIds = new Map<string, string>();
  const spine: SpineElement[] = [];
  for (const item of arr(raw.spine)) {
    if (!isRecord(item)) {
      tally.count("spine_not_object");
      continue;
    }
    const label = str(item.label);
    if (label === "") {
      tally.count("spine_label_missing");
      continue;
    }
    const status = oneOf(SPINE_STATUSES, item.status);
    if (status === null) tally.count("spine_status_invalid");
    const id = `S${spine.length + 1}`;
    const modelId = str(item.id);
    if (modelId !== "" && !spineIds.has(modelId)) spineIds.set(modelId, id);
    spine.push({
      id,
      label,
      kind: str(item.kind),
      status,
      supportingFactIds: strings(item.supportingFactIds),
      contradictingFactIds: strings(item.contradictingFactIds),
      updatingFactIds: strings(item.updatingFactIds),
      missing: strings(item.missing),
    });
  }
  const statements = <T>(key: string, prefix: string | null, build: (item: Raw, statement: string, id: string) => T): T[] => {
    const out: T[] = [];
    for (const item of arr(raw[key])) {
      const statement = isRecord(item) ? str(item.statement) : "";
      if (!isRecord(item) || statement === "") {
        tally.count(`${key}_malformed`);
        continue;
      }
      out.push(build(item, statement, prefix === null ? "" : `${prefix}${out.length + 1}`));
    }
    return out;
  };
  const value: CanonicalStudy = {
    schema: CANONICAL_STUDY_SCHEMA,
    documents: arr(raw.documents).flatMap((item) => document(item, tally) ?? []),
    spineSource: oneOf(SPINE_SOURCES, raw.spineSource),
    spine,
    outsideSpine: statements("outsideSpine", "O", (item, statement, id) => ({ id, statement, factIds: strings(item.factIds) })),
    conflicts: statements("conflicts", "C", (item, statement, id) => ({ id, statement, factIds: strings(item.factIds) })),
    timeline: statements("timeline", null, (item, statement) => ({
      date: isoDate(item.date),
      asWritten: str(item.asWritten),
      statement,
      factIds: strings(item.factIds),
    })),
    gaps: statements("gaps", "X", (item, statement, id) => ({
      id,
      statement,
      relatedSpineIds: strings(item.relatedSpineIds).flatMap((ref) => {
        const mapped = spineIds.get(ref);
        if (mapped === undefined) tally.count("gap_spine_ref_unknown");
        return mapped === undefined ? [] : [mapped];
      }),
      kind: oneOf(CANONICAL_GAP_KINDS, item.kind),
      title: str(item.title),
      why: str(item.why),
      holder: str(item.holder),
      holderType: normalizeGapHolderType(item.holderType),
      when: nullableStr(item.when),
      basisType: oneOf(CANONICAL_GAP_BASIS_TYPES, item.basisType),
      relatedFactIds: strings(item.relatedFactIds),
    })),
    domainLabel: str(raw.domainLabel),
    checklist: parseOptionalChecklist(raw.checklist, tally),
    chains: parseOptionalChains(raw.chains, tally),
    personaCoverage: parseOptionalPersonaCoverage(raw.personaCoverage, tally),
    standingQuestions: parseOptionalStandingQuestions(raw.standingQuestions, tally),
    questionOrder: strings(raw.questionOrder),
    studyDate: isoDate(raw.studyDate) ?? undefined,
    packRef: parsePackRef(raw.packRef, tally),
  };
  if (raw.spineSource !== undefined && value.spineSource === null) tally.count("spine_source_invalid");
  return { ok: true, value, malformed: tally.counts };
}

function parsePackRef(raw: unknown, tally: Tally): { id: string; version: number } | undefined {
  if (!isRecord(raw)) return undefined;
  const id = str(raw.id);
  const version = raw.version;
  if (id === "" || typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    tally.count("pack_ref_invalid");
    return undefined;
  }
  return { id, version };
}

function parseOptionalChecklist(raw: unknown, tally: Tally): CanonicalChecklistItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: CanonicalChecklistItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      tally.count("checklist_item_invalid");
      continue;
    }
    const checkId = str(item.checkId);
    const verdict = str(item.verdict).toUpperCase();
    if (checkId === "" || verdict === "") continue;
    out.push({ checkId, verdict: verdict as CanonicalChecklistItem["verdict"], factIds: strings(item.factIds), note: str(item.note) });
  }
  return out.length > 0 ? out : undefined;
}

function parseOptionalChains(raw: unknown, tally: Tally): CanonicalChainItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: CanonicalChainItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const chainId = str(item.chainId);
    if (chainId === "") continue;
    const rows: CanonicalChainItem["rows"] = [];
    for (const row of arr(item.rows)) {
      if (!isRecord(row)) continue;
      const label = str(row.label);
      if (label === "") continue;
      const links: CanonicalChainItem["rows"][number]["links"] = [];
      for (const link of arr(row.links)) {
        if (!isRecord(link)) continue;
        if (link.missing === true) links.push({ missing: true });
        else links.push({ factIds: strings(link.factIds) });
      }
      rows.push({ label, links });
    }
    out.push({ chainId, rows });
  }
  return out.length > 0 ? out : undefined;
}

function parseOptionalStandingQuestions(raw: unknown, tally: Tally): CanonicalStandingQuestionItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: CanonicalStandingQuestionItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      tally.count("standing_question_item_invalid");
      continue;
    }
    const id = str(item.id);
    if (id === "") continue;
    const applies = item.applies === true;
    out.push({ id, applies, factIds: strings(item.factIds) });
  }
  return out.length > 0 ? out : undefined;
}

function parseOptionalPersonaCoverage(raw: unknown, tally: Tally): PersonaCoverageItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: PersonaCoverageItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const audience = str(item.audience);
    const questionId = str(item.questionId);
    const status = str(item.status).toUpperCase();
    if (audience === "" || questionId === "" || status === "") continue;
    out.push({
      audience,
      questionId,
      status: status as PersonaCoverageItem["status"],
      factIds: strings(item.factIds),
      checkIds: strings(item.checkIds),
      missing: str(item.missing),
    });
  }
  return out.length > 0 ? out : undefined;
}

export type CanonicalStudyDrops = {
  /** Fact id citations removed because the id is not a verified fact of the case. */
  unknownFactIds: number;
  /** Distinct unknown ids, for troubleshooting. */
  unknownFactIdList: string[];
  /** Spine elements set to `UNSUPPORTED` because no supporting or updating fact id remained. */
  spineMarkedUnsupported: number;
  /** Conflicts removed because fewer than two fact ids remained. */
  conflictsDropped: number;
};

/**
 * Removes every fact id the case does not contain, marks spine elements without a remaining supporting
 * or updating fact `UNSUPPORTED`, and drops conflicts left with fewer than two fact ids. Everything else
 * is kept. Never throws on content.
 */
export function verifyCanonicalStudy(
  study: CanonicalStudy,
  knownFactIds: ReadonlySet<string>,
): { study: CanonicalStudy; drops: CanonicalStudyDrops } {
  const unknown = new Set<string>();
  let unknownFactIds = 0;
  const keep = (ids: readonly string[]) =>
    ids.filter((id) => {
      if (knownFactIds.has(id)) return true;
      unknown.add(id);
      unknownFactIds += 1;
      return false;
    });
  let spineMarkedUnsupported = 0;
  const spine = study.spine.map((element) => {
    const next = {
      ...element,
      supportingFactIds: keep(element.supportingFactIds),
      contradictingFactIds: keep(element.contradictingFactIds),
      updatingFactIds: keep(element.updatingFactIds),
    };
    if (next.supportingFactIds.length === 0 && next.updatingFactIds.length === 0 && next.status !== "UNSUPPORTED") {
      spineMarkedUnsupported += 1;
      next.status = "UNSUPPORTED";
    }
    return next;
  });
  const conflicts = study.conflicts.map((conflict) => ({ ...conflict, factIds: keep(conflict.factIds) }));
  const keptConflicts = conflicts.filter((conflict) => conflict.factIds.length >= 2);
  return {
    study: {
      ...study,
      spine,
      outsideSpine: study.outsideSpine.map((item) => ({ ...item, factIds: keep(item.factIds) })),
      conflicts: keptConflicts,
      timeline: study.timeline.map((entry) => ({ ...entry, factIds: keep(entry.factIds) })),
    },
    drops: {
      unknownFactIds,
      unknownFactIdList: [...unknown],
      spineMarkedUnsupported,
      conflictsDropped: conflicts.length - keptConflicts.length,
    },
  };
}
