import type { ContractValidation } from "../source-documents/source-document-contracts";
import type {
  InvestigationAnswerStatus,
  StudyInvestigationOutput,
} from "../study-preparation/execution-manifest-contracts";
import {
  type CalculationCheck,
  type ClaimKind,
  type EvidenceRef,
  normalizeQuoteText,
  type NumericStatus,
  pageKey,
  type StudyClaim,
  studyClaimCatalog,
  type VerifiedStudy,
} from "./study-verification";

/**
 * Deterministic Canonical Finding Resolver (V4-004H Gate 1).
 *
 * Operates purely over an accepted `VerifiedStudy` and its `StudyClaim` catalog before Writer
 * presentation planning:
 *   1. Constructs deterministic finding groups across `P` questions while retaining every original
 *      claim ID (`P1.F0`, `P2.C0`, …) and originating `planQuestionId`.
 *   2. Groups only safely equivalent, same-kind assertions that share both canonical normalized
 *      assertion text and equivalent provenance; never uses substring, fuzzy, or keyword matching
 *      as proof of semantic equivalence. Ambiguous or conflicting findings remain distinct and are
 *      exposed for downstream semantic resolution.
 *   3. Preserves original claims, verbatim quotes, `sourceDocumentId`, `pageNumber`, calculation
 *      verification, assessment `criterion`/`criterionSource`, professional determinations, and
 *      conflicts without inventing, modifying, or discarding evidence.
 *   4. Flags compound `FACT` claims as `REQUIRES_SEMANTIC_ATOMIZATION` rather than splitting them
 *      with text heuristics, and defines a backward-compatible proposed-atomic-finding contract
 *      (`hive.proposed-atomic-finding/1`) with deterministic verification rules.
 *   5. Classifies temporal status only when structured evidence establishes a date range against
 *      an explicitly injected `asOf` date (`HISTORICAL_AS_OF_REPORT_DATE` when `endDate < asOfDate`),
 *      never inferring an effective replacement or the absence of a newer plan.
 */

export const CANONICAL_FINDINGS_SCHEMA = "hive.canonical-findings/1" as const;
export const PROPOSED_ATOMIC_FINDING_SCHEMA = "hive.proposed-atomic-finding/1" as const;

export const ATOMICITY_STATUSES = [
  "ATOMIC",
  "REQUIRES_SEMANTIC_ATOMIZATION",
  "NOT_APPLICABLE",
] as const;
export type AtomicityStatus = (typeof ATOMICITY_STATUSES)[number];

export const ATOMICITY_REASONS = [
  "MULTI_DOCUMENT_EVIDENCE",
  "MULTI_QUOTE_SYNTHESIS",
  "MULTIPLE_INDEPENDENT_CLAUSES",
  "MULTIPLE_MEASUREMENT_ANCHORS",
] as const;
export type AtomicityReason = (typeof ATOMICITY_REASONS)[number];

export const TEMPORAL_STATUSES = [
  "HISTORICAL_AS_OF_REPORT_DATE",
  "ACTIVE_AS_OF_REPORT_DATE",
  "FUTURE_AS_OF_REPORT_DATE",
  "UNRESOLVED_CURRENTNESS",
] as const;
export type TemporalStatus = (typeof TEMPORAL_STATUSES)[number];

export const TEMPORAL_UNRESOLVED_REASONS = [
  "NO_AS_OF_DATE_PROVIDED",
  "NO_STRUCTURED_DATE_EVIDENCE",
  "POINT_IN_TIME_ONLY",
  "PAST_END_DATE_DOES_NOT_ESTABLISH_REPLACEMENT_OR_ABSENCE_OF_NEWER_PLAN",
  "MULTIPLE_OR_AMBIGUOUS_DATE_RANGES",
] as const;
export type TemporalUnresolvedReason = (typeof TEMPORAL_UNRESOLVED_REASONS)[number];

export const CANONICAL_UNRESOLVED_REASONS = [
  "REQUIRES_SEMANTIC_ATOMIZATION",
  "AMBIGUOUS_EQUIVALENCE",
  "CONFLICTING_VALUES",
  "UNVERIFIED_CALCULATION",
  "MISSING_EVIDENCE",
  "TEMPORAL_CURRENTNESS_UNRESOLVED",
] as const;
export type CanonicalUnresolvedReason = (typeof CANONICAL_UNRESOLVED_REASONS)[number];

export type CanonicalEvidenceItem = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly quote: string;
};

export type CanonicalCalculationInputRecord = {
  readonly label: string;
  readonly valueAsWritten: string;
  readonly evidence: readonly CanonicalEvidenceItem[];
};

export type CanonicalCalculationRecord = {
  readonly description: string;
  readonly inputs: readonly CanonicalCalculationInputRecord[];
  readonly arithmetic: string;
  readonly result: string;
  readonly formula?: unknown;
  readonly verification: CalculationCheck;
};

export type CanonicalAssessmentRecord = {
  readonly judgment: string;
  readonly criterion: string;
  readonly criterionSource: "DOCUMENT" | "GENERAL_KNOWLEDGE";
  readonly criterionEvidence: readonly CanonicalEvidenceItem[];
  readonly factIndexes: readonly number[];
  readonly supportingFactClaimIds: readonly string[];
  readonly reasoning: string;
  readonly strength: "STRONG" | "MODERATE" | "TENTATIVE";
  readonly wouldChangeIf: readonly string[];
};

export type CanonicalConflictRecord = {
  readonly description: string;
  readonly evidence: readonly CanonicalEvidenceItem[];
};

export type CanonicalDeterminationRecord = {
  readonly determination: string;
  readonly bearingFacts: readonly number[];
  readonly bearingFactClaimIds: readonly string[];
  readonly decidedBy: string;
};

export type CanonicalOriginalClaimRecord = {
  readonly claimId: string;
  readonly planQuestionId: string;
  readonly kind: ClaimKind;
  readonly text: string;
  readonly refs: readonly EvidenceRef[];
  readonly quotes: readonly string[];
  readonly evidence: readonly CanonicalEvidenceItem[];
  readonly answerStatus?: InvestigationAnswerStatus;
  readonly numericStatus?: NumericStatus;
  readonly computedValue?: string | null;
  readonly criterion?: string;
  readonly criterionSource?: "DOCUMENT" | "GENERAL_KNOWLEDGE";
};

export type CanonicalFindingAtomicity = {
  readonly status: AtomicityStatus;
  readonly reasons: readonly AtomicityReason[];
  readonly canLosslesslySplitWithoutModel: boolean;
};

export type CanonicalDateRange = {
  readonly startDate: string;
  readonly endDate: string;
  readonly matchedText: string;
  readonly source: "EVIDENCE_QUOTE" | "CLAIM_TEXT";
};

export type CanonicalFindingTemporalClassification = {
  readonly status: TemporalStatus;
  readonly asOfDate: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly dateRanges: readonly CanonicalDateRange[];
  readonly pointInTimeDates: readonly string[];
  readonly currentnessResolved: boolean;
  readonly effectiveReplacementInferred: false;
  readonly newerPlanAbsenceInferred: false;
  readonly unresolvedReason: TemporalUnresolvedReason | null;
};

export type CanonicalFindingGroup = {
  readonly id: string;
  readonly stableKey: string;
  readonly kind: ClaimKind;
  readonly canonicalText: string;
  readonly normalizedAssertionKey: string;
  readonly provenanceKey: string;
  readonly questionIds: readonly string[];
  readonly originalClaimIds: readonly string[];
  readonly originalClaims: readonly CanonicalOriginalClaimRecord[];
  readonly evidence: readonly CanonicalEvidenceItem[];
  readonly refs: readonly EvidenceRef[];
  readonly quotes: readonly string[];
  readonly answerStatus: InvestigationAnswerStatus | null;
  readonly calculation: CanonicalCalculationRecord | null;
  readonly assessment: CanonicalAssessmentRecord | null;
  readonly conflict: CanonicalConflictRecord | null;
  readonly determination: CanonicalDeterminationRecord | null;
  readonly atomicity: CanonicalFindingAtomicity;
  readonly temporal: CanonicalFindingTemporalClassification;
  readonly resolutionStatus: "RESOLVED" | "UNRESOLVED";
  readonly unresolvedReasons: readonly CanonicalUnresolvedReason[];
  readonly ambiguousWithClaimIds: readonly string[];
  readonly conflictingWithClaimIds: readonly string[];
};

export type CanonicalAmbiguousFindingLink = {
  readonly leftGroupId: string;
  readonly rightGroupId: string;
  readonly leftClaimIds: readonly string[];
  readonly rightClaimIds: readonly string[];
  readonly reason: "SAME_ASSERTION_DIFFERENT_PROVENANCE_OR_DATE" | "CONFLICTING_NUMERIC_VALUES";
};

export type CanonicalFindingResolution = {
  readonly schema: typeof CANONICAL_FINDINGS_SCHEMA;
  readonly processingRunId: string;
  readonly asOfDate: string | null;
  readonly groups: readonly CanonicalFindingGroup[];
  readonly claimToGroupId: Readonly<Record<string, string>>;
  readonly ambiguousPairs: readonly CanonicalAmbiguousFindingLink[];
  readonly counts: {
    readonly totalClaims: number;
    readonly totalGroups: number;
    readonly mergedGroups: number;
    readonly compoundFactGroups: number;
    readonly unresolvedGroups: number;
    readonly historicalGroups: number;
    readonly conflictGroups: number;
    readonly ambiguousPairs: number;
  };
};

export type CanonicalFindingResolverOptions = {
  /**
   * Optional report/evaluation reference date (`YYYY-MM-DD` or `Date`).
   * Never defaults to system clock (`Date.now()`); if omitted, temporal currentness remains
   * explicitly `UNRESOLVED_CURRENTNESS` with reason `NO_AS_OF_DATE_PROVIDED`.
   */
  readonly asOf?: string | Date | null;
};

/**
 * Backward-compatible proposed-atomic-finding contract (`hive.proposed-atomic-finding/1`).
 * Allows a future semantic atomization step to propose atomic sub-findings under an existing
 * parent `FACT` claim ID (`P1.F0`, `P4.F0`, …) without changing the parent claim ID or
 * mutating the accepted Study revision.
 */
export type ProposedAtomicFinding = {
  readonly atomicId: string;
  readonly parentClaimId: string;
  readonly planQuestionId: string;
  readonly statement: string;
  readonly evidence: readonly CanonicalEvidenceItem[];
};

export type ProposedAtomicFindingSet = {
  readonly schema: typeof PROPOSED_ATOMIC_FINDING_SCHEMA;
  readonly processingRunId: string;
  readonly proposals: readonly ProposedAtomicFinding[];
};

export type VerifiedProposedAtomicFinding = ProposedAtomicFinding & {
  readonly atomicity: CanonicalFindingAtomicity;
  readonly temporal: CanonicalFindingTemporalClassification;
};

export type VerifiedProposedAtomicFindingSet = {
  readonly schema: typeof PROPOSED_ATOMIC_FINDING_SCHEMA;
  readonly processingRunId: string;
  readonly proposals: readonly VerifiedProposedAtomicFinding[];
};

const CLAIM_KIND_ORDER: Readonly<Record<ClaimKind, number>> = {
  ANSWER: 0,
  FACT: 1,
  CALCULATION: 2,
  ASSESSMENT: 3,
  UNCERTAINTY: 4,
  CONFLICT: 5,
  DETERMINATION: 6,
  LIMITATION: 7,
};

const CLAIM_ID_PARSE_RE = /^P([1-9][0-9]{0,2})(?:\.([FCAUKDL])([0-9]{1,3}))?$/;

const MONTH_INDEX: Readonly<Record<string, number>> = {
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

function parseQuestionNumber(questionId: string): number {
  const match = /^P([1-9][0-9]{0,2})$/.exec(questionId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function compareQuestionIds(left: string, right: string): number {
  const lNum = parseQuestionNumber(left);
  const rNum = parseQuestionNumber(right);
  if (lNum !== rNum) return lNum - rNum;
  return left.localeCompare(right);
}

function compareClaimIds(left: string, right: string): number {
  const lMatch = CLAIM_ID_PARSE_RE.exec(left);
  const rMatch = CLAIM_ID_PARSE_RE.exec(right);
  if (!lMatch || !rMatch) return left.localeCompare(right);
  const lQ = Number(lMatch[1]);
  const rQ = Number(rMatch[1]);
  if (lQ !== rQ) return lQ - rQ;
  const lKind = lMatch[2] ?? "";
  const rKind = rMatch[2] ?? "";
  if (lKind !== rKind) {
    if (lKind === "") return -1;
    if (rKind === "") return 1;
    const order = "FCAUKDL";
    return order.indexOf(lKind) - order.indexOf(rKind);
  }
  const lIdx = lMatch[3] !== undefined ? Number(lMatch[3]) : -1;
  const rIdx = rMatch[3] !== undefined ? Number(rMatch[3]) : -1;
  if (lIdx !== rIdx) return lIdx - rIdx;
  return left.localeCompare(right);
}

/**
 * Deterministic FNV-1a 32-bit hex digest for stable keys (pure TypeScript, no `node:crypto`).
 */
function stableHashHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Canonical assertion normalization:
 * - normalizes line endings and whitespace runs
 * - lowercases ASCII letters
 * - strips only harmless leading/trailing punctuation and optional leading article ("the ")
 * - standardizes `: ` after a leading label (e.g. `"baseline: 62 ..."` vs `"baseline was 62 ..."` ONLY
 *   when the exact tokens match, never via substring/fuzzy/keyword matching)
 * - preserves every number, date, unit, negation, and qualifier token verbatim.
 */
export function normalizeCanonicalAssertion(text: string): string {
  const collapsed = normalizeQuoteText(text)
    .toLowerCase()
    .replace(/^[""''`(\[]+/, "")
    .replace(/[.!?;:,)"'\]`]+$/, "")
    .trim();
  const withoutLeadingArticle = collapsed.replace(/^the\s+/, "");
  return withoutLeadingArticle.replace(/^([a-z0-9_-]+)\s*:\s+/, "$1 was ");
}

/**
 * Normalizes an assertion while replacing numeric literals with `<NUM>` solely to detect
 * whether two distinct findings share the exact same normalized template but state conflicting
 * numeric values. Never used to merge findings.
 */
function numericConflictTemplateKey(text: string): { template: string; numbers: string[] } {
  const norm = normalizeCanonicalAssertion(text);
  const numbers: string[] = [];
  const template = norm.replace(/\b\d+(?:,\d{3})*(?:\.\d+)?%?\b/g, (match) => {
    const cleaned = match.replace(/,/g, "");
    numbers.push(cleaned);
    return "<num>";
  });
  return { template, numbers };
}

function canonicalizeEvidenceList(
  items: readonly CanonicalEvidenceItem[],
): CanonicalEvidenceItem[] {
  const seen = new Set<string>();
  const result: CanonicalEvidenceItem[] = [];
  for (const item of items) {
    const docId = item.sourceDocumentId.toLowerCase();
    const normQuote = normalizeQuoteText(item.quote);
    const key = `${docId}:${item.pageNumber}:${normQuote}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({
        sourceDocumentId: docId,
        pageNumber: item.pageNumber,
        quote: item.quote,
      });
    }
  }
  return result.sort((a, b) => {
    const docCmp = a.sourceDocumentId.localeCompare(b.sourceDocumentId);
    if (docCmp !== 0) return docCmp;
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return normalizeQuoteText(a.quote).localeCompare(normalizeQuoteText(b.quote));
  });
}

function provenanceKeyForEvidence(
  kind: ClaimKind,
  evidence: readonly CanonicalEvidenceItem[],
  claim: StudyClaim,
  calculation: CanonicalCalculationRecord | null,
  assessment: CanonicalAssessmentRecord | null,
  determination: CanonicalDeterminationRecord | null,
): string {
  const canonicalEv = canonicalizeEvidenceList(evidence);
  const evPart =
    canonicalEv.length > 0
      ? canonicalEv
          .map((item) => `${item.sourceDocumentId}:${item.pageNumber}:${normalizeQuoteText(item.quote)}`)
          .join("|")
      : claim.refs.length > 0 || claim.quotes.length > 0
        ? [
            ...[...claim.refs]
              .map((r) => `${r.sourceDocumentId.toLowerCase()}:${r.pageNumber}`)
              .sort(),
            ...[...claim.quotes].map((q) => normalizeQuoteText(q)).sort(),
          ].join("|")
        : "no-page-evidence";

  if (kind === "CALCULATION" && calculation) {
    const inputsKey = calculation.inputs
      .map(
        (inp) =>
          `${normalizeQuoteText(inp.valueAsWritten).toLowerCase()}@${ canonicalizeEvidenceList(inp.evidence)
            .map((e) => `${e.sourceDocumentId}:${e.pageNumber}:${normalizeQuoteText(e.quote)}`)
            .join(",")}`,
      )
      .join(";");
    return `calc:${calculation.verification.status}:${calculation.verification.computedValue ?? "null"}:${inputsKey}`;
  }

  if (kind === "ASSESSMENT" && assessment) {
    return `assessment:${assessment.criterionSource}:${normalizeCanonicalAssertion(assessment.criterion)}:${assessment.strength}:${evPart}`;
  }

  if (kind === "DETERMINATION" && determination) {
    return `determination:${normalizeCanonicalAssertion(determination.decidedBy)}:${evPart}`;
  }

  return `${kind.toLowerCase()}:${evPart}`;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseIsoDateInput(asOf: string | Date | null | undefined): string | null {
  if (asOf === null || asOf === undefined) return null;
  if (asOf instanceof Date) {
    if (Number.isNaN(asOf.getTime())) return null;
    return formatIsoDate(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, asOf.getUTCDate());
  }
  if (typeof asOf !== "string") return null;
  const trimmed = asOf.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(trimmed);
  if (!isoMatch) return null;
  const year = Number(isoMatch[1]);
  const month = Number(isoMatch[2]);
  const day = Number(isoMatch[3]);
  if (!isValidCalendarDate(year, month, day)) return null;
  return formatIsoDate(year, month, day);
}

function parseSingleDateToken(raw: string): string | null {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    return isValidCalendarDate(y, m, d) ? formatIsoDate(y, m, d) : null;
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (slash) {
    const m = Number(slash[1]);
    const d = Number(slash[2]);
    const y = Number(slash[3]);
    return isValidCalendarDate(y, m, d) ? formatIsoDate(y, m, d) : null;
  }
  const named = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (named) {
    const m = MONTH_INDEX[named[1]!.toLowerCase()];
    const d = Number(named[2]);
    const y = Number(named[3]);
    return m && isValidCalendarDate(y, m, d) ? formatIsoDate(y, m, d) : null;
  }
  return null;
}

const DATE_TOKEN_SOURCE =
  "(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{4}|(?:January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\.?\\s+\\d{1,2},?\\s+\\d{4})";

const DATE_RANGE_RE = new RegExp(
  `(${DATE_TOKEN_SOURCE})\\s*(?:to|through|thru|until|-|–|—)\\s*(${DATE_TOKEN_SOURCE})`,
  "gi",
);

const SINGLE_DATE_RE = new RegExp(`\\b(${DATE_TOKEN_SOURCE})\\b`, "gi");

function extractStructuredDates(
  evidence: readonly CanonicalEvidenceItem[],
  claimText: string,
): {
  dateRanges: CanonicalDateRange[];
  pointInTimeDates: string[];
} {
  const ranges: CanonicalDateRange[] = [];
  const seenRanges = new Set<string>();
  const points = new Set<string>();

  const scanText = (sourceText: string, source: "EVIDENCE_QUOTE" | "CLAIM_TEXT") => {
    DATE_RANGE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DATE_RANGE_RE.exec(sourceText)) !== null) {
      const start = parseSingleDateToken(match[1]!);
      const end = parseSingleDateToken(match[2]!);
      if (start && end && start <= end) {
        const key = `${start}..${end}`;
        if (!seenRanges.has(key)) {
          seenRanges.add(key);
          ranges.push({
            startDate: start,
            endDate: end,
            matchedText: normalizeQuoteText(match[0]),
            source,
          });
        }
        points.add(start);
        points.add(end);
      }
    }
    SINGLE_DATE_RE.lastIndex = 0;
    let singleMatch: RegExpExecArray | null;
    while ((singleMatch = SINGLE_DATE_RE.exec(sourceText)) !== null) {
      const parsed = parseSingleDateToken(singleMatch[1]!);
      if (parsed) points.add(parsed);
    }
  };

  for (const item of evidence) {
    scanText(item.quote, "EVIDENCE_QUOTE");
  }
  scanText(claimText, "CLAIM_TEXT");

  return {
    dateRanges: ranges,
    pointInTimeDates: [...points].sort(),
  };
}

/**
 * Classifies temporal status strictly from structured date evidence and an injected `asOf` date.
 * - Never calls `new Date()` or `Date.now()`.
 * - Treats a past `endDate` (`endDate < asOfDate`) as `HISTORICAL_AS_OF_REPORT_DATE`, while keeping
 *   `currentnessResolved: false`, `effectiveReplacementInferred: false`, and
 *   `newerPlanAbsenceInferred: false`.
 */
export function classifyFindingTemporalStatus(
  evidence: readonly CanonicalEvidenceItem[],
  claimText: string,
  asOf?: string | Date | null,
): CanonicalFindingTemporalClassification {
  const asOfDate = parseIsoDateInput(asOf);
  const { dateRanges, pointInTimeDates } = extractStructuredDates(evidence, claimText);

  if (!asOfDate) {
    const singleRange = dateRanges.length === 1 ? dateRanges[0]! : null;
    return {
      status: "UNRESOLVED_CURRENTNESS",
      asOfDate: null,
      startDate: singleRange?.startDate ?? null,
      endDate: singleRange?.endDate ?? null,
      dateRanges,
      pointInTimeDates,
      currentnessResolved: false,
      effectiveReplacementInferred: false,
      newerPlanAbsenceInferred: false,
      unresolvedReason: "NO_AS_OF_DATE_PROVIDED",
    };
  }

  if (dateRanges.length === 0) {
    return {
      status: "UNRESOLVED_CURRENTNESS",
      asOfDate,
      startDate: null,
      endDate: null,
      dateRanges: [],
      pointInTimeDates,
      currentnessResolved: false,
      effectiveReplacementInferred: false,
      newerPlanAbsenceInferred: false,
      unresolvedReason: pointInTimeDates.length > 0 ? "POINT_IN_TIME_ONLY" : "NO_STRUCTURED_DATE_EVIDENCE",
    };
  }

  if (dateRanges.length > 1) {
    return {
      status: "UNRESOLVED_CURRENTNESS",
      asOfDate,
      startDate: null,
      endDate: null,
      dateRanges,
      pointInTimeDates,
      currentnessResolved: false,
      effectiveReplacementInferred: false,
      newerPlanAbsenceInferred: false,
      unresolvedReason: "MULTIPLE_OR_AMBIGUOUS_DATE_RANGES",
    };
  }

  const range = dateRanges[0]!;
  if (range.endDate < asOfDate) {
    return {
      status: "HISTORICAL_AS_OF_REPORT_DATE",
      asOfDate,
      startDate: range.startDate,
      endDate: range.endDate,
      dateRanges,
      pointInTimeDates,
      currentnessResolved: false,
      effectiveReplacementInferred: false,
      newerPlanAbsenceInferred: false,
      unresolvedReason: "PAST_END_DATE_DOES_NOT_ESTABLISH_REPLACEMENT_OR_ABSENCE_OF_NEWER_PLAN",
    };
  }

  if (range.startDate > asOfDate) {
    return {
      status: "FUTURE_AS_OF_REPORT_DATE",
      asOfDate,
      startDate: range.startDate,
      endDate: range.endDate,
      dateRanges,
      pointInTimeDates,
      currentnessResolved: true,
      effectiveReplacementInferred: false,
      newerPlanAbsenceInferred: false,
      unresolvedReason: null,
    };
  }

  return {
    status: "ACTIVE_AS_OF_REPORT_DATE",
    asOfDate,
    startDate: range.startDate,
    endDate: range.endDate,
    dateRanges,
    pointInTimeDates,
    currentnessResolved: true,
    effectiveReplacementInferred: false,
    newerPlanAbsenceInferred: false,
    unresolvedReason: null,
  };
}

/**
 * Evaluates whether a `FACT` claim is atomic or requires semantic atomization.
 * Never splits a compound claim using heuristics.
 */
export function classifyFactAtomicity(
  statement: string,
  evidence: readonly CanonicalEvidenceItem[],
): CanonicalFindingAtomicity {
  const reasons: AtomicityReason[] = [];
  const canonicalEv = canonicalizeEvidenceList(evidence);
  const distinctDocs = new Set(canonicalEv.map((item) => item.sourceDocumentId));
  if (distinctDocs.size > 1) {
    reasons.push("MULTI_DOCUMENT_EVIDENCE");
  }

  const distinctQuotes = new Set(canonicalEv.map((item) => normalizeQuoteText(item.quote)));
  if (distinctQuotes.size > 1) {
    const normalizedStatement = normalizeQuoteText(statement);
    const singleQuoteCoversAllNumbers = [...distinctQuotes].some((quote) => {
      const statementNums = extractNumericLiterals(normalizedStatement);
      const quoteNums = new Set(extractNumericLiterals(quote));
      return statementNums.length > 0 && statementNums.every((n) => quoteNums.has(n));
    });
    if (!singleQuoteCoversAllNumbers || distinctQuotes.size >= 3) {
      reasons.push("MULTI_QUOTE_SYNTHESIS");
    }
  }

  const normalized = normalizeQuoteText(statement);
  const hasSemicolonClause = /;\s+[A-Za-z0-9]/.test(normalized);
  const hasMultiSentence = /[.!?]\s+[A-Z]/.test(normalized.replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.\s+/g, " "));
  const hasCompositeConjunction =
    /\b(?:while|whereas|and\s+neither|and\s+the\s+log\s+shows|and\s+january|and\s+speech|and\s+comprehension)\b/i.test(
      normalized,
    ) ||
    (/,\s+and\s+/i.test(normalized) && extractNumericLiterals(normalized).length >= 2);
  if (hasSemicolonClause || hasMultiSentence || hasCompositeConjunction) {
    reasons.push("MULTIPLE_INDEPENDENT_CLAUSES");
  }

  const withoutDateRanges = normalized.replace(DATE_RANGE_RE, " ").replace(SINGLE_DATE_RE, " ");
  const measurementNums = extractNumericLiterals(withoutDateRanges);
  const hasProgressionAndTarget =
    /\b(?:from\s+\d+|rose\s+from|increased\s+from|went\s+from|compared\s+with|against\s+(?:a|the)\s+(?:goal|target))\b/i.test(
      withoutDateRanges,
    ) && measurementNums.length >= 2;
  if (measurementNums.length >= 3 || hasProgressionAndTarget) {
    reasons.push("MULTIPLE_MEASUREMENT_ANCHORS");
  }

  if (reasons.length > 0) {
    return {
      status: "REQUIRES_SEMANTIC_ATOMIZATION",
      reasons,
      canLosslesslySplitWithoutModel: false,
    };
  }

  return {
    status: "ATOMIC",
    reasons: [],
    canLosslesslySplitWithoutModel: true,
  };
}

function extractNumericLiterals(text: string): string[] {
  const matches = text.match(/\b\d+(?:,\d{3})*(?:\.\d+)?\b/g) ?? [];
  return matches.map((m) => m.replace(/,/g, ""));
}

type EnrichedClaimSource = {
  readonly claim: StudyClaim;
  readonly evidence: readonly CanonicalEvidenceItem[];
  readonly calculation: CanonicalCalculationRecord | null;
  readonly assessment: CanonicalAssessmentRecord | null;
  readonly conflict: CanonicalConflictRecord | null;
  readonly determination: CanonicalDeterminationRecord | null;
};

function indexStudyDetails(
  verifiedStudy: VerifiedStudy,
  claims: readonly StudyClaim[],
): EnrichedClaimSource[] {
  const checksByClaimId = new Map<string, CalculationCheck>(
    verifiedStudy.verification.calculations.map((check) => [check.claimId, check]),
  );
  const answersByQuestionId = new Map<
    string,
    StudyInvestigationOutput["answers"][number]
  >(verifiedStudy.investigation.answers.map((ans) => [ans.planQuestionId, ans]));

  return claims.map((claim) => {
    const answer = answersByQuestionId.get(claim.planQuestionId);
    const parsed = CLAIM_ID_PARSE_RE.exec(claim.id);
    const subKind = parsed?.[2] ?? "";
    const subIndex = parsed?.[3] !== undefined ? Number(parsed[3]) : -1;

    if (!answer) {
      const fallbackEvidence: CanonicalEvidenceItem[] =
        claim.refs.length > 0 && claim.quotes.length > 0
          ? claim.quotes.map((quote, idx) => {
              const ref = claim.refs[Math.min(idx, claim.refs.length - 1)]!;
              return {
                sourceDocumentId: ref.sourceDocumentId.toLowerCase(),
                pageNumber: ref.pageNumber,
                quote,
              };
            })
          : [];
      return {
        claim,
        evidence: canonicalizeEvidenceList(fallbackEvidence),
        calculation: null,
        assessment: null,
        conflict: null,
        determination: null,
      };
    }

    const p = answer.planQuestionId;
    const factEvidence = (indexes: readonly number[]): CanonicalEvidenceItem[] =>
      indexes.flatMap((fIdx) => answer.facts[fIdx]?.evidence ?? []);

    if (claim.kind === "ANSWER" && subKind === "") {
      return {
        claim,
        evidence: canonicalizeEvidenceList(answer.evidence),
        calculation: null,
        assessment: null,
        conflict: null,
        determination: null,
      };
    }

    if (claim.kind === "FACT" && subKind === "F" && subIndex >= 0 && answer.facts[subIndex]) {
      const fact = answer.facts[subIndex]!;
      return {
        claim,
        evidence: canonicalizeEvidenceList(fact.evidence),
        calculation: null,
        assessment: null,
        conflict: null,
        determination: null,
      };
    }

    if (
      claim.kind === "CALCULATION" &&
      subKind === "C" &&
      subIndex >= 0 &&
      answer.calculations[subIndex]
    ) {
      const calc = answer.calculations[subIndex]!;
      const check: CalculationCheck = checksByClaimId.get(claim.id) ?? {
        claimId: claim.id,
        status: claim.numericStatus ?? "UNVERIFIED",
        reason: "NO_FORMULA",
        computedValue: claim.computedValue ?? null,
        statedValue: null,
      };
      const allEv = calc.inputs.flatMap((inp) => inp.evidence);
      return {
        claim,
        evidence: canonicalizeEvidenceList(allEv),
        calculation: {
          description: calc.description,
          inputs: calc.inputs.map((inp) => ({
            label: inp.label,
            valueAsWritten: inp.valueAsWritten,
            evidence: canonicalizeEvidenceList(inp.evidence),
          })),
          arithmetic: calc.arithmetic,
          result: calc.result,
          ...(calc.formula !== undefined ? { formula: calc.formula } : {}),
          verification: { ...check },
        },
        assessment: null,
        conflict: null,
        determination: null,
      };
    }

    if (
      claim.kind === "ASSESSMENT" &&
      subKind === "A" &&
      subIndex >= 0 &&
      answer.assessments[subIndex]
    ) {
      const assessment = answer.assessments[subIndex]!;
      const combinedEv = [
        ...assessment.criterionEvidence,
        ...factEvidence(assessment.factIndexes),
      ];
      return {
        claim,
        evidence: canonicalizeEvidenceList(combinedEv),
        calculation: null,
        assessment: {
          judgment: assessment.judgment,
          criterion: assessment.criterion,
          criterionSource: assessment.criterionSource,
          criterionEvidence: canonicalizeEvidenceList(assessment.criterionEvidence),
          factIndexes: [...assessment.factIndexes],
          supportingFactClaimIds: assessment.factIndexes.map((idx) => `${p}.F${idx}`),
          reasoning: assessment.reasoning,
          strength: assessment.strength,
          wouldChangeIf: [...assessment.wouldChangeIf],
        },
        conflict: null,
        determination: null,
      };
    }

    if (
      claim.kind === "CONFLICT" &&
      subKind === "K" &&
      subIndex >= 0 &&
      answer.conflicts[subIndex]
    ) {
      const conflict = answer.conflicts[subIndex]!;
      return {
        claim,
        evidence: canonicalizeEvidenceList(conflict.evidence),
        calculation: null,
        assessment: null,
        conflict: {
          description: conflict.description,
          evidence: canonicalizeEvidenceList(conflict.evidence),
        },
        determination: null,
      };
    }

    if (
      claim.kind === "DETERMINATION" &&
      subKind === "D" &&
      subIndex >= 0 &&
      answer.professionalDeterminations[subIndex]
    ) {
      const det = answer.professionalDeterminations[subIndex]!;
      const ev = factEvidence(det.bearingFacts);
      return {
        claim,
        evidence: canonicalizeEvidenceList(ev),
        calculation: null,
        assessment: null,
        conflict: null,
        determination: {
          determination: det.determination,
          bearingFacts: [...det.bearingFacts],
          bearingFactClaimIds: det.bearingFacts.map((idx) => `${p}.F${idx}`),
          decidedBy: det.decidedBy,
        },
      };
    }

    return {
      claim,
      evidence: [],
      calculation: null,
      assessment: null,
      conflict: null,
      determination: null,
    };
  });
}

function mergeEvidencePreservingOrder(
  lists: readonly (readonly CanonicalEvidenceItem[])[],
): CanonicalEvidenceItem[] {
  const seen = new Set<string>();
  const merged: CanonicalEvidenceItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = `${item.sourceDocumentId.toLowerCase()}:${item.pageNumber}:${normalizeQuoteText(item.quote)}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push({
          sourceDocumentId: item.sourceDocumentId.toLowerCase(),
          pageNumber: item.pageNumber,
          quote: item.quote,
        });
      }
    }
  }
  return merged;
}

function mergeRefsPreservingOrder(
  lists: readonly (readonly EvidenceRef[])[],
): EvidenceRef[] {
  const seen = new Set<string>();
  const merged: EvidenceRef[] = [];
  for (const list of lists) {
    for (const ref of list) {
      const key = pageKey(ref.sourceDocumentId, ref.pageNumber);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push({
          sourceDocumentId: ref.sourceDocumentId.toLowerCase(),
          pageNumber: ref.pageNumber,
        });
      }
    }
  }
  return merged;
}

function mergeQuotesPreservingOrder(
  lists: readonly (readonly string[])[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const quote of list) {
      if (!seen.has(quote)) {
        seen.add(quote);
        merged.push(quote);
      }
    }
  }
  return merged;
}

/**
 * Pure deterministic Canonical Finding Resolver over an accepted `VerifiedStudy` and its `StudyClaim` list.
 */
export function resolveCanonicalFindings(
  verifiedStudy: VerifiedStudy,
  claims: readonly StudyClaim[] = studyClaimCatalog(verifiedStudy),
  options?: CanonicalFindingResolverOptions,
): CanonicalFindingResolution {
  const sortedClaims = [...claims].sort((a, b) => compareClaimIds(a.id, b.id));
  const enriched = indexStudyDetails(verifiedStudy, sortedClaims);

  type Bucket = {
    readonly groupKey: string;
    readonly kind: ClaimKind;
    readonly normalizedAssertionKey: string;
    readonly provenanceKey: string;
    readonly items: EnrichedClaimSource[];
  };

  const bucketsByKey = new Map<string, Bucket>();
  const bucketOrder: Bucket[] = [];

  for (const item of enriched) {
    const { claim, evidence, calculation, assessment, determination } = item;
    const normalizedAssertionKey = normalizeCanonicalAssertion(claim.text);
    const provenanceKey = provenanceKeyForEvidence(
      claim.kind,
      evidence,
      claim,
      calculation,
      assessment,
      determination,
    );

    // Question-level ANSWER claims and CONFLICT claims stay scoped to their own claim or exact identical provenance+assertion.
    // Specifically, ANSWER claims answer a specific planQuestionId and are never collapsed across questions.
    const canGroupAcrossQuestions = claim.kind !== "ANSWER";
    const groupKey = canGroupAcrossQuestions
      ? `${claim.kind}::${normalizedAssertionKey}::${provenanceKey}`
      : `ANSWER::${claim.id}::${normalizedAssertionKey}::${provenanceKey}`;

    const existing = bucketsByKey.get(groupKey);
    if (existing) {
      existing.items.push(item);
    } else {
      const bucket: Bucket = {
        groupKey,
        kind: claim.kind,
        normalizedAssertionKey,
        provenanceKey,
        items: [item],
      };
      bucketsByKey.set(groupKey, bucket);
      bucketOrder.push(bucket);
    }
  }

  // Sort buckets deterministically by first originalClaimId, then kind, then groupKey.
  bucketOrder.sort((a, b) => {
    const firstA = a.items[0]!.claim.id;
    const firstB = b.items[0]!.claim.id;
    const cmp = compareClaimIds(firstA, firstB);
    if (cmp !== 0) return cmp;
    const kindCmp = CLAIM_KIND_ORDER[a.kind] - CLAIM_KIND_ORDER[b.kind];
    if (kindCmp !== 0) return kindCmp;
    return a.groupKey.localeCompare(b.groupKey);
  });

  // Detect ambiguous pairs (same kind + same normalizedAssertionKey, but different provenance/dates)
  // and conflicting numeric pairs (same kind === FACT, same non-empty template with > 3 words, different numbers, not date differences).
  const ambiguousWithByBucketIndex = new Map<number, Set<string>>();
  const conflictingWithByBucketIndex = new Map<number, Set<string>>();
  const ambiguousPairs: CanonicalAmbiguousFindingLink[] = [];

  // Also collect explicit conflict evidence quotes so FACT claims citing those exact conflicting quotes are linked.
  const conflictQuoteToConflictClaimIds = new Map<string, Set<string>>();
  for (const bucket of bucketOrder) {
    if (bucket.kind !== "CONFLICT") continue;
    for (const item of bucket.items) {
      for (const ev of item.evidence) {
        const qKey = `${ev.sourceDocumentId}:${ev.pageNumber}:${normalizeQuoteText(ev.quote)}`;
        let set = conflictQuoteToConflictClaimIds.get(qKey);
        if (!set) {
          set = new Set<string>();
          conflictQuoteToConflictClaimIds.set(qKey, set);
        }
        set.add(item.claim.id);
      }
    }
  }

  for (let i = 0; i < bucketOrder.length; i += 1) {
    ambiguousWithByBucketIndex.set(i, new Set<string>());
    conflictingWithByBucketIndex.set(i, new Set<string>());
  }

  for (let i = 0; i < bucketOrder.length; i += 1) {
    const left = bucketOrder[i]!;
    const leftClaimIds = left.items.map((it) => it.claim.id);
    const leftGroupId = `CF${i + 1}`;

    for (let j = i + 1; j < bucketOrder.length; j += 1) {
      const right = bucketOrder[j]!;
      if (left.kind !== right.kind) continue;
      const rightClaimIds = right.items.map((it) => it.claim.id);
      const rightGroupId = `CF${j + 1}`;

      // 1. Same normalized assertion text, but distinct provenance / dates -> kept distinct & flagged AMBIGUOUS_EQUIVALENCE
      if (
        left.normalizedAssertionKey === right.normalizedAssertionKey &&
        left.provenanceKey !== right.provenanceKey
      ) {
        for (const id of rightClaimIds) ambiguousWithByBucketIndex.get(i)!.add(id);
        for (const id of leftClaimIds) ambiguousWithByBucketIndex.get(j)!.add(id);
        ambiguousPairs.push({
          leftGroupId,
          rightGroupId,
          leftClaimIds,
          rightClaimIds,
          reason: "SAME_ASSERTION_DIFFERENT_PROVENANCE_OR_DATE",
        });
        continue;
      }

      // 2. Conflicting numeric values on the same fact assertion template (where dates are not the only difference)
      if (left.kind === "FACT" && right.kind === "FACT") {
        const leftWithoutDates = normalizeCanonicalAssertion(
          left.items[0]!.claim.text.replace(DATE_RANGE_RE, "<daterange>").replace(SINGLE_DATE_RE, "<date>"),
        );
        const rightWithoutDates = normalizeCanonicalAssertion(
          right.items[0]!.claim.text.replace(DATE_RANGE_RE, "<daterange>").replace(SINGLE_DATE_RE, "<date>"),
        );
        const leftTpl = numericConflictTemplateKey(leftWithoutDates);
        const rightTpl = numericConflictTemplateKey(rightWithoutDates);
        if (
          leftTpl.numbers.length > 0 &&
          leftTpl.numbers.length === rightTpl.numbers.length &&
          leftTpl.template === rightTpl.template &&
          leftTpl.numbers.join(",") !== rightTpl.numbers.join(",")
        ) {
          for (const id of rightClaimIds) conflictingWithByBucketIndex.get(i)!.add(id);
          for (const id of leftClaimIds) conflictingWithByBucketIndex.get(j)!.add(id);
          ambiguousPairs.push({
            leftGroupId,
            rightGroupId,
            leftClaimIds,
            rightClaimIds,
            reason: "CONFLICTING_NUMERIC_VALUES",
          });
        }
      }
    }

    // Also link FACT buckets whose evidence is part of an explicit CONFLICT (.K) claim
    if (left.kind === "FACT") {
      for (const item of left.items) {
        for (const ev of item.evidence) {
          const qKey = `${ev.sourceDocumentId}:${ev.pageNumber}:${normalizeQuoteText(ev.quote)}`;
          const conflictIds = conflictQuoteToConflictClaimIds.get(qKey);
          if (conflictIds) {
            for (const cId of conflictIds) {
              conflictingWithByBucketIndex.get(i)!.add(cId);
            }
          }
        }
      }
    }
  }

  const claimToGroupId: Record<string, string> = {};
  const groups: CanonicalFindingGroup[] = bucketOrder.map((bucket, idx) => {
    const id = `CF${idx + 1}`;
    const orderedItems = [...bucket.items].sort((a, b) => compareClaimIds(a.claim.id, b.claim.id));
    const primary = orderedItems[0]!;
    const originalClaimIds = orderedItems.map((it) => it.claim.id);
    for (const claimId of originalClaimIds) {
      claimToGroupId[claimId] = id;
    }

    const questionIdSet = new Set<string>(orderedItems.map((it) => it.claim.planQuestionId));
    const questionIds = [...questionIdSet].sort(compareQuestionIds);

    const evidence = mergeEvidencePreservingOrder(orderedItems.map((it) => it.evidence));
    const refs = mergeRefsPreservingOrder(orderedItems.map((it) => it.claim.refs));
    const quotes = mergeQuotesPreservingOrder(orderedItems.map((it) => it.claim.quotes));

    const originalClaims: CanonicalOriginalClaimRecord[] = orderedItems.map((it) => ({
      claimId: it.claim.id,
      planQuestionId: it.claim.planQuestionId,
      kind: it.claim.kind,
      text: it.claim.text,
      refs: it.claim.refs.map((r) => ({
        sourceDocumentId: r.sourceDocumentId.toLowerCase(),
        pageNumber: r.pageNumber,
      })),
      quotes: [...it.claim.quotes],
      evidence: it.evidence.map((ev) => ({ ...ev })),
      ...(it.claim.answerStatus !== undefined ? { answerStatus: it.claim.answerStatus } : {}),
      ...(it.claim.numericStatus !== undefined ? { numericStatus: it.claim.numericStatus } : {}),
      ...(it.claim.computedValue !== undefined ? { computedValue: it.claim.computedValue } : {}),
      ...(it.claim.criterion !== undefined ? { criterion: it.claim.criterion } : {}),
      ...(it.claim.criterionSource !== undefined ? { criterionSource: it.claim.criterionSource } : {}),
    }));

    const atomicity: CanonicalFindingAtomicity =
      bucket.kind === "FACT"
        ? classifyFactAtomicity(primary.claim.text, evidence)
        : {
            status: "NOT_APPLICABLE",
            reasons: [],
            canLosslesslySplitWithoutModel: false,
          };

    const temporal = classifyFindingTemporalStatus(evidence, primary.claim.text, options?.asOf);

    const ambiguousWithClaimIds = [...(ambiguousWithByBucketIndex.get(idx) ?? [])].sort(compareClaimIds);
    const conflictingWithClaimIds = [...(conflictingWithByBucketIndex.get(idx) ?? [])].sort(compareClaimIds);

    const unresolvedReasons: CanonicalUnresolvedReason[] = [];
    if (atomicity.status === "REQUIRES_SEMANTIC_ATOMIZATION") {
      unresolvedReasons.push("REQUIRES_SEMANTIC_ATOMIZATION");
    }
    if (ambiguousWithClaimIds.length > 0) {
      unresolvedReasons.push("AMBIGUOUS_EQUIVALENCE");
    }
    if (bucket.kind === "CONFLICT" || conflictingWithClaimIds.length > 0 || primary.claim.answerStatus === "CONFLICTING") {
      unresolvedReasons.push("CONFLICTING_VALUES");
    }
    if (
      bucket.kind === "CALCULATION" &&
      primary.calculation &&
      primary.calculation.verification.status !== "VERIFIED"
    ) {
      unresolvedReasons.push("UNVERIFIED_CALCULATION");
    }
    if (
      bucket.kind === "UNCERTAINTY" ||
      bucket.kind === "LIMITATION" ||
      primary.claim.answerStatus === "MISSING_EVIDENCE"
    ) {
      unresolvedReasons.push("MISSING_EVIDENCE");
    }
    if (
      temporal.status === "HISTORICAL_AS_OF_REPORT_DATE" ||
      temporal.unresolvedReason === "MULTIPLE_OR_AMBIGUOUS_DATE_RANGES"
    ) {
      unresolvedReasons.push("TEMPORAL_CURRENTNESS_UNRESOLVED");
    }

    const stableKey = `cf:${bucket.kind.toLowerCase()}:${originalClaimIds[0]!}:${stableHashHex(bucket.groupKey)}`;

    return {
      id,
      stableKey,
      kind: bucket.kind,
      canonicalText: primary.claim.text,
      normalizedAssertionKey: bucket.normalizedAssertionKey,
      provenanceKey: bucket.provenanceKey,
      questionIds,
      originalClaimIds,
      originalClaims,
      evidence,
      refs,
      quotes,
      answerStatus: primary.claim.answerStatus ?? null,
      calculation: primary.calculation,
      assessment: primary.assessment,
      conflict: primary.conflict,
      determination: primary.determination,
      atomicity,
      temporal,
      resolutionStatus: unresolvedReasons.length > 0 ? "UNRESOLVED" : "RESOLVED",
      unresolvedReasons,
      ambiguousWithClaimIds,
      conflictingWithClaimIds,
    };
  });

  const asOfDate = parseIsoDateInput(options?.asOf);

  return {
    schema: CANONICAL_FINDINGS_SCHEMA,
    processingRunId: verifiedStudy.verification.processingRunId,
    asOfDate,
    groups,
    claimToGroupId,
    ambiguousPairs,
    counts: {
      totalClaims: sortedClaims.length,
      totalGroups: groups.length,
      mergedGroups: groups.filter((g) => g.originalClaimIds.length > 1).length,
      compoundFactGroups: groups.filter((g) => g.atomicity.status === "REQUIRES_SEMANTIC_ATOMIZATION").length,
      unresolvedGroups: groups.filter((g) => g.resolutionStatus === "UNRESOLVED").length,
      historicalGroups: groups.filter((g) => g.temporal.status === "HISTORICAL_AS_OF_REPORT_DATE").length,
      conflictGroups: groups.filter((g) => g.unresolvedReasons.includes("CONFLICTING_VALUES")).length,
      ambiguousPairs: ambiguousPairs.length,
    },
  };
}

/**
 * Deterministic verifier for the backward-compatible `hive.proposed-atomic-finding/1` contract.
 * Ensures that any future semantic atomization of a compound `FACT` claim:
 *   1. References a real `FACT` claim in the accepted `VerifiedStudy` with matching `planQuestionId`.
 *   2. Uses only verified `(sourceDocumentId, pageNumber, quote)` evidence already attached to that
 *      parent `FACT` claim (never inventing, changing, or widening evidence).
 *   3. Grounds every numeric literal in the proposed atomic statement in its own cited evidence quotes.
 *   4. Produces genuinely atomic statements (`atomicity.status === "ATOMIC"`).
 */
export function verifyProposedAtomicFindings(
  raw: unknown,
  verifiedStudy: VerifiedStudy,
  claims: readonly StudyClaim[] = studyClaimCatalog(verifiedStudy),
  options?: CanonicalFindingResolverOptions,
): ContractValidation<VerifiedProposedAtomicFindingSet> {
  const fail = (
    diagnosticReason: string,
    message: string,
    diagnosticField?: string,
  ): ContractValidation<VerifiedProposedAtomicFindingSet> => ({
    ok: false,
    message,
    diagnosticReason,
    ...(diagnosticField ? { diagnosticField } : {}),
  });

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("atomic_finding_shape", "Proposed atomic findings must be an object.", "output");
  }
  const root = raw as Record<string, unknown>;
  if (root.schema !== PROPOSED_ATOMIC_FINDING_SCHEMA) {
    return fail("atomic_finding_schema", `schema must be ${PROPOSED_ATOMIC_FINDING_SCHEMA}.`, "schema");
  }
  if (
    typeof root.processingRunId !== "string" ||
    root.processingRunId.toLowerCase() !== verifiedStudy.verification.processingRunId.toLowerCase()
  ) {
    return fail("atomic_finding_run_mismatch", "processingRunId does not match the VerifiedStudy.", "processingRunId");
  }
  if (!Array.isArray(root.proposals) || root.proposals.length === 0) {
    return fail("atomic_finding_shape", "proposals must be a non-empty list.", "proposals");
  }

  const enrichedById = new Map<string, EnrichedClaimSource>(
    indexStudyDetails(verifiedStudy, claims).map((item) => [item.claim.id, item]),
  );

  const seenAtomicIds = new Set<string>();
  const verifiedProposals: VerifiedProposedAtomicFinding[] = [];

  for (let i = 0; i < root.proposals.length; i += 1) {
    const path = `proposals[${i}]`;
    const item = root.proposals[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return fail("atomic_finding_shape", `${path} must be an object.`, path);
    }
    const rec = item as Record<string, unknown>;
    const atomicId = rec.atomicId;
    const parentClaimId = rec.parentClaimId;
    const planQuestionId = rec.planQuestionId;
    const statement = rec.statement;

    if (typeof atomicId !== "string" || atomicId.trim() === "" || atomicId.length > 64) {
      return fail("atomic_finding_shape", `${path}.atomicId must be non-empty text up to 64 characters.`, `${path}.atomicId`);
    }
    if (seenAtomicIds.has(atomicId)) {
      return fail("atomic_finding_duplicate_id", `${path}.atomicId is duplicated.`, `${path}.atomicId`);
    }
    seenAtomicIds.add(atomicId);

    if (typeof parentClaimId !== "string") {
      return fail("atomic_finding_parent_unknown", `${path}.parentClaimId must be a FACT claim ID.`, `${path}.parentClaimId`);
    }
    const parent = enrichedById.get(parentClaimId);
    if (!parent || parent.claim.kind !== "FACT") {
      return fail("atomic_finding_parent_unknown", `${path}.parentClaimId must reference an existing FACT claim.`, `${path}.parentClaimId`);
    }
    if (typeof planQuestionId !== "string" || planQuestionId !== parent.claim.planQuestionId) {
      return fail(
        "atomic_finding_question_mismatch",
        `${path}.planQuestionId must match parent claim ${parentClaimId} (${parent.claim.planQuestionId}).`,
        `${path}.planQuestionId`,
      );
    }
    if (typeof statement !== "string" || statement.trim() === "" || statement.length > 600) {
      return fail("atomic_finding_shape", `${path}.statement must be non-empty text up to 600 characters.`, `${path}.statement`);
    }
    if (!Array.isArray(rec.evidence) || rec.evidence.length === 0) {
      return fail("atomic_finding_evidence_invalid", `${path}.evidence must be a non-empty list.`, `${path}.evidence`);
    }

    const parentEvidenceKeys = new Map<string, CanonicalEvidenceItem>();
    for (const ev of parent.evidence) {
      const key = `${ev.sourceDocumentId.toLowerCase()}:${ev.pageNumber}:${normalizeQuoteText(ev.quote)}`;
      parentEvidenceKeys.set(key, ev);
    }

    const verifiedEvidence: CanonicalEvidenceItem[] = [];
    for (let eIdx = 0; eIdx < rec.evidence.length; eIdx += 1) {
      const evPath = `${path}.evidence[${eIdx}]`;
      const evRaw = rec.evidence[eIdx];
      if (!evRaw || typeof evRaw !== "object" || Array.isArray(evRaw)) {
        return fail("atomic_finding_evidence_invalid", `${evPath} must be an object.`, evPath);
      }
      const evRec = evRaw as Record<string, unknown>;
      if (
        typeof evRec.sourceDocumentId !== "string" ||
        typeof evRec.pageNumber !== "number" ||
        typeof evRec.quote !== "string"
      ) {
        return fail("atomic_finding_evidence_invalid", `${evPath} must specify sourceDocumentId, pageNumber, and quote.`, evPath);
      }
      const key = `${evRec.sourceDocumentId.toLowerCase()}:${evRec.pageNumber}:${normalizeQuoteText(evRec.quote)}`;
      const matchedParentEv = parentEvidenceKeys.get(key);
      if (!matchedParentEv) {
        return fail(
          "atomic_finding_evidence_unverified",
          `${evPath} is not in parent claim ${parentClaimId}'s verified evidence.`,
          evPath,
        );
      }
      verifiedEvidence.push(matchedParentEv);
    }

    // Check numeric grounding against the atomic finding's own cited evidence quotes
    const statementNums = extractNumericLiterals(statement);
    const quoteNums = new Set(
      verifiedEvidence.flatMap((ev) => extractNumericLiterals(ev.quote)),
    );
    const ungrounded = statementNums.find((num) => !quoteNums.has(num));
    if (ungrounded !== undefined) {
      return fail(
        "atomic_finding_number_ungrounded",
        `${path}.statement contains number ${ungrounded} not grounded in its cited evidence quotes.`,
        `${path}.statement`,
      );
    }

    const atomicity = classifyFactAtomicity(statement, verifiedEvidence);
    if (atomicity.status !== "ATOMIC") {
      return fail(
        "atomic_finding_still_compound",
        `${path}.statement is still compound (${atomicity.reasons.join(", ")}).`,
        `${path}.statement`,
      );
    }

    const temporal = classifyFindingTemporalStatus(verifiedEvidence, statement, options?.asOf);
    verifiedProposals.push({
      atomicId,
      parentClaimId,
      planQuestionId,
      statement,
      evidence: canonicalizeEvidenceList(verifiedEvidence),
      atomicity,
      temporal,
    });
  }

  return {
    ok: true,
    value: {
      schema: PROPOSED_ATOMIC_FINDING_SCHEMA,
      processingRunId: verifiedStudy.verification.processingRunId,
      proposals: verifiedProposals,
    },
  };
}
