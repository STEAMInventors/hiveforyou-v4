import { diagnosticFieldFromMessage } from "../errors/failure-diagnostic";
import type { ContractValidation } from "../source-documents/source-document-contracts";
import {
  INVESTIGATION_ANSWER_STATUSES,
  type InvestigationEvidence,
  STUDY_DOCUMENT_READ_COVERAGES,
  type StudyDocumentReadCoverage,
  STUDY_DOCUMENT_ROLES,
  type StudyDocumentRole,
  STUDY_DOCUMENT_TEMPORAL_STATUSES,
  type StudyDocumentTemporalStatus,
  STUDY_FINDING_MODALITIES,
  type StudyFindingModality,
  STUDY_INVESTIGATION_SCHEMA,
  type StudyDocumentFinding,
  type StudyDocumentRecord,
  type StudyInvestigationOutput,
} from "../study-preparation/execution-manifest-contracts";
import {
  type Decimal,
  decimalFromPlain,
  evaluateFormula,
  type FormulaNode,
  formatDecimal,
  formulaLeaves,
  matchesStatedPrecision,
  parseFormula,
  parseWrittenNumber,
} from "./decimal-formula";

/**
 * Trusted verification of a `hive.study-investigation/1` model output (D-041). The output is
 * accepted unchanged or rejected; nothing is repaired. Every quote must be an exact run of words on
 * an authorized page (only line endings and whitespace runs are normalized). Every investigation
 * question is answered exactly once. Each calculation is recomputed from its quoted inputs and
 * classified VERIFIED, UNVERIFIED or NONCALCULABLE; only VERIFIED results may be presented as
 * validated findings.
 */

export const STUDY_VERIFICATION_SCHEMA = "hive.study-verification/1";

export const NUMERIC_STATUSES = ["VERIFIED", "UNVERIFIED", "NONCALCULABLE"] as const;
export type NumericStatus = (typeof NUMERIC_STATUSES)[number];

export const CALCULATION_CHECK_REASONS = [
  "RECOMPUTED_MATCH",
  "RESULT_MISMATCH",
  "NO_FORMULA",
  "FORMULA_INVALID",
  "INPUT_NOT_QUOTED",
  "INPUT_NOT_NUMERIC",
  "RESULT_NOT_NUMERIC",
  "DIVISION_BY_ZERO",
] as const;
export type CalculationCheckReason = (typeof CALCULATION_CHECK_REASONS)[number];

export const CLAIM_KINDS = [
  "ANSWER",
  "FACT",
  "CALCULATION",
  "ASSESSMENT",
  "UNCERTAINTY",
  "CONFLICT",
  "DETERMINATION",
  "LIMITATION",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export type EvidenceRef = { sourceDocumentId: string; pageNumber: number };

export type CalculationCheck = {
  claimId: string;
  status: NumericStatus;
  reason: CalculationCheckReason;
  computedValue: string | null;
  statedValue: string | null;
};

export const READ_COVERAGE_STATUSES = [
  "ALL_AUTHORIZED_PAGES_READ",
  "PARTIAL_PAGES_READ",
  "NO_PAGES_READ",
] as const;
export type ReadCoverageStatus = (typeof READ_COVERAGE_STATUSES)[number];

export const EXTRACTION_COMPLETENESS_STATUSES = [
  "UNVERIFIED_BY_READ_COVERAGE",
] as const;
export type ExtractionCompletenessStatus = (typeof EXTRACTION_COMPLETENESS_STATUSES)[number];

export type VerifiedDocumentCoverage = {
  sourceDocumentId: string;
  role: StudyDocumentRole;
  temporalStatus: StudyDocumentTemporalStatus;
  declaredReadCoverage: StudyDocumentReadCoverage;
  readCoverageStatus: ReadCoverageStatus;
  /**
   * Explicitly separates deterministic page-read coverage from semantic extraction completeness:
   * reading all pages proves every authorized page was fetched, never that every domain-significant fact was extracted.
   */
  extractionCompletenessStatus: ExtractionCompletenessStatus;
  authorizedPageNumbers: number[];
  authorizedNonEmptyPageNumbers: number[];
  pagesRead: number[];
  pagesCited: number[];
  findingCount: number;
};

export type StudyVerification = {
  schema: typeof STUDY_VERIFICATION_SCHEMA;
  processingRunId: string;
  questionIds: string[];
  claimIds: string[];
  calculations: CalculationCheck[];
  /** Present when the Study includes document-centered `documents` records (V4-004I). */
  documentCoverage?: VerifiedDocumentCoverage[];
  counts: {
    answers: number;
    facts: number;
    documentFindings?: number;
    calculations: number;
    verifiedCalculations: number;
    quotes: number;
    citedPages: number;
  };
};

/** Validated study output: the model's own JSON (with `formula` kept) plus the trusted verification. */
export type VerifiedStudy = { investigation: StudyInvestigationOutput; verification: StudyVerification };

export type StudyVerificationContext = {
  readonly processingRunId: string;
  readonly planQuestionIds: readonly string[];
  /** Authorized page text keyed `${sourceDocumentId}:${pageNumber}` (lowercase uuid). */
  readonly pages: ReadonlyMap<string, string>;
};

const MAX_TEXT = { answer: 4000, statement: 1200, short: 600, label: 200 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DOCUMENT_FINDING_ID_RE = /^DF[1-9][0-9]{0,3}$/;

const VERIFIER_MONTH_INDEX: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const VERIFIER_DATE_TOKEN_SOURCE =
  "(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{4}|(?:January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\.?\\s+\\d{1,2},?\\s+\\d{4})";
const VERIFIER_SINGLE_DATE_RE = new RegExp(`\\b(${VERIFIER_DATE_TOKEN_SOURCE})\\b`, "gi");

function isValidVerifierCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatVerifierIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseFindingDateTokenToIso(raw: string): string | null {
  const trimmed = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    return isValidVerifierCalendarDate(y, m, d) ? formatVerifierIsoDate(y, m, d) : null;
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    const m = Number(slash[1]);
    const d = Number(slash[2]);
    const y = Number(slash[3]);
    return isValidVerifierCalendarDate(y, m, d) ? formatVerifierIsoDate(y, m, d) : null;
  }
  const named = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(trimmed);
  if (named) {
    const m = VERIFIER_MONTH_INDEX[named[1]!.toLowerCase()];
    const d = Number(named[2]);
    const y = Number(named[3]);
    return m && isValidVerifierCalendarDate(y, m, d) ? formatVerifierIsoDate(y, m, d) : null;
  }
  return null;
}

function extractNormalizedDecimals(textValue: string): string[] {
  const cleaned = textValue
    .replace(/\b(?:P[1-9][0-9]{0,2}(?:\.[FCAUKDL][0-9]{1,3})?|DF[1-9][0-9]{0,3})\b/g, " ")
    .replace(/\b(?:goal|accommodation|section|part|item|table|figure|step)\s*#?\s*\d+\b/gi, " ");
  const out: string[] = [];
  for (const match of cleaned.matchAll(/\d(?:[\d,]*\d)?(?:\.\d+)?/g)) {
    const raw = match[0];
    const [whole, fraction] = raw.split(".");
    const parts = /^\d{1,3}(,\d{3})+$/.test(whole!) ? [whole!.replace(/,/g, "")] : whole!.split(",");
    parts.forEach((part, index) => {
      const plain = index === parts.length - 1 && fraction !== undefined ? `${part}.${fraction}` : part;
      const parsed = decimalFromPlain(plain);
      if (parsed) out.push(formatDecimal(parsed));
    });
  }
  return out;
}

function extractIsoDatesFromText(textValue: string): Set<string> {
  const dates = new Set<string>();
  VERIFIER_SINGLE_DATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VERIFIER_SINGLE_DATE_RE.exec(textValue)) !== null) {
    const iso = parseFindingDateTokenToIso(match[1]!);
    if (iso) dates.add(iso);
  }
  return dates;
}

/**
 * Deterministically checks that every number or date in a `StudyDocumentFinding`'s `valueAsWritten`,
 * `statement`, and `dates` is grounded in its cited same-document `quotes`.
 * Returns the first ungrounded number/token, or `null` when all numeric tokens are grounded.
 */
export function firstUngroundedFindingNumber(input: {
  readonly valueAsWritten: string;
  readonly statement: string;
  readonly dates: readonly string[];
  readonly modality: StudyFindingModality;
  readonly quotes: readonly string[];
}): string | null {
  const quoteText = input.quotes.join(" \n ");
  const allowedNumbers = new Set(extractNormalizedDecimals(quoteText));
  const allowedIsoDates = extractIsoDatesFromText(quoteText);

  const stripGroundedDates = (source: string): string =>
    source.replace(VERIFIER_SINGLE_DATE_RE, (fullMatch) => {
      const iso = parseFindingDateTokenToIso(fullMatch);
      return iso && allowedIsoDates.has(iso) ? " " : fullMatch;
    });

  const checkString = (candidate: string): string | null => {
    const remaining = stripGroundedDates(candidate);
    for (const num of extractNormalizedDecimals(remaining)) {
      if (!allowedNumbers.has(num)) return num;
    }
    return null;
  };

  if (input.modality !== "EMPTY_FIELD") {
    const ungroundedValue = checkString(input.valueAsWritten);
    if (ungroundedValue !== null) return ungroundedValue;
  }
  const ungroundedStatement = checkString(input.statement);
  if (ungroundedStatement !== null) return ungroundedStatement;

  for (const dateEntry of input.dates) {
    const ungroundedDate = checkString(dateEntry);
    if (ungroundedDate !== null) return ungroundedDate;
  }
  return null;
}

export function computeReadCoverageStatus(
  authorizedNonEmptyPageNumbers: readonly number[],
  pagesRead: readonly number[],
): ReadCoverageStatus {
  if (pagesRead.length === 0) return "NO_PAGES_READ";
  const readSet = new Set(pagesRead);
  if (authorizedNonEmptyPageNumbers.every((page) => readSet.has(page))) {
    return "ALL_AUTHORIZED_PAGES_READ";
  }
  return "PARTIAL_PAGES_READ";
}

const MISLEADING_EXTRACTION_COMPLETENESS_RE =
  /\b(?:(?:complete|100%|full|exhaustive|total)\s+(?:semantic\s+)?(?:extraction|fact\s+extraction|understanding|fact\s+capture)\s+(?:is\s+|was\s+)?(?:guaranteed|proven|verified|established|confirmed|complete)|(?:every|all)\s+(?:possible\s+|significant\s+)?facts?\s+(?:was|were|have\s+been)\s+extracted\s+because\s+(?:all|every)\s+pages?\s+(?:was|were)\s+read)\b/i;

const UNQUALIFIED_ALL_PAGES_READ_RE =
  /\b(?:(?:all\s+pages|every\s+page)\s+(?:of\s+(?:every|all)\s+documents?|in\s+the\s+case)|(?:every|all)\s+documents?\s+in\s+the\s+case)\b[^.!?]*\b(?:was|were|have\s+been|has\s+been)\s+read\b/i;

export function hasMisleadingCoverageNote(
  coverageNotes: readonly string[],
  hasPartiallyReadOrUnreadDocument: boolean,
): boolean {
  for (const note of coverageNotes) {
    if (MISLEADING_EXTRACTION_COMPLETENESS_RE.test(note)) return true;
    if (
      hasPartiallyReadOrUnreadDocument &&
      UNQUALIFIED_ALL_PAGES_READ_RE.test(note) &&
      !/\b(?:except|other\s+than|partial|not|unread|only|selectively)\b/i.test(note)
    ) {
      return true;
    }
  }
  return false;
}

class StudyRejection extends Error {
  constructor(
    readonly diagnosticReason: string,
    message: string,
    readonly diagnosticField?: string,
  ) {
    super(message);
  }
}

function reject(diagnosticReason: string, message: string): never {
  throw new StudyRejection(diagnosticReason, message, diagnosticFieldFromMessage(message));
}

export function normalizeQuoteText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

export function pageKey(sourceDocumentId: string, pageNumber: number): string {
  return `${sourceDocumentId.toLowerCase()}:${pageNumber}`;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("study_output_shape", `${path} must be an object.`);
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string, minItems = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minItems) {
    reject("study_output_shape", `${path} must be a list${minItems > 0 ? ` with at least ${minItems} item(s)` : ""}.`);
  }
  return value;
}

function text(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "") || value.length > max) {
    reject("study_output_shape", `${path} must be text up to ${max} characters.`);
  }
  return value;
}

function textList(value: unknown, path: string): string[] {
  return list(value, path).map((item, index) => text(item, `${path}[${index}]`, MAX_TEXT.short));
}

function indexList(value: unknown, path: string, size: number, minItems = 0): number[] {
  return list(value, path, minItems).map((item, index) => {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item >= size) {
      reject("study_fact_index_invalid", `${path}[${index}] must point to a fact in the same answer.`);
    }
    return item;
  });
}

type Tally = { quotes: number; pages: Set<string> };

function evidence(
  value: unknown,
  path: string,
  context: StudyVerificationContext,
  tally: Tally,
  normalizedPages: Map<string, string>,
): { sourceDocumentId: string; pageNumber: number; quote: string } {
  const item = record(value, path);
  const sourceDocumentId = item.sourceDocumentId;
  const pageNumber = item.pageNumber;
  if (typeof sourceDocumentId !== "string" || !UUID.test(sourceDocumentId)) {
    reject("study_evidence_invalid", `${path}.sourceDocumentId must be a document id.`);
  }
  if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1) {
    reject("study_evidence_invalid", `${path}.pageNumber must be a page number.`);
  }
  const key = pageKey(sourceDocumentId, pageNumber);
  const page = context.pages.get(key);
  if (page === undefined) reject("study_evidence_unauthorized", `${path} cites a page that was not authorized.`);
  const quote = text(item.quote, `${path}.quote`, MAX_TEXT.short);
  let normalizedPage = normalizedPages.get(key);
  if (normalizedPage === undefined) {
    normalizedPage = normalizeQuoteText(page);
    normalizedPages.set(key, normalizedPage);
  }
  const normalizedQuote = normalizeQuoteText(quote);
  if (normalizedQuote === "" || !normalizedPage.includes(normalizedQuote)) {
    reject("quotation_mismatch", `${path}.quote is not an exact quotation from that page.`);
  }
  tally.quotes += 1;
  tally.pages.add(key);
  return { sourceDocumentId: sourceDocumentId.toLowerCase(), pageNumber, quote };
}

function checkCalculation(
  claimId: string,
  inputs: { valueAsWritten: string; evidence: { quote: string }[] }[],
  result: string,
  rawFormula: unknown,
): CalculationCheck {
  const check = (status: NumericStatus, reason: CalculationCheckReason, computed: Decimal | null = null): CalculationCheck => {
    const stated = parseWrittenNumber(result);
    return {
      claimId,
      status,
      reason,
      computedValue: computed ? formatDecimal(computed) : null,
      statedValue: stated ? formatDecimal(stated) : null,
    };
  };
  const values = inputs.map((input) => parseWrittenNumber(input.valueAsWritten));
  if (values.some((value) => value === null)) return check("NONCALCULABLE", "INPUT_NOT_NUMERIC");
  const stated = parseWrittenNumber(result);
  if (!stated) return check("NONCALCULABLE", "RESULT_NOT_NUMERIC");
  if (rawFormula === undefined || rawFormula === null) return check("UNVERIFIED", "NO_FORMULA");
  const parsed = parseFormula(rawFormula);
  if (!parsed.ok) return check("UNVERIFIED", "FORMULA_INVALID");
  const formula: FormulaNode = parsed.value;
  const leaves = formulaLeaves(formula);
  if (leaves.some((leaf) => !("input" in leaf || "value" in leaf) || ("input" in leaf && leaf.input >= inputs.length))) {
    return check("UNVERIFIED", "FORMULA_INVALID");
  }
  const quoted = inputs.map((input) =>
    input.evidence.some((item) => normalizeQuoteText(item.quote).includes(normalizeQuoteText(input.valueAsWritten))),
  );
  const evaluation = evaluateFormula(formula, (leaf) => ("input" in leaf ? values[leaf.input] : null));
  if (!evaluation.ok) {
    return evaluation.reason === "division_by_zero"
      ? check("NONCALCULABLE", "DIVISION_BY_ZERO")
      : check("UNVERIFIED", "FORMULA_INVALID");
  }
  if (!matchesStatedPrecision(evaluation.value, stated)) return check("UNVERIFIED", "RESULT_MISMATCH", evaluation.value);
  if (quoted.some((ok) => !ok)) return check("UNVERIFIED", "INPUT_NOT_QUOTED", evaluation.value);
  return check("VERIFIED", "RECOMPUTED_MATCH", evaluation.value);
}

function optionalTextField(value: unknown, path: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return text(value, path, max);
}

function pageListField(
  value: unknown,
  path: string,
  sourceDocumentId: string,
  context: StudyVerificationContext,
): number[] {
  const raw = list(value, path);
  const seen = new Set<number>();
  for (let i = 0; i < raw.length; i += 1) {
    const page = raw[i];
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) {
      reject("study_evidence_invalid", `${path}[${i}] must be a page number.`);
    }
    if (!context.pages.has(pageKey(sourceDocumentId, page))) {
      reject("study_evidence_unauthorized", `${path}[${i}] cites a page that was not authorized.`);
    }
    seen.add(page);
  }
  return [...seen].sort((a, b) => a - b);
}

function findingIdListField(
  value: unknown,
  path: string,
  knownFindingIds: ReadonlySet<string>,
  minItems = 0,
): string[] {
  const raw = list(value, path, minItems);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const id = raw[i];
    if (typeof id !== "string" || !DOCUMENT_FINDING_ID_RE.test(id) || !knownFindingIds.has(id)) {
      reject("study_finding_ref_invalid", `${path}[${i}] must reference a verified document finding (DF…).`);
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function authorizedDocumentPages(
  context: StudyVerificationContext,
): Map<string, { all: number[]; nonEmpty: number[] }> {
  const byDoc = new Map<string, { all: number[]; nonEmpty: number[] }>();
  for (const [key, pageText] of context.pages.entries()) {
    const sep = key.lastIndexOf(":");
    if (sep <= 0) continue;
    const docId = key.slice(0, sep).toLowerCase();
    const pageNum = Number(key.slice(sep + 1));
    if (!Number.isInteger(pageNum) || pageNum < 1) continue;
    let entry = byDoc.get(docId);
    if (!entry) {
      entry = { all: [], nonEmpty: [] };
      byDoc.set(docId, entry);
    }
    entry.all.push(pageNum);
    if (pageText.trim().length > 0) entry.nonEmpty.push(pageNum);
  }
  for (const entry of byDoc.values()) {
    entry.all.sort((a, b) => a - b);
    entry.nonEmpty.sort((a, b) => a - b);
  }
  return byDoc;
}

/** Accepts or rejects a Canonical Study output. Rejection is MODEL_OUTPUT_INVALID upstream. */
export function verifyStudyInvestigation(raw: unknown, context: StudyVerificationContext): ContractValidation<VerifiedStudy> {
  try {
    const root = record(raw, "output");
    const allowedRoot = new Set([
      "schema",
      "processingRunId",
      "documents",
      "documentFindings",
      "answers",
      "coverageNotes",
      "instructionsIgnored",
    ]);
    if (Object.keys(root).some((key) => !allowedRoot.has(key))) reject("study_output_shape", "The output has unexpected fields.");
    if (root.schema !== STUDY_INVESTIGATION_SCHEMA) reject("study_output_schema", "The output schema is wrong.");
    if (typeof root.processingRunId !== "string" || root.processingRunId.toLowerCase() !== context.processingRunId.toLowerCase()) {
      reject("study_run_mismatch", "The output belongs to a different run.");
    }
    const tally: Tally = { quotes: 0, pages: new Set() };
    const normalizedPages = new Map<string, string>();
    const expected = new Set(context.planQuestionIds);
    const seen = new Set<string>();
    const claimIds: string[] = [];
    const calculations: CalculationCheck[] = [];
    let factCount = 0;

    const cite = (item: unknown, itemPath: string) => evidence(item, itemPath, context, tally, normalizedPages);
    const docPagesMap = authorizedDocumentPages(context);
    const seenDocIds = new Set<string>();
    const documentsByDocId = new Map<string, StudyDocumentRecord>();

    const documents: StudyDocumentRecord[] | undefined =
      root.documents === undefined
        ? undefined
        : list(root.documents, "documents").map((value, index) => {
            const path = `documents[${index}]`;
            const item = record(value, path);
            if (typeof item.sourceDocumentId !== "string" || !UUID.test(item.sourceDocumentId)) {
              reject("study_evidence_invalid", `${path}.sourceDocumentId must be a document id.`);
            }
            const sourceDocumentId = item.sourceDocumentId.toLowerCase();
            if (!docPagesMap.has(sourceDocumentId)) {
              reject("study_evidence_unauthorized", `${path}.sourceDocumentId is not an authorized document.`);
            }
            if (seenDocIds.has(sourceDocumentId)) {
              reject("study_document_duplicate", `${path} records ${sourceDocumentId} a second time.`);
            }
            seenDocIds.add(sourceDocumentId);
            if (!(STUDY_DOCUMENT_ROLES as readonly string[]).includes(item.role as string)) {
              reject("study_output_shape", `${path}.role is not allowed.`);
            }
            if (!(STUDY_DOCUMENT_TEMPORAL_STATUSES as readonly string[]).includes(item.temporalStatus as string)) {
              reject("study_output_shape", `${path}.temporalStatus is not allowed.`);
            }
            if (!(STUDY_DOCUMENT_READ_COVERAGES as readonly string[]).includes(item.declaredReadCoverage as string)) {
              reject("study_output_shape", `${path}.declaredReadCoverage is not allowed.`);
            }
            const role = item.role as StudyDocumentRole;
            const temporalStatus = item.temporalStatus as StudyDocumentTemporalStatus;
            const declaredReadCoverage = item.declaredReadCoverage as StudyDocumentReadCoverage;
            const roleReasoning = text(item.roleReasoning, `${path}.roleReasoning`, MAX_TEXT.short);
            const documentType = text(item.documentType, `${path}.documentType`, MAX_TEXT.label);
            const titleAsPrinted = optionalTextField(item.titleAsPrinted, `${path}.titleAsPrinted`, MAX_TEXT.label);
            const issuer = optionalTextField(item.issuer, `${path}.issuer`, MAX_TEXT.label);
            const subjects =
              item.subjects === undefined ? undefined : textList(item.subjects, `${path}.subjects`);
            let effectivePeriod: StudyDocumentRecord["effectivePeriod"];
            if (item.effectivePeriod !== undefined) {
              if (item.effectivePeriod === null) {
                effectivePeriod = null;
              } else {
                const ep = record(item.effectivePeriod, `${path}.effectivePeriod`);
                effectivePeriod = {
                  startDate: optionalTextField(ep.startDate, `${path}.effectivePeriod.startDate`, 40) ?? null,
                  endDate: optionalTextField(ep.endDate, `${path}.effectivePeriod.endDate`, 40) ?? null,
                  asWritten: optionalTextField(ep.asWritten, `${path}.effectivePeriod.asWritten`, MAX_TEXT.label) ?? null,
                };
              }
            }
            const pagesRead = pageListField(item.pagesRead, `${path}.pagesRead`, sourceDocumentId, context);
            const pagesCited = pageListField(item.pagesCited, `${path}.pagesCited`, sourceDocumentId, context);
            const docEvidence = list(item.evidence, `${path}.evidence`, 1).map((ev, i) =>
              cite(ev, `${path}.evidence[${i}]`),
            );
            const pagesReadSet = new Set(pagesRead);
            for (let i = 0; i < docEvidence.length; i += 1) {
              const ev = docEvidence[i]!;
              if (ev.sourceDocumentId !== sourceDocumentId) {
                reject(
                  "study_finding_cross_document_evidence",
                  `${path}.evidence[${i}] cites ${ev.sourceDocumentId} instead of ${sourceDocumentId}.`,
                );
              }
              if (!pagesReadSet.has(ev.pageNumber)) {
                reject(
                  "study_page_not_read",
                  `${path}.evidence[${i}] cites page ${ev.pageNumber}, which is not in ${path}.pagesRead.`,
                );
              }
            }
            const authPages = docPagesMap.get(sourceDocumentId)!;
            const readCoverageStatus = computeReadCoverageStatus(authPages.nonEmpty, pagesRead);
            if (declaredReadCoverage === "FULL_DOCUMENT_READ" && readCoverageStatus !== "ALL_AUTHORIZED_PAGES_READ") {
              reject(
                "study_coverage_claim_misleading",
                `${path} claims FULL_DOCUMENT_READ for ${sourceDocumentId} when unread non-empty pages remain.`,
              );
            }
            if (role === "PRIMARY" && readCoverageStatus !== "ALL_AUTHORIZED_PAGES_READ") {
              reject(
                "study_primary_document_unread_pages",
                `${path} marks ${sourceDocumentId} as PRIMARY without reading all authorized non-empty pages.`,
              );
            }
            const docRecord: StudyDocumentRecord = {
              sourceDocumentId,
              role,
              roleReasoning,
              documentType,
              ...(titleAsPrinted !== undefined ? { titleAsPrinted } : {}),
              ...(issuer !== undefined ? { issuer } : {}),
              ...(subjects !== undefined ? { subjects } : {}),
              temporalStatus,
              ...(effectivePeriod !== undefined ? { effectivePeriod } : {}),
              declaredReadCoverage,
              pagesRead,
              pagesCited,
              evidence: docEvidence,
            };
            documentsByDocId.set(sourceDocumentId, docRecord);
            return docRecord;
          });

    const seenFindingIds = new Set<string>();
    const findingsById = new Map<string, StudyDocumentFinding>();
    const findingCountByDoc = new Map<string, number>();

    const documentFindings: StudyDocumentFinding[] | undefined =
      root.documentFindings === undefined
        ? undefined
        : list(root.documentFindings, "documentFindings").map((value, index) => {
            const path = `documentFindings[${index}]`;
            const item = record(value, path);
            const id = item.id;
            if (typeof id !== "string" || !DOCUMENT_FINDING_ID_RE.test(id)) {
              reject("study_output_shape", `${path}.id must look like DF1.`);
            }
            if (seenFindingIds.has(id)) {
              reject("study_finding_duplicate_id", `${path}.id (${id}) is duplicated.`);
            }
            seenFindingIds.add(id);
            claimIds.push(id);
            if (typeof item.sourceDocumentId !== "string" || !UUID.test(item.sourceDocumentId)) {
              reject("study_evidence_invalid", `${path}.sourceDocumentId must be a document id.`);
            }
            const sourceDocumentId = item.sourceDocumentId.toLowerCase();
            if (!docPagesMap.has(sourceDocumentId)) {
              reject("study_evidence_unauthorized", `${path}.sourceDocumentId is not an authorized document.`);
            }
            const category = text(item.category, `${path}.category`, MAX_TEXT.label);
            const subject = text(item.subject, `${path}.subject`, MAX_TEXT.label);
            const attribute = text(item.attribute, `${path}.attribute`, MAX_TEXT.label);
            const valueAsWritten = text(item.valueAsWritten, `${path}.valueAsWritten`, MAX_TEXT.short);
            const statement = text(item.statement, `${path}.statement`, MAX_TEXT.statement);
            if (!(STUDY_FINDING_MODALITIES as readonly string[]).includes(item.modality as string)) {
              reject("study_output_shape", `${path}.modality is not allowed.`);
            }
            const modality = item.modality as StudyFindingModality;
            const itemKey = optionalTextField(item.itemKey, `${path}.itemKey`, MAX_TEXT.label) ?? null;
            const dates = item.dates === undefined ? [] : textList(item.dates, `${path}.dates`);
            const unit = optionalTextField(item.unit, `${path}.unit`, 100);
            const per = optionalTextField(item.per, `${path}.per`, 100);
            const section = optionalTextField(item.section, `${path}.section`, MAX_TEXT.label);
            const attributedTo = optionalTextField(item.attributedTo, `${path}.attributedTo`, MAX_TEXT.label);
            const findingEvidence = list(item.evidence, `${path}.evidence`, 1).map((ev, i) =>
              cite(ev, `${path}.evidence[${i}]`),
            );
            const docRecord = documentsByDocId.get(sourceDocumentId);
            const docPagesRead = docRecord ? new Set(docRecord.pagesRead) : null;
            for (let i = 0; i < findingEvidence.length; i += 1) {
              const ev = findingEvidence[i]!;
              if (ev.sourceDocumentId !== sourceDocumentId) {
                reject(
                  "study_finding_cross_document_evidence",
                  `${path}.evidence[${i}] cites ${ev.sourceDocumentId} instead of ${sourceDocumentId}.`,
                );
              }
              if (docPagesRead && !docPagesRead.has(ev.pageNumber)) {
                reject(
                  "study_page_not_read",
                  `${path}.evidence[${i}] cites page ${ev.pageNumber}, which was not read for ${sourceDocumentId}.`,
                );
              }
            }
            const ungrounded = firstUngroundedFindingNumber({
              valueAsWritten,
              statement,
              dates,
              modality,
              quotes: findingEvidence.map((ev) => ev.quote),
            });
            if (ungrounded !== null) {
              reject(
                "study_finding_number_ungrounded",
                `${path} states an unsupported number (${ungrounded}) not grounded in its cited evidence quotes.`,
              );
            }
            const rawRelated = item.relatedFindingIds === undefined ? [] : list(item.relatedFindingIds, `${path}.relatedFindingIds`);
            const relatedFindingIds = rawRelated.map((relId, rIdx) => {
              if (typeof relId !== "string" || !DOCUMENT_FINDING_ID_RE.test(relId)) {
                reject("study_finding_ref_invalid", `${path}.relatedFindingIds[${rIdx}] must be a DF… id.`);
              }
              return relId;
            });
            const finding: StudyDocumentFinding = {
              id,
              sourceDocumentId,
              category,
              subject,
              attribute,
              valueAsWritten,
              statement,
              modality,
              itemKey,
              dates,
              ...(unit !== undefined ? { unit } : {}),
              ...(per !== undefined ? { per } : {}),
              ...(section !== undefined ? { section } : {}),
              ...(attributedTo !== undefined ? { attributedTo } : {}),
              ...(item.relatedFindingIds !== undefined ? { relatedFindingIds } : {}),
              evidence: findingEvidence,
            };
            findingsById.set(id, finding);
            findingCountByDoc.set(sourceDocumentId, (findingCountByDoc.get(sourceDocumentId) ?? 0) + 1);
            return finding;
          });

    if (documentFindings) {
      documentFindings.forEach((finding, index) => {
        const path = `documentFindings[${index}]`;
        for (let rIdx = 0; rIdx < (finding.relatedFindingIds?.length ?? 0); rIdx += 1) {
          const relId = finding.relatedFindingIds![rIdx]!;
          if (relId === finding.id || !seenFindingIds.has(relId)) {
            reject(
              "study_finding_ref_invalid",
              `${path}.relatedFindingIds[${rIdx}] (${relId}) must reference another verified document finding.`,
            );
          }
        }
      });
    }

    if (documents) {
      for (let i = 0; i < documents.length; i += 1) {
        const doc = documents[i]!;
        const authPages = docPagesMap.get(doc.sourceDocumentId)!;
        if (doc.role === "PRIMARY" && authPages.nonEmpty.length > 0 && (findingCountByDoc.get(doc.sourceDocumentId) ?? 0) === 0) {
          reject(
            "study_primary_document_findings_missing",
            `documents[${i}] (${doc.sourceDocumentId}) is PRIMARY but has no recorded document findings.`,
          );
        }
      }
    }

    const answers = list(root.answers, "answers", 1).map((value, index) => {
      const path = `answers[${index}]`;
      const answer = record(value, path);
      const id = answer.planQuestionId;
      if (typeof id !== "string" || !expected.has(id)) reject("study_question_unknown", `${path} answers an unknown question.`);
      if (seen.has(id)) reject("study_question_duplicate", `${path} answers ${id} a second time.`);
      seen.add(id);
      if (!(INVESTIGATION_ANSWER_STATUSES as readonly string[]).includes(answer.status as string)) {
        reject("study_output_shape", `${path}.status is not allowed.`);
      }
      claimIds.push(id);
      const answerFindingIds =
        answer.findingIds === undefined
          ? undefined
          : findingIdListField(answer.findingIds, `${path}.findingIds`, seenFindingIds);

      const facts = list(answer.facts, `${path}.facts`).map((fact, factIndex) => {
        const factPath = `${path}.facts[${factIndex}]`;
        const item = record(fact, factPath);
        claimIds.push(`${id}.F${factIndex}`);
        return {
          statement: text(item.statement, `${factPath}.statement`, MAX_TEXT.statement),
          evidence: list(item.evidence, `${factPath}.evidence`, 1).map((ev, i) => cite(ev, `${factPath}.evidence[${i}]`)),
        };
      });
      factCount += facts.length;

      const answerCalculations = list(answer.calculations, `${path}.calculations`).map((calculation, calcIndex) => {
        const calcPath = `${path}.calculations[${calcIndex}]`;
        const item = record(calculation, calcPath);
        const inputs = list(item.inputs, `${calcPath}.inputs`, 1).map((input, inputIndex) => {
          const inputPath = `${calcPath}.inputs[${inputIndex}]`;
          const inputRecord = record(input, inputPath);
          const inputFindingIds =
            inputRecord.findingIds === undefined
              ? undefined
              : findingIdListField(inputRecord.findingIds, `${inputPath}.findingIds`, seenFindingIds);
          return {
            label: text(inputRecord.label, `${inputPath}.label`, MAX_TEXT.label),
            valueAsWritten: text(inputRecord.valueAsWritten, `${inputPath}.valueAsWritten`, MAX_TEXT.label),
            evidence: list(inputRecord.evidence, `${inputPath}.evidence`, 1).map((ev, i) => cite(ev, `${inputPath}.evidence[${i}]`)),
            ...(inputFindingIds !== undefined ? { findingIds: inputFindingIds } : {}),
          };
        });
        const claimId = `${id}.C${calcIndex}`;
        const result = text(item.result, `${calcPath}.result`, MAX_TEXT.label);
        claimIds.push(claimId);
        calculations.push(checkCalculation(claimId, inputs, result, item.formula));
        return {
          description: text(item.description, `${calcPath}.description`, MAX_TEXT.short),
          inputs,
          arithmetic: text(item.arithmetic, `${calcPath}.arithmetic`, MAX_TEXT.short),
          result,
          ...(item.formula !== undefined ? { formula: item.formula } : {}),
        };
      });

      const assessments = list(answer.assessments, `${path}.assessments`).map((assessment, aIndex) => {
        const aPath = `${path}.assessments[${aIndex}]`;
        const item = record(assessment, aPath);
        const criterionSource = item.criterionSource;
        if (criterionSource !== "DOCUMENT" && criterionSource !== "GENERAL_KNOWLEDGE") {
          reject("study_output_shape", `${aPath}.criterionSource is not allowed.`);
        }
        const criterionEvidence = list(item.criterionEvidence, `${aPath}.criterionEvidence`).map((ev, i) =>
          cite(ev, `${aPath}.criterionEvidence[${i}]`),
        );
        if (criterionSource === "DOCUMENT" && criterionEvidence.length === 0) {
          reject("study_criterion_unsupported", `${aPath} uses a document criterion without citing it.`);
        }
        if (!["STRONG", "MODERATE", "TENTATIVE"].includes(item.strength as string)) {
          reject("study_output_shape", `${aPath}.strength is not allowed.`);
        }
        const assessmentFindingIds =
          item.findingIds === undefined
            ? undefined
            : findingIdListField(item.findingIds, `${aPath}.findingIds`, seenFindingIds);
        const minFactIndexes = assessmentFindingIds && assessmentFindingIds.length > 0 ? 0 : 1;
        const factIndexes = indexList(item.factIndexes, `${aPath}.factIndexes`, facts.length, minFactIndexes);
        claimIds.push(`${id}.A${aIndex}`);
        return {
          judgment: text(item.judgment, `${aPath}.judgment`, MAX_TEXT.statement),
          criterion: text(item.criterion, `${aPath}.criterion`, MAX_TEXT.short),
          criterionSource,
          criterionEvidence,
          factIndexes,
          ...(assessmentFindingIds !== undefined ? { findingIds: assessmentFindingIds } : {}),
          reasoning: text(item.reasoning, `${aPath}.reasoning`, 2000),
          strength: item.strength as "STRONG" | "MODERATE" | "TENTATIVE",
          wouldChangeIf: textList(item.wouldChangeIf, `${aPath}.wouldChangeIf`),
        };
      });

      const uncertainties = textList(answer.uncertainties, `${path}.uncertainties`);
      uncertainties.forEach((_, i) => claimIds.push(`${id}.U${i}`));
      const professionalDeterminations = list(answer.professionalDeterminations, `${path}.professionalDeterminations`).map(
        (determination, dIndex) => {
          const dPath = `${path}.professionalDeterminations[${dIndex}]`;
          const item = record(determination, dPath);
          const bearingFindingIds =
            item.bearingFindingIds === undefined
              ? undefined
              : findingIdListField(item.bearingFindingIds, `${dPath}.bearingFindingIds`, seenFindingIds);
          claimIds.push(`${id}.D${dIndex}`);
          return {
            determination: text(item.determination, `${dPath}.determination`, MAX_TEXT.short),
            bearingFacts: indexList(item.bearingFacts, `${dPath}.bearingFacts`, facts.length),
            ...(bearingFindingIds !== undefined ? { bearingFindingIds } : {}),
            decidedBy: text(item.decidedBy, `${dPath}.decidedBy`, MAX_TEXT.label),
          };
        },
      );
      const answerEvidence = list(answer.evidence, `${path}.evidence`).map((ev, i) => cite(ev, `${path}.evidence[${i}]`));
      const conflicts = list(answer.conflicts, `${path}.conflicts`).map((conflict, kIndex) => {
        const kPath = `${path}.conflicts[${kIndex}]`;
        const item = record(conflict, kPath);
        const conflictFindingIds =
          item.findingIds === undefined
            ? undefined
            : findingIdListField(item.findingIds, `${kPath}.findingIds`, seenFindingIds);
        claimIds.push(`${id}.K${kIndex}`);
        return {
          description: text(item.description, `${kPath}.description`, MAX_TEXT.statement),
          evidence: list(item.evidence, `${kPath}.evidence`, 2).map((ev, i) => cite(ev, `${kPath}.evidence[${i}]`)),
          ...(conflictFindingIds !== undefined ? { findingIds: conflictFindingIds } : {}),
        };
      });
      const limitations = textList(answer.limitations, `${path}.limitations`);
      limitations.forEach((_, i) => claimIds.push(`${id}.L${i}`));

      return {
        planQuestionId: id,
        status: answer.status as StudyInvestigationOutput["answers"][number]["status"],
        answer: text(answer.answer, `${path}.answer`, MAX_TEXT.answer),
        ...(answerFindingIds !== undefined ? { findingIds: answerFindingIds } : {}),
        facts,
        calculations: answerCalculations,
        assessments,
        uncertainties,
        professionalDeterminations,
        evidence: answerEvidence,
        conflicts,
        limitations,
      };
    });

    const missing = context.planQuestionIds.filter((id) => !seen.has(id));
    if (missing.length > 0) reject("study_question_missing", `No answer for ${missing.join(", ")}.`);

    const instructionsIgnored = list(root.instructionsIgnored, "instructionsIgnored").map((value, index) => {
      const path = `instructionsIgnored[${index}]`;
      const item = record(value, path);
      if (typeof item.sourceDocumentId !== "string" || typeof item.pageNumber !== "number") {
        reject("study_evidence_invalid", `${path} must name a page.`);
      }
      if (!context.pages.has(pageKey(item.sourceDocumentId, item.pageNumber))) {
        reject("study_evidence_unauthorized", `${path} cites a page that was not authorized.`);
      }
      return {
        sourceDocumentId: item.sourceDocumentId.toLowerCase(),
        pageNumber: item.pageNumber,
        description: text(item.description, `${path}.description`, MAX_TEXT.short),
      };
    });

    const coverageNotes = textList(root.coverageNotes, "coverageNotes");
    const documentCoverage: VerifiedDocumentCoverage[] | undefined = documents
      ? documents.map((doc) => {
          const authPages = docPagesMap.get(doc.sourceDocumentId)!;
          return {
            sourceDocumentId: doc.sourceDocumentId,
            role: doc.role,
            temporalStatus: doc.temporalStatus,
            declaredReadCoverage: doc.declaredReadCoverage,
            readCoverageStatus: computeReadCoverageStatus(authPages.nonEmpty, doc.pagesRead),
            extractionCompletenessStatus: "UNVERIFIED_BY_READ_COVERAGE" as const,
            authorizedPageNumbers: [...authPages.all],
            authorizedNonEmptyPageNumbers: [...authPages.nonEmpty],
            pagesRead: [...doc.pagesRead],
            pagesCited: [...doc.pagesCited],
            findingCount: findingCountByDoc.get(doc.sourceDocumentId) ?? 0,
          };
        })
      : undefined;

    const hasPartiallyReadOrUnreadDoc =
      documentCoverage?.some((cov) => cov.readCoverageStatus !== "ALL_AUTHORIZED_PAGES_READ") === true ||
      (documents !== undefined && docPagesMap.size > documents.length);
    if (hasMisleadingCoverageNote(coverageNotes, hasPartiallyReadOrUnreadDoc)) {
      reject(
        "study_coverage_claim_misleading",
        "coverageNotes makes a misleading read-coverage or extraction-completeness claim.",
      );
    }

    const investigation = {
      schema: STUDY_INVESTIGATION_SCHEMA,
      processingRunId: context.processingRunId.toLowerCase(),
      ...(documents !== undefined ? { documents } : {}),
      ...(documentFindings !== undefined ? { documentFindings } : {}),
      answers,
      coverageNotes,
      instructionsIgnored,
    } as StudyInvestigationOutput;

    return {
      ok: true,
      value: {
        investigation,
        verification: {
          schema: STUDY_VERIFICATION_SCHEMA,
          processingRunId: context.processingRunId.toLowerCase(),
          questionIds: [...context.planQuestionIds],
          claimIds,
          calculations,
          ...(documentCoverage !== undefined ? { documentCoverage } : {}),
          counts: {
            answers: answers.length,
            facts: factCount,
            ...(documentFindings !== undefined ? { documentFindings: documentFindings.length } : {}),
            calculations: calculations.length,
            verifiedCalculations: calculations.filter((item) => item.status === "VERIFIED").length,
            quotes: tally.quotes,
            citedPages: tally.pages.size,
          },
        },
      },
    };
  } catch (error) {
    if (error instanceof StudyRejection) {
      return {
        ok: false,
        message: "The analysis returned an answer we couldn't verify against your documents.",
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
      };
    }
    throw error;
  }
}

export type StudyDocumentFindingClaimMetadata = {
  readonly sourceDocumentId: string;
  readonly category: string;
  readonly subject: string;
  readonly attribute: string;
  readonly valueAsWritten: string;
  readonly modality: StudyFindingModality;
  readonly itemKey: string | null;
  readonly dates: readonly string[];
  readonly unit?: string | null;
  readonly per?: string | null;
  readonly section?: string | null;
  readonly attributedTo?: string | null;
  readonly relatedFindingIds: readonly string[];
};

export type StudyClaim = {
  id: string;
  kind: ClaimKind;
  /**
   * Originating `P1…Pn` question ID for question-scoped claims; `null` for document-centered
   * `DF…` findings (never a placeholder `planQuestionId`).
   */
  planQuestionId: string | null;
  /** All `P1…Pn` questions that reference this claim (populated on `DF…` claims). */
  questionIds?: string[];
  /** Referenced `DF…` document finding IDs (populated on question-level claims that cite `DF…`). */
  findingIds?: string[];
  /** Structured document-finding metadata when `id` is a `DF…` claim. */
  documentFinding?: StudyDocumentFindingClaimMetadata;
  text: string;
  refs: EvidenceRef[];
  /** Quoted source text behind the claim; numbers in report text must be grounded here or in `text`. */
  quotes: string[];
  answerStatus?: StudyInvestigationOutput["answers"][number]["status"];
  numericStatus?: NumericStatus;
  computedValue?: string | null;
  criterion?: string;
  criterionSource?: StudyInvestigationOutput["answers"][number]["assessments"][number]["criterionSource"];
};

/**
 * Returns the set of `P1…Pn` question IDs that have at least one atomic `FACT` claim (`P#.F#` or
 * linked `DF…` finding), used by Writer and A2UI validation to forbid citing broad `ANSWER` claims
 * (`P1`) in granular components or scenario parameters when specific facts exist.
 */
export function questionsWithAtomicFacts(claims: readonly StudyClaim[]): Set<string> {
  const set = new Set<string>();
  for (const claim of claims) {
    if (claim.kind === "FACT") {
      if (claim.planQuestionId) set.add(claim.planQuestionId);
      for (const qId of claim.questionIds ?? []) set.add(qId);
    } else if (claim.kind === "ANSWER" && (claim.findingIds?.length ?? 0) > 0 && claim.planQuestionId) {
      set.add(claim.planQuestionId);
    }
  }
  return set;
}

function quotesOf(items: readonly { quote: string }[]): string[] {
  const seen = new Set<string>();
  const quotes: string[] = [];
  for (const item of items) {
    if (!seen.has(item.quote)) {
      seen.add(item.quote);
      quotes.push(item.quote);
    }
  }
  return quotes;
}

function refsOf(items: readonly { sourceDocumentId: string; pageNumber: number }[]): EvidenceRef[] {
  const seen = new Set<string>();
  const refs: EvidenceRef[] = [];
  for (const item of items) {
    const key = pageKey(item.sourceDocumentId, item.pageNumber);
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ sourceDocumentId: item.sourceDocumentId, pageNumber: item.pageNumber });
    }
  }
  return refs;
}

/**
 * Flat claim catalog derived from an accepted Study; the Writer cites these ids and the report
 * validator resolves them. Derived on demand, never stored separately from the Study.
 */
export function studyClaimCatalog(study: VerifiedStudy): StudyClaim[] {
  const checks = new Map(study.verification.calculations.map((item) => [item.claimId, item]));
  const docFindings = study.investigation.documentFindings ?? [];
  const docFindingById = new Map<string, StudyDocumentFinding>(
    docFindings.map((finding) => [finding.id, finding]),
  );
  const questionsByFindingId = new Map<string, Set<string>>();
  const recordQuestionLink = (findingIds: readonly string[] | undefined, questionId: string) => {
    if (!findingIds) return;
    for (const fId of findingIds) {
      let set = questionsByFindingId.get(fId);
      if (!set) {
        set = new Set<string>();
        questionsByFindingId.set(fId, set);
      }
      set.add(questionId);
    }
  };
  for (const answer of study.investigation.answers) {
    const p = answer.planQuestionId;
    recordQuestionLink(answer.findingIds, p);
    for (const calc of answer.calculations) {
      for (const inp of calc.inputs) recordQuestionLink(inp.findingIds, p);
    }
    for (const assessment of answer.assessments) {
      recordQuestionLink(assessment.findingIds, p);
    }
    for (const det of answer.professionalDeterminations) {
      recordQuestionLink(det.bearingFindingIds, p);
    }
    for (const conflict of answer.conflicts) {
      recordQuestionLink(conflict.findingIds, p);
    }
  }

  const dfClaims: StudyClaim[] = docFindings.map((finding) => {
    const linkedQuestions = [...(questionsByFindingId.get(finding.id) ?? [])];
    return {
      id: finding.id,
      kind: "FACT",
      planQuestionId: null,
      questionIds: linkedQuestions,
      text: finding.statement,
      refs: refsOf(finding.evidence),
      quotes: quotesOf(finding.evidence),
      documentFinding: {
        sourceDocumentId: finding.sourceDocumentId,
        category: finding.category,
        subject: finding.subject,
        attribute: finding.attribute,
        valueAsWritten: finding.valueAsWritten,
        modality: finding.modality,
        itemKey: finding.itemKey ?? null,
        dates: [...finding.dates],
        ...(finding.unit !== undefined ? { unit: finding.unit } : {}),
        ...(finding.per !== undefined ? { per: finding.per } : {}),
        ...(finding.section !== undefined ? { section: finding.section } : {}),
        ...(finding.attributedTo !== undefined ? { attributedTo: finding.attributedTo } : {}),
        relatedFindingIds: [...(finding.relatedFindingIds ?? [])],
      },
    };
  });

  const findingEvidence = (ids: readonly string[] | undefined): InvestigationEvidence[] =>
    (ids ?? []).flatMap((id) => docFindingById.get(id)?.evidence ?? []);

  const questionClaims = study.investigation.answers.flatMap((answer) => {
    const p = answer.planQuestionId;
    const factEvidence = (indexes: readonly number[]) => indexes.flatMap((f) => answer.facts[f]?.evidence ?? []);
    const answerEv = [...answer.evidence, ...findingEvidence(answer.findingIds)];
    const claims: StudyClaim[] = [
      {
        id: p,
        kind: "ANSWER",
        planQuestionId: p,
        ...(answer.findingIds && answer.findingIds.length > 0 ? { findingIds: [...answer.findingIds] } : {}),
        text: answer.answer,
        refs: refsOf(answerEv),
        quotes: quotesOf(answerEv),
        answerStatus: answer.status,
      },
    ];
    answer.facts.forEach((fact, i) =>
      claims.push({
        id: `${p}.F${i}`,
        kind: "FACT",
        planQuestionId: p,
        text: fact.statement,
        refs: refsOf(fact.evidence),
        quotes: quotesOf(fact.evidence),
      }),
    );
    answer.calculations.forEach((calculation, i) => {
      const check = checks.get(`${p}.C${i}`);
      const evidence = calculation.inputs.flatMap((input) => [
        ...input.evidence,
        ...findingEvidence(input.findingIds),
      ]);
      const inputFindingIds = [
        ...new Set(calculation.inputs.flatMap((input) => input.findingIds ?? [])),
      ];
      claims.push({
        id: `${p}.C${i}`,
        kind: "CALCULATION",
        planQuestionId: p,
        ...(inputFindingIds.length > 0 ? { findingIds: inputFindingIds } : {}),
        text: `${calculation.description}: ${calculation.result}`,
        refs: refsOf(evidence),
        quotes: quotesOf(evidence),
        numericStatus: check?.status ?? "UNVERIFIED",
        computedValue: check?.computedValue ?? null,
      });
    });
    answer.assessments.forEach((assessment, i) => {
      const evidence = [
        ...assessment.criterionEvidence,
        ...factEvidence(assessment.factIndexes),
        ...findingEvidence(assessment.findingIds),
      ];
      claims.push({
        id: `${p}.A${i}`,
        kind: "ASSESSMENT",
        planQuestionId: p,
        ...(assessment.findingIds && assessment.findingIds.length > 0
          ? { findingIds: [...assessment.findingIds] }
          : {}),
        text: assessment.judgment,
        refs: refsOf(evidence),
        quotes: quotesOf(evidence),
        criterion: assessment.criterion,
        criterionSource: assessment.criterionSource,
      });
    });
    answer.uncertainties.forEach((item, i) =>
      claims.push({ id: `${p}.U${i}`, kind: "UNCERTAINTY", planQuestionId: p, text: item, refs: [], quotes: [] }),
    );
    answer.conflicts.forEach((conflict, i) => {
      const evidence = [...conflict.evidence, ...findingEvidence(conflict.findingIds)];
      claims.push({
        id: `${p}.K${i}`,
        kind: "CONFLICT",
        planQuestionId: p,
        ...(conflict.findingIds && conflict.findingIds.length > 0
          ? { findingIds: [...conflict.findingIds] }
          : {}),
        text: conflict.description,
        refs: refsOf(evidence),
        quotes: quotesOf(evidence),
      });
    });
    answer.professionalDeterminations.forEach((item, i) => {
      const evidence = [...factEvidence(item.bearingFacts), ...findingEvidence(item.bearingFindingIds)];
      claims.push({
        id: `${p}.D${i}`,
        kind: "DETERMINATION",
        planQuestionId: p,
        ...(item.bearingFindingIds && item.bearingFindingIds.length > 0
          ? { findingIds: [...item.bearingFindingIds] }
          : {}),
        text: `${item.determination} (decided by ${item.decidedBy})`,
        refs: refsOf(evidence),
        quotes: quotesOf(evidence),
      });
    });
    answer.limitations.forEach((item, i) =>
      claims.push({ id: `${p}.L${i}`, kind: "LIMITATION", planQuestionId: p, text: item, refs: [], quotes: [] }),
    );
    return claims;
  });

  return [...dfClaims, ...questionClaims];
}
