/**
 * `hive.doc-extraction/1`: the output of `hive-extract/1` (prompts/hive-extract/HiveForYou-Extract-v1.md, section 5).
 * The model's answer is untrusted candidate JSON. `validateDocExtraction` is lenient: unknown keys are
 * ignored, a malformed item is dropped and counted, and only a missing or non-object root is fatal.
 * Quotes are checked separately by `verifyExtraction`; final ids are assigned by `assignFactIds`.
 */

import { normalizeQuoteText } from "./verify-quotes";

export const DOC_EXTRACTION_SCHEMA = "hive.doc-extraction/1";
export const EXTRACT_PROMPT_ID = "hive-extract/1";

export const EXTRACTION_MODALITIES = [
  "stated",
  "measured",
  "planned",
  "recommended",
  "requested",
  "declined",
  "reported",
  "opinion",
  "historical",
] as const;
export type ExtractionModality = (typeof EXTRACTION_MODALITIES)[number];

export const EXTRACTION_CONFIDENCES = ["high", "medium", "low"] as const;
export type ExtractionConfidence = (typeof EXTRACTION_CONFIDENCES)[number];

export const KEY_DATE_KINDS = ["meeting date", "effective from", "effective to", "issued", "deadline", "other"] as const;
export type KeyDateKind = (typeof KEY_DATE_KINDS)[number];

export type PageQuote = { page: number; quote: string };
export type FactEvidence = { page: number; printedPageLabel: string | null; quote: string };

export type ExtractionPerson = {
  /** Model-local ref (`P1`, or `p21-40:P1` after a range merge) until `assignFactIds`, then `P-<documentKey>-NNN`. */
  ref: string | null;
  /** Model refs merged into this person, set by `assignFactIds`. */
  modelRefs?: string[];
  nameAsWritten: string;
  role: string;
  evidence: PageQuote[];
};
export type ExtractionKeyDate = { kind: KeyDateKind; date: string | null; asWritten: string; evidence: PageQuote[] };

export type ExtractionDocumentHeader = {
  titleAsPrinted: string;
  documentType: string;
  domain: { label: string; confidence: ExtractionConfidence | null };
  issuer: { name: string; evidence: PageQuote[] } | null;
  aboutPeople: ExtractionPerson[];
  keyDates: ExtractionKeyDate[];
  summary: string;
};

export type ExtractionFact = {
  /** Model-local id until `assignFactIds`, then `F-<documentKey>-NNN`. */
  id: string;
  /** The id the model gave (e.g. `F001` or `p21-40:F001`), kept for traceability. */
  modelId: string | null;
  category: string;
  subject: string;
  attribute: string;
  value: string | number | boolean | null;
  valueAsWritten: string;
  unit: string | null;
  per: string | null;
  timeframe: { from: string | null; to: string | null; asWritten: string | null };
  modality: ExtractionModality;
  attributedTo: string | null;
  aboutPersonRef: string | null;
  tableContext: { columns: string[] } | null;
  evidence: FactEvidence[];
  confidence: ExtractionConfidence | null;
};

export type ExtractionEmptyField = {
  id: string;
  modelId: string | null;
  label: string;
  page: number;
  quote: string;
  gapKind: string;
};

export type ExtractionReferencedDocument = {
  id: string;
  modelId: string | null;
  description: string;
  date: string | null;
  page: number;
  quote: string;
};

export type ExtractionGlossaryEntry = {
  term: string;
  expansion: string;
  source: "document" | "general_knowledge";
  page: number | null;
  quote: string | null;
  note: string | null;
};

export type ExtractionCoverage = {
  pageCount: number;
  pagesRead: number[];
  pagesBlankOrUnreadable: number[];
  truncated: boolean;
  lastPageCompleted: number;
};

export type DocExtraction = {
  schema: typeof DOC_EXTRACTION_SCHEMA;
  documentId: string;
  fileName: string;
  pageRange: string | null;
  document: ExtractionDocumentHeader;
  facts: ExtractionFact[];
  emptyFields: ExtractionEmptyField[];
  referencedDocuments: ExtractionReferencedDocument[];
  glossary: ExtractionGlossaryEntry[];
  instructionsIgnored: PageQuote[];
  coverage: ExtractionCoverage;
};

export type DocExtractionValidation =
  | {
      ok: true;
      value: DocExtraction;
      /** Facts in the answer, including malformed ones. */
      factsProposed: number;
      /** Malformed items dropped by reason (e.g. `fact_evidence_missing`). */
      malformed: Record<string, number>;
    }
  | { ok: false; reason: "extraction_root_invalid"; message: string };

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const nullableStr = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const pageNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const pageList = (value: unknown): number[] => arr(value).flatMap((item) => (pageNumber(item) === null ? [] : [item as number]));
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | null => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (options as readonly string[]).includes(text) ? (text as T) : null;
};

class Tally {
  readonly counts: Record<string, number> = {};
  drop(reason: string): null {
    this.counts[reason] = (this.counts[reason] ?? 0) + 1;
    return null;
  }
}

function pageQuote(value: unknown): PageQuote | null {
  if (!isRecord(value)) return null;
  const page = pageNumber(value.page);
  if (page === null || typeof value.quote !== "string" || value.quote.trim() === "") return null;
  return { page, quote: value.quote };
}

function pageQuotes(value: unknown): PageQuote[] {
  return arr(value).flatMap((item) => {
    const parsed = pageQuote(item);
    return parsed ? [parsed] : [];
  });
}

function factEvidence(value: unknown): FactEvidence[] {
  return arr(value).flatMap((item) => {
    const parsed = pageQuote(item);
    return parsed && isRecord(item) ? [{ ...parsed, printedPageLabel: nullableStr(item.printedPageLabel) }] : [];
  });
}

function factValue(value: unknown): ExtractionFact["value"] {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function fact(value: unknown, index: number, tally: Tally): ExtractionFact | null {
  if (!isRecord(value)) return tally.drop("fact_not_object");
  const evidence = factEvidence(value.evidence);
  if (evidence.length === 0) return tally.drop("fact_evidence_missing");
  if (typeof value.valueAsWritten !== "string" || value.valueAsWritten.trim() === "") {
    return tally.drop("fact_value_as_written_missing");
  }
  const modality = oneOf(EXTRACTION_MODALITIES, value.modality);
  if (modality === null) return tally.drop("fact_modality_invalid");
  const timeframe = isRecord(value.timeframe) ? value.timeframe : {};
  const columns = isRecord(value.tableContext) ? arr(value.tableContext.columns).filter((c) => typeof c === "string") : [];
  const modelId = nullableStr(value.id);
  return {
    id: modelId ?? `F${String(index + 1).padStart(3, "0")}`,
    modelId,
    category: str(value.category),
    subject: str(value.subject),
    attribute: str(value.attribute),
    value: factValue(value.value),
    valueAsWritten: value.valueAsWritten,
    unit: nullableStr(value.unit),
    per: nullableStr(value.per),
    timeframe: {
      from: nullableStr(timeframe.from),
      to: nullableStr(timeframe.to),
      asWritten: nullableStr(timeframe.asWritten),
    },
    modality,
    attributedTo: nullableStr(value.attributedTo),
    aboutPersonRef: nullableStr(value.aboutPersonRef),
    tableContext: columns.length > 0 ? { columns: columns as string[] } : null,
    evidence,
    confidence: oneOf(EXTRACTION_CONFIDENCES, value.confidence),
  };
}

function emptyField(value: unknown, index: number, tally: Tally): ExtractionEmptyField | null {
  const located = pageQuote(value);
  if (!located || !isRecord(value)) return tally.drop("empty_field_malformed");
  const modelId = nullableStr(value.id);
  return {
    id: modelId ?? `E${String(index + 1).padStart(3, "0")}`,
    modelId,
    label: str(value.label),
    ...located,
    gapKind: str(value.gapKind, "field_present_but_empty"),
  };
}

function referencedDocument(value: unknown, index: number, tally: Tally): ExtractionReferencedDocument | null {
  const located = pageQuote(value);
  if (!located || !isRecord(value)) return tally.drop("referenced_document_malformed");
  const modelId = nullableStr(value.id);
  return {
    id: modelId ?? `R${String(index + 1).padStart(3, "0")}`,
    modelId,
    description: str(value.description),
    date: nullableStr(value.date),
    ...located,
  };
}

function glossaryEntry(value: unknown, tally: Tally): ExtractionGlossaryEntry | null {
  if (!isRecord(value) || typeof value.term !== "string" || value.term.trim() === "") {
    return tally.drop("glossary_malformed");
  }
  return {
    term: value.term,
    expansion: str(value.expansion),
    source: value.source === "document" ? "document" : "general_knowledge",
    page: pageNumber(value.page),
    quote: nullableStr(value.quote),
    note: nullableStr(value.note),
  };
}

function header(value: unknown): ExtractionDocumentHeader {
  const doc = isRecord(value) ? value : {};
  const domain = isRecord(doc.domain) ? doc.domain : {};
  const issuer = isRecord(doc.issuer) ? doc.issuer : null;
  return {
    titleAsPrinted: str(doc.titleAsPrinted),
    documentType: str(doc.documentType),
    domain: { label: str(domain.label), confidence: oneOf(EXTRACTION_CONFIDENCES, domain.confidence) },
    issuer: issuer ? { name: str(issuer.name), evidence: pageQuotes(issuer.evidence) } : null,
    aboutPeople: arr(doc.aboutPeople).flatMap((item) =>
      isRecord(item)
        ? [{ ref: nullableStr(item.ref), nameAsWritten: str(item.nameAsWritten), role: str(item.role), evidence: pageQuotes(item.evidence) }]
        : [],
    ),
    keyDates: arr(doc.keyDates).flatMap((item) =>
      isRecord(item)
        ? [
            {
              kind: oneOf(KEY_DATE_KINDS, item.kind) ?? "other",
              date: nullableStr(item.date),
              asWritten: str(item.asWritten),
              evidence: pageQuotes(item.evidence),
            },
          ]
        : [],
    ),
    summary: str(doc.summary),
  };
}

function coverage(value: unknown): ExtractionCoverage {
  const raw = isRecord(value) ? value : {};
  const count = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0);
  return {
    pageCount: count(raw.pageCount),
    pagesRead: pageList(raw.pagesRead),
    pagesBlankOrUnreadable: pageList(raw.pagesBlankOrUnreadable),
    truncated: raw.truncated === true,
    lastPageCompleted: count(raw.lastPageCompleted),
  };
}

/**
 * Lenient structural validation of one model answer. `documentId` and `fileName` come from the
 * caller, never from the model.
 */
export function validateDocExtraction(
  raw: unknown,
  expected: { documentId: string; fileName: string; pageRange: string | null },
): DocExtractionValidation {
  if (!isRecord(raw)) {
    return { ok: false, reason: "extraction_root_invalid", message: "The answer is not a JSON object." };
  }
  const tally = new Tally();
  const rawFacts = arr(raw.facts);
  const keep = <T>(items: (T | null)[]) => items.filter((item): item is T => item !== null);
  return {
    ok: true,
    factsProposed: rawFacts.length,
    value: {
      schema: DOC_EXTRACTION_SCHEMA,
      documentId: expected.documentId,
      fileName: expected.fileName,
      pageRange: expected.pageRange,
      document: header(raw.document),
      facts: keep(rawFacts.map((item, index) => fact(item, index, tally))),
      emptyFields: keep(arr(raw.emptyFields).map((item, index) => emptyField(item, index, tally))),
      referencedDocuments: keep(arr(raw.referencedDocuments).map((item, index) => referencedDocument(item, index, tally))),
      glossary: keep(arr(raw.glossary).map((item) => glossaryEntry(item, tally))),
      instructionsIgnored: pageQuotes(raw.instructionsIgnored),
      coverage: coverage(raw.coverage),
    },
    malformed: tally.counts,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Short stable key for fact ids: the first 8 hex digits of the source document id. */
export function documentKeyFor(sourceDocumentId: string): string {
  if (!UUID.test(sourceDocumentId)) throw new Error("document_id_invalid");
  return sourceDocumentId.slice(0, 8).toLowerCase();
}

const finalId = (prefix: "F" | "E" | "R" | "P", documentKey: string, index: number) =>
  `${prefix}-${documentKey}-${String(index + 1).padStart(3, "0")}`;

const personKey = (name: string) => normalizeQuoteText(name).toLowerCase();

/**
 * People with the same normalized `nameAsWritten` become one person `P-<documentKey>-NNN`, numbered in
 * order of first appearance; a person without a name is never merged. Returns the people and a map
 * from every model ref to its final id.
 */
function assignPersonIds(
  people: readonly ExtractionPerson[],
  documentKey: string,
): { people: ExtractionPerson[]; refs: Map<string, string> } {
  const groups = new Map<string, ExtractionPerson & { modelRefs: string[] }>();
  const refs = new Map<string, string>();
  people.forEach((person, index) => {
    const name = personKey(person.nameAsWritten);
    const key = name === "" ? `#${index}` : name;
    let group = groups.get(key);
    if (!group) {
      group = { ...person, ref: finalId("P", documentKey, groups.size), modelRefs: [], evidence: [] };
      groups.set(key, group);
    }
    if (group.role.trim() === "") group.role = person.role;
    for (const item of person.evidence) {
      if (!group.evidence.some((e) => e.page === item.page && e.quote === item.quote)) group.evidence.push(item);
    }
    if (person.ref !== null) {
      if (!group.modelRefs.includes(person.ref)) group.modelRefs.push(person.ref);
      if (!refs.has(person.ref)) refs.set(person.ref, group.ref!);
    }
  });
  return { people: [...groups.values()], refs };
}

/**
 * Replaces model-local ids (`F001`, `p21-40:E002`, `P1`, ...) with run-unique ids `F-<documentKey>-001`,
 * numbered in document order. The model's id stays in `modelId` (`modelRefs` for people). Every
 * `aboutPersonRef` is rewritten to the final person id, or `null` when no kept person has that ref.
 */
export function assignFactIds(extraction: DocExtraction, documentKey: string): DocExtraction {
  if (!/^[0-9a-z]{1,16}$/.test(documentKey)) throw new Error("document_key_invalid");
  const { people, refs } = assignPersonIds(extraction.document.aboutPeople, documentKey);
  return {
    ...extraction,
    document: { ...extraction.document, aboutPeople: people },
    facts: extraction.facts.map((item, index) => ({
      ...item,
      id: finalId("F", documentKey, index),
      aboutPersonRef: item.aboutPersonRef === null ? null : (refs.get(item.aboutPersonRef) ?? null),
    })),
    emptyFields: extraction.emptyFields.map((item, index) => ({ ...item, id: finalId("E", documentKey, index) })),
    referencedDocuments: extraction.referencedDocuments.map((item, index) => ({ ...item, id: finalId("R", documentKey, index) })),
  };
}
