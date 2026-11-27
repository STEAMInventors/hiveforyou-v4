/**
 * Verifies extraction evidence against one frozen set of authorized pages.
 * Quote checks call `checkQuote`. Page identity calls `computeSha256Digest`.
 * This module does not call a model, build a prompt, schedule windows, or accept a Study.
 * A matching quotation does not accept a claim, a document role, or a Study.
 * Page text and quotation text are not stored. Model examination is not recorded.
 */
import { isValidUuid } from "../hives/hive-contracts";
import { computeSha256Digest, normalizeContentDigest } from "../source-documents/document-read-contracts";
import { canonicalPackJson, packDigest } from "./domain-pack-compiler";
import type { StudyContractIssue, StudyContractResult } from "./effective-domain-pack";
import type { DocExtraction } from "./extraction-contracts";
import { checkQuote, normalizeQuoteText, QUOTE_REJECTION_REASONS, type QuoteRejectionReason } from "./verify-quotes";

export const EXTRACTION_EVIDENCE_RECORD_SCHEMA = "hive.extraction-evidence-record/1" as const;
export const VERIFIED_EVIDENCE_INDEX_SCHEMA = "hive.verified-evidence-index/1" as const;
export const EXTRACTION_EVIDENCE_VERIFICATION_SCHEMA = "hive.extraction-evidence-verification/1" as const;
export const DOCUMENT_ROLE_EVIDENCE_SCHEMA = "hive.document-role-evidence/1" as const;
export const EXTRACTION_EVIDENCE_METHOD = "QUOTE_ON_PAGE" as const;

export const EXTRACTION_EVIDENCE_KINDS = ["FACT", "DOCUMENT_REFERENCE", "BLANK_FIELD"] as const;
export type ExtractionEvidenceKind = (typeof EXTRACTION_EVIDENCE_KINDS)[number];

export const EXTRACTION_EVIDENCE_OUTCOMES = [
  "QUOTE_MATCHED",
  "QUOTE_REJECTED",
  "CITATION_ABSENT",
  "SOURCE_DIGEST_MISMATCH",
  "UNAUTHORIZED_DOCUMENT",
] as const;
export type ExtractionEvidenceOutcome = (typeof EXTRACTION_EVIDENCE_OUTCOMES)[number];

export const EXTRACTION_EVIDENCE_REASONS = [
  ...QUOTE_REJECTION_REASONS,
  "quote_on_other_document",
  "source_digest_mismatch",
  "unauthorized_document",
] as const;
export type ExtractionEvidenceReason = (typeof EXTRACTION_EVIDENCE_REASONS)[number];

export const DOCUMENT_ROLE_EVIDENCE_STATUSES = ["VERIFIED", "UNAVAILABLE"] as const;
export type DocumentRoleEvidenceStatus = (typeof DOCUMENT_ROLE_EVIDENCE_STATUSES)[number];

export const EXTRACTION_EVIDENCE_AUDIT_KEYS = [
  "snapshotDigest",
  "verificationDigest",
  "indexDigest",
  "matchedCount",
  "unavailableCount",
] as const;

const ID = /^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/;
const INVENTED_QUOTE_KEYS = new Set([
  "quote",
  "quotes",
  "quotation",
  "quotations",
  "citation",
  "citations",
  "pageText",
  "text",
  "excerpt",
]);

export type FrozenCasePage = {
  documentId: string;
  pageNumber: number;
  text: string;
  sourcePageDigest: string;
};

export type VerifyExtractionEvidenceInput = {
  extractions: readonly DocExtraction[];
  pages: readonly FrozenCasePage[];
};

export type ExtractionEvidenceRecord = {
  schema: typeof EXTRACTION_EVIDENCE_RECORD_SCHEMA;
  extractionFactId: string;
  documentId: string;
  page: number | null;
  sourcePageDigest: string | null;
  kind: ExtractionEvidenceKind;
  outcome: ExtractionEvidenceOutcome;
  method: typeof EXTRACTION_EVIDENCE_METHOD;
  reason: ExtractionEvidenceReason | null;
  quoteDigest: string | null;
  ordinal: number;
  claimStatus: "NOT_ACCEPTED";
  recordDigest: string;
};

/** Matched evidence only. A later prompt may cite these records and no others. */
export type VerifiedEvidenceIndex = {
  schema: typeof VERIFIED_EVIDENCE_INDEX_SCHEMA;
  digest: string;
  snapshotDigest: string;
  claimStatus: "NOT_ACCEPTED";
  studyStatus: "NOT_ACCEPTED";
  records: ExtractionEvidenceRecord[];
};

export type ExtractionEvidenceVerification = {
  schema: typeof EXTRACTION_EVIDENCE_VERIFICATION_SCHEMA;
  digest: string;
  snapshotDigest: string;
  claimStatus: "NOT_ACCEPTED";
  studyStatus: "NOT_ACCEPTED";
  index: VerifiedEvidenceIndex;
  unavailable: ExtractionEvidenceRecord[];
};

export type DocumentRoleEvidenceBinding = {
  page: number;
  sourcePageDigest: string;
  quoteDigest: string;
};

/**
 * A role proposal names a verified fact. It does not carry a quotation.
 * `roleStatus` stays `NOT_ACCEPTED` when the fact is in the index.
 */
export type DocumentRoleEvidence = {
  schema: typeof DOCUMENT_ROLE_EVIDENCE_SCHEMA;
  proposalId: string;
  documentId: string;
  extractionFactId: string;
  role: string;
  indexDigest: string;
  evidenceStatus: DocumentRoleEvidenceStatus;
  roleStatus: "NOT_ACCEPTED";
  claimStatus: "NOT_ACCEPTED";
  studyStatus: "NOT_ACCEPTED";
  bindings: DocumentRoleEvidenceBinding[];
  digest: string;
};

export type ExtractionEvidenceAuditMetadata = Record<
  (typeof EXTRACTION_EVIDENCE_AUDIT_KEYS)[number],
  string | number
>;

type ObjectMap = Record<string, unknown>;
type PageState = { declared: string; text: string; authorized: boolean };
type EvidenceItem = {
  extractionFactId: string;
  documentId: string;
  kind: ExtractionEvidenceKind;
  page: number | null;
  quote: string | null;
  ordinal: number;
};

const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);
const reasonSet = new Set<string>(EXTRACTION_EVIDENCE_REASONS);

function issue(into: StudyContractIssue[], code: string, path: string, message: string): void {
  into.push({ code, path, message });
}

function finish<T>(issues: StudyContractIssue[], value: T): StudyContractResult<T> {
  if (issues.length > 0) {
    const sorted = [...issues].sort((left, right) => (left.path + "\0" + left.code).localeCompare(right.path + "\0" + right.code));
    return { ok: false, issues: sorted };
  }
  return { ok: true, value: freezeDeep(value) };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value: ObjectMap, allowed: readonly string[], path: string, issues: StudyContractIssue[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) issue(issues, "unknown_field", path + "." + key, "Field is not part of this contract.");
  }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function documentId(value: unknown): string | null {
  return typeof value === "string" && isValidUuid(value) ? value.toLowerCase() : null;
}

function pageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100000 ? value : null;
}

function citationDigest(quote: string): string {
  return packDigest(normalizeQuoteText(quote));
}

function recordSortKey(record: Pick<ExtractionEvidenceRecord, "documentId" | "extractionFactId" | "kind" | "page" | "ordinal" | "quoteDigest">): string {
  return [record.documentId, record.extractionFactId, record.kind, record.page ?? "", record.ordinal, record.quoteDigest ?? ""].join("\0");
}

function compareRecords(left: ExtractionEvidenceRecord, right: ExtractionEvidenceRecord): number {
  return recordSortKey(left).localeCompare(recordSortKey(right));
}

function groupKey(record: Pick<ExtractionEvidenceRecord, "documentId" | "extractionFactId">): string {
  return record.documentId + "\0" + record.extractionFactId;
}

function recordBody(record: Omit<ExtractionEvidenceRecord, "recordDigest">): unknown {
  return {
    schema: record.schema,
    extractionFactId: record.extractionFactId,
    documentId: record.documentId,
    page: record.page,
    sourcePageDigest: record.sourcePageDigest,
    kind: record.kind,
    outcome: record.outcome,
    method: record.method,
    reason: record.reason,
    quoteDigest: record.quoteDigest,
    ordinal: record.ordinal,
    claimStatus: record.claimStatus,
  };
}

function indexBody(index: Omit<VerifiedEvidenceIndex, "digest">): unknown {
  return {
    schema: index.schema,
    snapshotDigest: index.snapshotDigest,
    claimStatus: index.claimStatus,
    studyStatus: index.studyStatus,
    records: index.records,
  };
}

function verificationBody(result: Omit<ExtractionEvidenceVerification, "digest">): unknown {
  return {
    schema: result.schema,
    snapshotDigest: result.snapshotDigest,
    claimStatus: result.claimStatus,
    studyStatus: result.studyStatus,
    index: result.index,
    unavailable: result.unavailable,
  };
}

function roleBody(result: Omit<DocumentRoleEvidence, "digest">): unknown {
  return {
    schema: result.schema,
    proposalId: result.proposalId,
    documentId: result.documentId,
    extractionFactId: result.extractionFactId,
    role: result.role,
    indexDigest: result.indexDigest,
    evidenceStatus: result.evidenceStatus,
    roleStatus: result.roleStatus,
    claimStatus: result.claimStatus,
    studyStatus: result.studyStatus,
    bindings: result.bindings,
  };
}

function sealRecord(draft: Omit<ExtractionEvidenceRecord, "schema" | "method" | "claimStatus" | "recordDigest">): ExtractionEvidenceRecord {
  const built: Omit<ExtractionEvidenceRecord, "recordDigest"> = {
    schema: EXTRACTION_EVIDENCE_RECORD_SCHEMA,
    ...draft,
    method: EXTRACTION_EVIDENCE_METHOD,
    claimStatus: "NOT_ACCEPTED",
  };
  return { ...built, recordDigest: packDigest(recordBody(built)) };
}

function snapshotBody(pages: readonly { documentId: string; pageNumber: number; sourcePageDigest: string }[]): unknown {
  return [...pages]
    .map((page) => ({ documentId: page.documentId, pageNumber: page.pageNumber, sourcePageDigest: page.sourcePageDigest }))
    .sort((left, right) => (left.documentId + "\0" + left.pageNumber).localeCompare(right.documentId + "\0" + right.pageNumber));
}

function quoteOnAnotherDocument(
  quote: string,
  documentId: string,
  corpus: ReadonlyMap<string, ReadonlyMap<number, string>>,
): boolean {
  for (const [otherId, pages] of corpus) {
    if (otherId === documentId || pages.size === 0) continue;
    const sample = pages.keys().next().value;
    if (sample === undefined) continue;
    const reason = checkQuote({ page: sample, quote }, pages);
    if (reason === null || reason === "quote_on_other_page") return true;
  }
  return false;
}

function classifyQuote(
  documentId: string,
  page: number,
  quote: string,
  states: ReadonlyMap<string, ReadonlyMap<number, PageState>>,
  authorized: ReadonlyMap<string, ReadonlyMap<number, string>>,
): { outcome: ExtractionEvidenceOutcome; reason: ExtractionEvidenceReason | null; sourcePageDigest: string | null } {
  const doc = states.get(documentId);
  if (!doc) return { outcome: "UNAUTHORIZED_DOCUMENT", reason: "unauthorized_document", sourcePageDigest: null };
  const state = doc.get(page);
  if (state && !state.authorized) {
    return { outcome: "SOURCE_DIGEST_MISMATCH", reason: "source_digest_mismatch", sourcePageDigest: state.declared };
  }
  const pages = authorized.get(documentId) ?? new Map<number, string>();
  let reason: ExtractionEvidenceReason | null = checkQuote({ page, quote }, pages);
  if ((reason === "quote_not_found" || reason === "page_not_provided") && quoteOnAnotherDocument(quote, documentId, authorized)) {
    reason = "quote_on_other_document";
  }
  if (reason === null && state?.authorized) {
    return { outcome: "QUOTE_MATCHED", reason: null, sourcePageDigest: state.declared };
  }
  return {
    outcome: "QUOTE_REJECTED",
    reason: reason ?? "quote_not_found",
    sourcePageDigest: state?.declared ?? null,
  };
}

function evidenceOrdinal(page: number, quote: string, index: number): string {
  return page + "\0" + normalizeQuoteText(quote) + "\0" + index;
}

function pushQuoted(
  items: EvidenceItem[],
  issues: StudyContractIssue[],
  path: string,
  input: { extractionFactId: string; documentId: string; kind: ExtractionEvidenceKind; page: unknown; quote: unknown; ordinal: number },
): void {
  const page = pageNumber(input.page);
  if (page === null) {
    issue(issues, "citation_invalid", path + ".page", "Page must be a positive integer.");
    return;
  }
  if (typeof input.quote !== "string") {
    issue(issues, "citation_invalid", path + ".quote", "A citation quote must be text.");
    return;
  }
  items.push({ ...input, page, quote: input.quote });
}

function evidenceSortToken(item: ObjectMap, index: number): string {
  const page = typeof item.page === "number" ? item.page : 0;
  const quote = typeof item.quote === "string" ? item.quote : "";
  return evidenceOrdinal(page, quote, index);
}

function itemsFromExtraction(extraction: ObjectMap, path: string, issues: StudyContractIssue[]): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const id = documentId(extraction.documentId);
  if (!id) {
    issue(issues, "document_invalid", path + ".documentId", "Document id must be a UUID.");
    return items;
  }
  const facts = extraction.facts;
  const emptyFields = extraction.emptyFields;
  const referencedDocuments = extraction.referencedDocuments;
  if (!Array.isArray(facts) || !Array.isArray(emptyFields) || !Array.isArray(referencedDocuments)) {
    issue(issues, "extraction_invalid", path, "Extraction evidence lists must be arrays.");
    return items;
  }
  facts.forEach((fact, factIndex) => {
    const factPath = path + ".facts[" + factIndex + "]";
    if (!isObject(fact)) {
      issue(issues, "fact_invalid", factPath, "An extracted fact must be an object.");
      return;
    }
    if (!validId(fact.id)) {
      issue(issues, "fact_id_invalid", factPath + ".id", "Extraction fact id is not part of the shared contract.");
      return;
    }
    const factId = fact.id;
    if (!Array.isArray(fact.evidence)) {
      issue(issues, "citation_invalid", factPath + ".evidence", "Fact evidence must be an array.");
      return;
    }
    if (fact.evidence.length === 0) {
      items.push({ extractionFactId: factId, documentId: id, kind: "FACT", page: null, quote: null, ordinal: 0 });
      return;
    }
    const evidence: { item: ObjectMap; index: number }[] = [];
    fact.evidence.forEach((item, index) => {
      if (!isObject(item)) issue(issues, "citation_invalid", factPath + ".evidence[" + index + "]", "Fact evidence must be an object.");
      else evidence.push({ item, index });
    });
    if (evidence.length !== fact.evidence.length) return;
    evidence
      .sort((left, right) => evidenceSortToken(left.item, left.index).localeCompare(evidenceSortToken(right.item, right.index)))
      .forEach((entry, ordinal) => {
        pushQuoted(items, issues, factPath + ".evidence[" + entry.index + "]", {
          extractionFactId: factId,
          documentId: id,
          kind: "FACT",
          page: entry.item.page,
          quote: entry.item.quote,
          ordinal,
        });
      });
  });
  emptyFields.forEach((field, index) => {
    const fieldPath = path + ".emptyFields[" + index + "]";
    if (!isObject(field) || !validId(field.id)) {
      issue(issues, "fact_id_invalid", fieldPath + ".id", "Blank-field id is not part of the shared contract.");
      return;
    }
    pushQuoted(items, issues, fieldPath, {
      extractionFactId: field.id,
      documentId: id,
      kind: "BLANK_FIELD",
      page: field.page,
      quote: field.quote,
      ordinal: 0,
    });
  });
  referencedDocuments.forEach((reference, index) => {
    const referencePath = path + ".referencedDocuments[" + index + "]";
    if (!isObject(reference) || !validId(reference.id)) {
      issue(issues, "fact_id_invalid", referencePath + ".id", "Document-reference id is not part of the shared contract.");
      return;
    }
    pushQuoted(items, issues, referencePath, {
      extractionFactId: reference.id,
      documentId: id,
      kind: "DOCUMENT_REFERENCE",
      page: reference.page,
      quote: reference.quote,
      ordinal: 0,
    });
  });
  return items;
}

function readFrozenPages(
  pages: readonly FrozenCasePage[],
  issues: StudyContractIssue[],
): { states: Map<string, Map<number, PageState>>; authorized: Map<string, Map<number, string>>; snapshotDigest: string } | null {
  const states = new Map<string, Map<number, PageState>>();
  const identity: { documentId: string; pageNumber: number; sourcePageDigest: string }[] = [];
  pages.forEach((page, index) => {
    const path = "$.pages[" + index + "]";
    if (!isObject(page)) {
      issue(issues, "page_invalid", path, "A frozen page must be an object.");
      return;
    }
    const id = documentId(page.documentId);
    const number = pageNumber(page.pageNumber);
    const declared = normalizeContentDigest(page.sourcePageDigest);
    if (!id) issue(issues, "document_invalid", path + ".documentId", "Document id must be a UUID.");
    if (number === null) issue(issues, "page_invalid", path + ".pageNumber", "Page must be a positive integer.");
    if (typeof page.text !== "string") issue(issues, "page_invalid", path + ".text", "Frozen page text must be a string.");
    if (!declared) issue(issues, "digest_invalid", path + ".sourcePageDigest", "Source-page digest must be a SHA-256 content digest.");
    if (!id || number === null || typeof page.text !== "string" || !declared) return;
    let doc = states.get(id);
    if (!doc) {
      doc = new Map();
      states.set(id, doc);
    }
    if (doc.has(number)) {
      issue(issues, "duplicate_page", path, "Each authorized page number is listed once.");
      return;
    }
    const authorized = declared === computeSha256Digest(page.text);
    doc.set(number, { declared, text: page.text, authorized });
    identity.push({ documentId: id, pageNumber: number, sourcePageDigest: declared });
  });
  if (issues.length > 0) return null;
  const authorized = new Map<string, Map<number, string>>();
  for (const [id, doc] of states) {
    const texts = new Map<number, string>();
    for (const [number, state] of doc) {
      if (state.authorized) texts.set(number, normalizeQuoteText(state.text));
    }
    authorized.set(id, texts);
  }
  return { states, authorized, snapshotDigest: packDigest(snapshotBody(identity)) };
}

function partition(records: readonly ExtractionEvidenceRecord[]): { indexRecords: ExtractionEvidenceRecord[]; unavailable: ExtractionEvidenceRecord[] } {
  const groups = new Map<string, ExtractionEvidenceRecord[]>();
  for (const record of records) {
    const key = groupKey(record);
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }
  const indexRecords: ExtractionEvidenceRecord[] = [];
  const unavailable: ExtractionEvidenceRecord[] = [];
  for (const list of groups.values()) {
    const target = list.every((record) => record.outcome === "QUOTE_MATCHED") ? indexRecords : unavailable;
    target.push(...list);
  }
  indexRecords.sort(compareRecords);
  unavailable.sort(compareRecords);
  return { indexRecords, unavailable };
}

function partitionAgrees(indexRecords: readonly ExtractionEvidenceRecord[], unavailable: readonly ExtractionEvidenceRecord[]): boolean {
  const groups = new Map<string, { index: number; unavailable: number; matched: boolean }>();
  const touch = (record: ExtractionEvidenceRecord, side: "index" | "unavailable") => {
    const key = groupKey(record);
    const group = groups.get(key) ?? { index: 0, unavailable: 0, matched: true };
    group[side] += 1;
    if (record.outcome !== "QUOTE_MATCHED") group.matched = false;
    groups.set(key, group);
  };
  indexRecords.forEach((record) => touch(record, "index"));
  unavailable.forEach((record) => touch(record, "unavailable"));
  for (const group of groups.values()) {
    if (group.matched && (group.unavailable !== 0 || group.index === 0)) return false;
    if (!group.matched && group.index !== 0) return false;
  }
  return true;
}

function sortedRecords(records: readonly ExtractionEvidenceRecord[]): boolean {
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1];
    const current = records[index];
    if (!previous || !current || recordSortKey(previous).localeCompare(recordSortKey(current)) > 0) return false;
  }
  return true;
}

function readRecord(raw: unknown, path: string, issues: StudyContractIssue[]): ExtractionEvidenceRecord | null {
  if (!isObject(raw)) {
    issue(issues, "record_invalid", path, "An evidence record must be an object.");
    return null;
  }
  exactKeys(raw, [
    "schema", "extractionFactId", "documentId", "page", "sourcePageDigest", "kind", "outcome", "method",
    "reason", "quoteDigest", "ordinal", "claimStatus", "recordDigest",
  ], path, issues);
  if (raw.schema !== EXTRACTION_EVIDENCE_RECORD_SCHEMA) issue(issues, "schema_invalid", path + ".schema", "Unsupported evidence schema.");
  if (raw.method !== EXTRACTION_EVIDENCE_METHOD) issue(issues, "method_invalid", path + ".method", "Verification method must be an independent quote check.");
  if (raw.claimStatus !== "NOT_ACCEPTED") issue(issues, "claim_not_accepted", path + ".claimStatus", "A quote check does not accept a claim.");
  if (!validId(raw.extractionFactId) || !documentId(raw.documentId)) issue(issues, "record_invalid", path, "Fact id and document id are required.");
  if (!(EXTRACTION_EVIDENCE_KINDS as readonly string[]).includes(String(raw.kind))) issue(issues, "kind_invalid", path + ".kind", "Evidence kind is not part of the shared contract.");
  if (!(EXTRACTION_EVIDENCE_OUTCOMES as readonly string[]).includes(String(raw.outcome))) issue(issues, "outcome_invalid", path + ".outcome", "Verification outcome is not recognized.");
  if (typeof raw.ordinal !== "number" || !Number.isInteger(raw.ordinal) || raw.ordinal < 0) issue(issues, "record_invalid", path + ".ordinal", "Ordinal must be a non-negative integer.");
  if (typeof raw.recordDigest !== "string" || !/^[a-f0-9]{64}$/.test(raw.recordDigest)) issue(issues, "digest_invalid", path + ".recordDigest", "Expected a SHA-256 digest.");
  const page = raw.page === null ? null : pageNumber(raw.page);
  if (raw.page !== null && page === null) issue(issues, "citation_invalid", path + ".page", "Page must be a positive integer or null.");
  const sourcePageDigest = raw.sourcePageDigest === null ? null : normalizeContentDigest(raw.sourcePageDigest);
  if (raw.sourcePageDigest !== null && sourcePageDigest === null) issue(issues, "digest_invalid", path + ".sourcePageDigest", "Source-page digest must be a SHA-256 content digest.");
  const quoteDigest = raw.quoteDigest === null ? null : typeof raw.quoteDigest === "string" && /^[a-f0-9]{64}$/.test(raw.quoteDigest) ? raw.quoteDigest : undefined;
  if (quoteDigest === undefined) issue(issues, "digest_invalid", path + ".quoteDigest", "Quote digest must be a SHA-256 digest or null.");
  const reason = raw.reason === null ? null : typeof raw.reason === "string" && reasonSet.has(raw.reason) ? raw.reason as ExtractionEvidenceReason : undefined;
  if (reason === undefined) issue(issues, "reason_invalid", path + ".reason", "Evidence reason is not recognized.");
  if (issues.length > 0 || !validId(raw.extractionFactId) || !documentId(raw.documentId) || quoteDigest === undefined || reason === undefined) return null;
  const outcome = raw.outcome as ExtractionEvidenceOutcome;
  if (outcome === "QUOTE_MATCHED" && (reason !== null || page === null || sourcePageDigest === null || quoteDigest === null)) {
    issue(issues, "outcome_mismatch", path + ".outcome", "A matched quotation binds a page, a source digest, and a quote digest.");
  }
  if (outcome === "CITATION_ABSENT" && (reason !== null || page !== null || sourcePageDigest !== null || quoteDigest !== null)) {
    issue(issues, "outcome_mismatch", path + ".outcome", "An absent citation has no page, digest, or quote.");
  }
  if (outcome === "SOURCE_DIGEST_MISMATCH" && (reason !== "source_digest_mismatch" || page === null || sourcePageDigest === null)) {
    issue(issues, "outcome_mismatch", path + ".outcome", "A stale source page keeps the cited page and its declared digest.");
  }
  if (outcome === "UNAUTHORIZED_DOCUMENT" && (reason !== "unauthorized_document" || sourcePageDigest !== null)) {
    issue(issues, "outcome_mismatch", path + ".outcome", "An unauthorized document has no frozen page digest.");
  }
  if (outcome === "QUOTE_REJECTED" && (reason === null || reason === "source_digest_mismatch" || reason === "unauthorized_document")) {
    issue(issues, "outcome_mismatch", path + ".outcome", "A rejected quotation names a quote rejection.");
  }
  if (issues.length > 0) return null;
  const built: Omit<ExtractionEvidenceRecord, "recordDigest"> = {
    schema: EXTRACTION_EVIDENCE_RECORD_SCHEMA,
    extractionFactId: raw.extractionFactId,
    documentId: documentId(raw.documentId) as string,
    page,
    sourcePageDigest,
    kind: raw.kind as ExtractionEvidenceKind,
    outcome,
    method: EXTRACTION_EVIDENCE_METHOD,
    reason,
    quoteDigest,
    ordinal: raw.ordinal as number,
    claimStatus: "NOT_ACCEPTED",
  };
  if (packDigest(recordBody(built)) !== raw.recordDigest) {
    issue(issues, "digest_mismatch", path + ".recordDigest", "Evidence digest does not match its body.");
    return null;
  }
  return { ...built, recordDigest: raw.recordDigest };
}

function readRecords(raw: unknown, path: string, issues: StudyContractIssue[]): ExtractionEvidenceRecord[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, "records_invalid", path, "Evidence records must be an array.");
    return null;
  }
  const records: ExtractionEvidenceRecord[] = [];
  raw.forEach((item, index) => {
    const record = readRecord(item, path + "[" + index + "]", issues);
    if (record) records.push(record);
  });
  if (records.length !== raw.length || issues.length > 0) return null;
  if (!sortedRecords(records)) {
    issue(issues, "record_order", path, "Evidence records are stored in canonical order.");
    return null;
  }
  return records;
}

export function parseVerifiedEvidenceIndex(raw: unknown): StudyContractResult<VerifiedEvidenceIndex> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(raw)) return finish([{ code: "index_invalid", path: "$", message: "Expected an object." }], undefined as never);
  exactKeys(raw, ["schema", "digest", "snapshotDigest", "claimStatus", "studyStatus", "records"], "$", issues);
  if (raw.schema !== VERIFIED_EVIDENCE_INDEX_SCHEMA) issue(issues, "schema_invalid", "$.schema", "Unsupported evidence index schema.");
  if (raw.claimStatus !== "NOT_ACCEPTED") issue(issues, "claim_not_accepted", "$.claimStatus", "An evidence index does not accept a claim.");
  if (raw.studyStatus !== "NOT_ACCEPTED") issue(issues, "study_not_accepted", "$.studyStatus", "An evidence index does not accept a Study.");
  if (typeof raw.digest !== "string" || !/^[a-f0-9]{64}$/.test(raw.digest)) issue(issues, "digest_invalid", "$.digest", "Expected a SHA-256 digest.");
  if (typeof raw.snapshotDigest !== "string" || !/^[a-f0-9]{64}$/.test(raw.snapshotDigest)) issue(issues, "digest_invalid", "$.snapshotDigest", "Expected a SHA-256 digest.");
  const records = readRecords(raw.records, "$.records", issues);
  if (!records || issues.length > 0) return finish(issues, undefined as never);
  if (records.some((record) => record.outcome !== "QUOTE_MATCHED")) {
    issue(issues, "index_unavailable", "$.records", "The evidence index contains only matched quotations.");
  }
  const built: Omit<VerifiedEvidenceIndex, "digest"> = {
    schema: VERIFIED_EVIDENCE_INDEX_SCHEMA,
    snapshotDigest: raw.snapshotDigest as string,
    claimStatus: "NOT_ACCEPTED",
    studyStatus: "NOT_ACCEPTED",
    records,
  };
  if (issues.length > 0) return finish(issues, undefined as never);
  if (packDigest(indexBody(built)) !== raw.digest) issue(issues, "digest_mismatch", "$.digest", "Evidence index digest does not match its body.");
  return finish(issues, { ...built, digest: raw.digest as string });
}

export function parseExtractionEvidenceVerification(raw: unknown): StudyContractResult<ExtractionEvidenceVerification> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(raw)) return finish([{ code: "verification_invalid", path: "$", message: "Expected an object." }], undefined as never);
  exactKeys(raw, ["schema", "digest", "snapshotDigest", "claimStatus", "studyStatus", "index", "unavailable"], "$", issues);
  if (raw.schema !== EXTRACTION_EVIDENCE_VERIFICATION_SCHEMA) issue(issues, "schema_invalid", "$.schema", "Unsupported verification schema.");
  if (raw.claimStatus !== "NOT_ACCEPTED") issue(issues, "claim_not_accepted", "$.claimStatus", "Evidence verification does not accept a claim.");
  if (raw.studyStatus !== "NOT_ACCEPTED") issue(issues, "study_not_accepted", "$.studyStatus", "Evidence verification does not accept a Study.");
  if (typeof raw.digest !== "string" || !/^[a-f0-9]{64}$/.test(raw.digest)) issue(issues, "digest_invalid", "$.digest", "Expected a SHA-256 digest.");
  const index = parseVerifiedEvidenceIndex(raw.index);
  if (!index.ok) index.issues.forEach((item) => issue(issues, item.code, "$.index" + (item.path === "$" ? "" : item.path.slice(1)), item.message));
  const unavailable = readRecords(raw.unavailable, "$.unavailable", issues);
  if (!index.ok || !unavailable || issues.length > 0) return finish(issues, undefined as never);
  if (index.value.snapshotDigest !== raw.snapshotDigest) issue(issues, "digest_mismatch", "$.snapshotDigest", "Verification and index name different snapshots.");
  if (!partitionAgrees(index.value.records, unavailable)) {
    issue(issues, "index_unavailable", "$.index", "Mismatched evidence is not available for acceptance.");
  }
  if (issues.length > 0) return finish(issues, undefined as never);
  const built: Omit<ExtractionEvidenceVerification, "digest"> = {
    schema: EXTRACTION_EVIDENCE_VERIFICATION_SCHEMA,
    snapshotDigest: raw.snapshotDigest as string,
    claimStatus: "NOT_ACCEPTED",
    studyStatus: "NOT_ACCEPTED",
    index: index.value,
    unavailable,
  };
  if (packDigest(verificationBody(built)) !== raw.digest) issue(issues, "digest_mismatch", "$.digest", "Verification digest does not match its body.");
  return finish(issues, { ...built, digest: raw.digest as string });
}

export function verifyExtractionEvidence(input: VerifyExtractionEvidenceInput): StudyContractResult<ExtractionEvidenceVerification> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(input) || !Array.isArray(input.extractions) || !Array.isArray(input.pages)) {
    return finish([{ code: "verification_invalid", path: "$", message: "Expected extractions and frozen pages." }], undefined as never);
  }
  const frozen = readFrozenPages(input.pages, issues);
  const items: EvidenceItem[] = [];
  input.extractions.forEach((extraction, index) => {
    if (!isObject(extraction)) {
      issue(issues, "extraction_invalid", "$.extractions[" + index + "]", "An extraction must be an object.");
      return;
    }
    items.push(...itemsFromExtraction(extraction, "$.extractions[" + index + "]", issues));
  });
  if (!frozen || issues.length > 0) return finish(issues, undefined as never);
  const records = items.map((item) => {
    if (item.page === null || item.quote === null) {
      return sealRecord({
        extractionFactId: item.extractionFactId,
        documentId: item.documentId,
        page: null,
        sourcePageDigest: null,
        kind: item.kind,
        outcome: "CITATION_ABSENT",
        reason: null,
        quoteDigest: null,
        ordinal: item.ordinal,
      });
    }
    const classified = classifyQuote(item.documentId, item.page, item.quote, frozen.states, frozen.authorized);
    return sealRecord({
      extractionFactId: item.extractionFactId,
      documentId: item.documentId,
      page: item.page,
      sourcePageDigest: classified.sourcePageDigest,
      kind: item.kind,
      outcome: classified.outcome,
      reason: classified.reason,
      quoteDigest: citationDigest(item.quote),
      ordinal: item.ordinal,
    });
  });
  const { indexRecords, unavailable } = partition(records);
  const indexBuilt: Omit<VerifiedEvidenceIndex, "digest"> = {
    schema: VERIFIED_EVIDENCE_INDEX_SCHEMA,
    snapshotDigest: frozen.snapshotDigest,
    claimStatus: "NOT_ACCEPTED",
    studyStatus: "NOT_ACCEPTED",
    records: indexRecords,
  };
  const index: VerifiedEvidenceIndex = { ...indexBuilt, digest: packDigest(indexBody(indexBuilt)) };
  const built: Omit<ExtractionEvidenceVerification, "digest"> = {
    schema: EXTRACTION_EVIDENCE_VERIFICATION_SCHEMA,
    snapshotDigest: frozen.snapshotDigest,
    claimStatus: "NOT_ACCEPTED",
    studyStatus: "NOT_ACCEPTED",
    index,
    unavailable,
  };
  return parseExtractionEvidenceVerification({ ...built, digest: packDigest(verificationBody(built)) });
}

function readBindings(raw: unknown, path: string, issues: StudyContractIssue[]): DocumentRoleEvidenceBinding[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, "bindings_invalid", path, "Role bindings must be an array.");
    return null;
  }
  const bindings: DocumentRoleEvidenceBinding[] = [];
  raw.forEach((item, index) => {
    const bindingPath = path + "[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "bindings_invalid", bindingPath, "A role binding must be an object.");
      return;
    }
    exactKeys(item, ["page", "sourcePageDigest", "quoteDigest"], bindingPath, issues);
    const page = pageNumber(item.page);
    const sourcePageDigest = normalizeContentDigest(item.sourcePageDigest);
    if (page === null || !sourcePageDigest || typeof item.quoteDigest !== "string" || !/^[a-f0-9]{64}$/.test(item.quoteDigest)) {
      issue(issues, "bindings_invalid", bindingPath, "A role binding keeps the verified page, source digest, and quote digest.");
      return;
    }
    bindings.push({ page, sourcePageDigest, quoteDigest: item.quoteDigest });
  });
  if (bindings.length !== raw.length || issues.length > 0) return null;
  return bindings;
}

export function parseDocumentRoleEvidence(raw: unknown): StudyContractResult<DocumentRoleEvidence> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(raw)) return finish([{ code: "role_invalid", path: "$", message: "Expected an object." }], undefined as never);
  exactKeys(raw, [
    "schema", "proposalId", "documentId", "extractionFactId", "role", "indexDigest", "evidenceStatus",
    "roleStatus", "claimStatus", "studyStatus", "bindings", "digest",
  ], "$", issues);
  if (raw.schema !== DOCUMENT_ROLE_EVIDENCE_SCHEMA) issue(issues, "schema_invalid", "$.schema", "Unsupported document-role schema.");
  if (raw.roleStatus !== "NOT_ACCEPTED") issue(issues, "role_not_accepted", "$.roleStatus", "A verified quotation does not accept a document role.");
  if (raw.claimStatus !== "NOT_ACCEPTED") issue(issues, "claim_not_accepted", "$.claimStatus", "A document role does not accept a claim.");
  if (raw.studyStatus !== "NOT_ACCEPTED") issue(issues, "study_not_accepted", "$.studyStatus", "A document role does not accept a Study.");
  if (!validId(raw.proposalId) || !validId(raw.extractionFactId) || !validId(raw.role) || !documentId(raw.documentId)) {
    issue(issues, "role_invalid", "$", "Proposal, document, fact, and role ids are required.");
  }
  if (!(DOCUMENT_ROLE_EVIDENCE_STATUSES as readonly string[]).includes(String(raw.evidenceStatus))) {
    issue(issues, "evidence_status_invalid", "$.evidenceStatus", "Document-role evidence status is not recognized.");
  }
  if (typeof raw.indexDigest !== "string" || !/^[a-f0-9]{64}$/.test(raw.indexDigest)) issue(issues, "digest_invalid", "$.indexDigest", "Expected a SHA-256 digest.");
  if (typeof raw.digest !== "string" || !/^[a-f0-9]{64}$/.test(raw.digest)) issue(issues, "digest_invalid", "$.digest", "Expected a SHA-256 digest.");
  const bindings = readBindings(raw.bindings, "$.bindings", issues);
  if (!bindings || issues.length > 0 || !documentId(raw.documentId)) return finish(issues, undefined as never);
  const evidenceStatus = raw.evidenceStatus as DocumentRoleEvidenceStatus;
  if (evidenceStatus === "VERIFIED" && bindings.length === 0) issue(issues, "evidence_status_invalid", "$.evidenceStatus", "Verified role evidence names at least one frozen page.");
  if (evidenceStatus === "UNAVAILABLE" && bindings.length !== 0) issue(issues, "evidence_status_invalid", "$.evidenceStatus", "Unavailable role evidence has no page binding.");
  if (issues.length > 0) return finish(issues, undefined as never);
  const built: Omit<DocumentRoleEvidence, "digest"> = {
    schema: DOCUMENT_ROLE_EVIDENCE_SCHEMA,
    proposalId: raw.proposalId as string,
    documentId: documentId(raw.documentId) as string,
    extractionFactId: raw.extractionFactId as string,
    role: raw.role as string,
    indexDigest: raw.indexDigest as string,
    evidenceStatus,
    roleStatus: "NOT_ACCEPTED",
    claimStatus: "NOT_ACCEPTED",
    studyStatus: "NOT_ACCEPTED",
    bindings,
  };
  if (packDigest(roleBody(built)) !== raw.digest) issue(issues, "digest_mismatch", "$.digest", "Document-role digest does not match its body.");
  return finish(issues, { ...built, digest: raw.digest as string });
}

export function verifyDocumentRoleEvidence(index: unknown, proposal: unknown): StudyContractResult<DocumentRoleEvidence> {
  const parsedIndex = parseVerifiedEvidenceIndex(index);
  if (!parsedIndex.ok) return parsedIndex;
  const issues: StudyContractIssue[] = [];
  if (!isObject(proposal)) return finish([{ code: "role_invalid", path: "$", message: "Expected an object." }], undefined as never);
  for (const key of Object.keys(proposal)) {
    if (INVENTED_QUOTE_KEYS.has(key)) issue(issues, "invented_quotation", "$.proposal." + key, "A document role cites a verified fact id and cannot include a quotation.");
  }
  if (issues.length > 0) return finish(issues, undefined as never);
  exactKeys(proposal, ["proposalId", "documentId", "extractionFactId", "role"], "$.proposal", issues);
  const id = documentId(proposal.documentId);
  if (!validId(proposal.proposalId) || !validId(proposal.extractionFactId) || !validId(proposal.role) || !id) {
    issue(issues, "role_invalid", "$.proposal", "Proposal, document, fact, and role ids are required.");
  }
  if (issues.length > 0 || !id || !validId(proposal.extractionFactId)) return finish(issues, undefined as never);
  const records = parsedIndex.value.records.filter((record) => record.documentId === id && record.extractionFactId === proposal.extractionFactId);
  const evidenceStatus: DocumentRoleEvidenceStatus = records.length > 0 ? "VERIFIED" : "UNAVAILABLE";
  const built: Omit<DocumentRoleEvidence, "digest"> = {
    schema: DOCUMENT_ROLE_EVIDENCE_SCHEMA,
    proposalId: proposal.proposalId as string,
    documentId: id,
    extractionFactId: proposal.extractionFactId,
    role: proposal.role as string,
    indexDigest: parsedIndex.value.digest,
    evidenceStatus,
    roleStatus: "NOT_ACCEPTED",
    claimStatus: "NOT_ACCEPTED",
    studyStatus: "NOT_ACCEPTED",
    bindings: records.map((record) => ({
      page: record.page as number,
      sourcePageDigest: record.sourcePageDigest as string,
      quoteDigest: record.quoteDigest as string,
    })),
  };
  return parseDocumentRoleEvidence({ ...built, digest: packDigest(roleBody(built)) });
}

export function findVerifiedEvidence(
  index: unknown,
  citation: { documentId: string; page: number; extractionFactId: string; quote: string },
): StudyContractResult<ExtractionEvidenceRecord | null> {
  const parsed = parseVerifiedEvidenceIndex(index);
  if (!parsed.ok) return parsed;
  const issues: StudyContractIssue[] = [];
  const id = documentId(citation.documentId);
  const page = pageNumber(citation.page);
  if (!id || page === null || !validId(citation.extractionFactId) || typeof citation.quote !== "string") {
    issue(issues, "citation_invalid", "$.citation", "A citation needs a document, a page, a fact id, and a quotation.");
  }
  if (issues.length > 0 || !id) return finish(issues, undefined as never);
  const quoteDigest = citationDigest(citation.quote);
  const found = parsed.value.records.find((record) =>
    record.documentId === id
    && record.page === page
    && record.extractionFactId === citation.extractionFactId
    && record.quoteDigest === quoteDigest
    && record.outcome === "QUOTE_MATCHED",
  ) ?? null;
  return finish(issues, found);
}

/**
 * Audit projection for a verification. Digests and counts only.
 * Page text stays on the existing immutable document-page rows.
 * A later writer can store `extractionEvidenceCanonicalJson` under `verificationDigest`
 * the same way an evidence pin stores its canonical preimage. This function does not insert a row.
 */
export function extractionEvidenceAuditMetadata(raw: unknown): StudyContractResult<ExtractionEvidenceAuditMetadata> {
  const parsed = parseExtractionEvidenceVerification(raw);
  if (!parsed.ok) return parsed;
  return finish([], {
    snapshotDigest: parsed.value.snapshotDigest,
    verificationDigest: parsed.value.digest,
    indexDigest: parsed.value.index.digest,
    matchedCount: parsed.value.index.records.length,
    unavailableCount: parsed.value.unavailable.length,
  });
}

export function extractionEvidenceCanonicalJson(raw: unknown): StudyContractResult<string> {
  const parsed = parseExtractionEvidenceVerification(raw);
  if (!parsed.ok) return parsed;
  return finish([], canonicalPackJson(parsed.value));
}
