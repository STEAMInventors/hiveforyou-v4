import {
  buildActiveTemporalClaimIds,
  buildHistoricalTemporalMap,
  type CanonicalFindingResolution,
  type CanonicalFindingTemporalClassification,
} from "../analysis/canonical-finding-resolver";
import {
  type Decimal,
  decimalFromPlain,
  evaluateFormula,
  type FormulaNode,
  formatDecimal,
  formulaLeaves,
  parseFormula,
} from "../analysis/decimal-formula";
import {
  type EvidenceRef,
  questionsWithAtomicFacts,
  type StudyClaim,
} from "../analysis/study-verification";
import { diagnosticFieldFromMessage } from "../errors/failure-diagnostic";
import type { ContractValidation } from "../source-documents/source-document-contracts";

/**
 * `hive.writer-report/1` (D-041): one Writer model call per audience proposes report text, scenario
 * definitions and an A2UI composition over an accepted Canonical Study. Trusted code validates it
 * against the Study's claim catalog (every claim reference resolves, numbers are grounded,
 * unverified calculations never appear as documented findings, uncertainties are surfaced),
 * computes every scenario result itself, and binds the view only to verified values.
 */

export const WRITER_REPORT_SCHEMA = "hive.writer-report/1";
export const SCENARIO_ANALYSIS_SCHEMA = "hive.scenario-analysis/1";

export const REPORT_AUDIENCES = ["CUSTOMER", "PRO"] as const;
export type ReportAudience = (typeof REPORT_AUDIENCES)[number];

export const REPORT_BLOCK_TYPES = [
  "DOCUMENTED",
  "INTERPRETATION",
  "UNCERTAINTY",
  "GENERAL_INFORMATION",
  "QUESTION",
  "NEXT_STEP",
] as const;
export type ReportBlockType = (typeof REPORT_BLOCK_TYPES)[number];

export const MISSING_DOCUMENT_REQUEST_ID_PATTERN = /^mdr:[a-z0-9][a-z0-9_.:-]{1,95}$/;

export type MissingDocumentRequestMetadata = {
  readonly requestId: string;
  readonly targetKey: string;
  readonly gapClaimIds: string[];
  readonly supportingClaimIds: string[];
  readonly refs: EvidenceRef[];
  readonly blockedAnalysis?: string;
};

export type ReportBlock = {
  type: ReportBlockType;
  text: string;
  claimRefs: string[];
  missingDocumentRequest?: MissingDocumentRequestMetadata;
};
export type ReportSection = { id: string; heading: string; blocks: ReportBlock[] };

export type ScenarioParameter = {
  name: string;
  label: string;
  value: string;
  unit: string | null;
  basis: "DOCUMENTED" | "ASSUMPTION";
  claimRef: string | null;
};
export type ScenarioResultDefinition = { id: string; label: string; unit: string | null; formula: FormulaNode };
export type ScenarioDefinition = {
  id: string;
  title: string;
  question: string;
  rationale: string;
  claimRefs: string[];
  parameters: ScenarioParameter[];
  results: ScenarioResultDefinition[];
};

export type ViewComponentProposal = { component: string; props: Record<string, unknown> };

export type WriterReport = {
  schema: typeof WRITER_REPORT_SCHEMA;
  audience: ReportAudience;
  title: string;
  summary: ReportBlock[];
  sections: ReportSection[];
  scenarios: ScenarioDefinition[];
  view: ViewComponentProposal[];
};

export const SCENARIO_RESULT_STATUSES = ["CALCULATED", "NONCALCULABLE"] as const;
export type ScenarioResultStatus = (typeof SCENARIO_RESULT_STATUSES)[number];

export type ScenarioResult = {
  id: string;
  scenarioId: string;
  label: string;
  unit: string | null;
  status: ScenarioResultStatus;
  value: string | null;
  reason: "DIVISION_BY_ZERO" | "UNRESOLVED_INPUT" | "OUT_OF_RANGE" | null;
  usesAssumptions: boolean;
};

export type ScenarioAnalysis = {
  schema: typeof SCENARIO_ANALYSIS_SCHEMA;
  scenarios: (Omit<ScenarioDefinition, "results"> & { results: (ScenarioResult & { formula: FormulaNode })[] })[];
};

export const WRITER_LIMITS = {
  title: 160,
  heading: 160,
  blockText: 2000,
  sections: 12,
  blocksPerSection: 20,
  summaryBlocks: 6,
  claimRefsPerBlock: 24,
  scenarios: 5,
  parameters: 8,
  results: 6,
  viewComponents: 30,
} as const;

/** `{{calc:P3.C1}}` binds a VERIFIED Study calculation; `{{result:S1.R1}}` binds a scenario result. */
export const BINDING_TOKEN = /\{\{(calc|result):([A-Za-z0-9.]{1,32})\}\}/g;

/** Canonical Study claim IDs (`DF1`, `P1`, `P1.F0`, `P2.C0`, `P1.A0`, `P1.U0`, `P1.K0`, `P1.D0`, `P3.L0`). */
export const CLAIM_ID_TOKEN = /\b(?:DF[1-9][0-9]{0,3}|P[1-9][0-9]{0,2}(?:\.[FCAUKDL][0-9]{1,3})?)\b(?![0-9]|\.[0-9])/g;

export const NUMERIC_TOKEN_CATEGORIES = [
  "quantity",
  "decimal",
  "percent",
  "date",
  "list_marker",
  "page_ref",
  "identifier",
] as const;
export type NumericTokenCategory = (typeof NUMERIC_TOKEN_CATEGORIES)[number];

export type NumericToken = {
  readonly normalized: string;
  readonly position: number;
  readonly category: NumericTokenCategory;
};

export const SECTION_ID_PATTERN = /^s[1-9][0-9]?$/;
export const SCENARIO_ID_PATTERN = /^S[1-9]$/;
export const RESULT_ID_PATTERN = /^R[1-9]$/;
export const PARAM_NAME_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;

export class WriterRejection extends Error {
  constructor(
    readonly diagnosticReason: string,
    message: string,
    readonly diagnosticField?: string,
    readonly ungroundedValue?: string,
  ) {
    super(message);
  }
}

function reject(
  diagnosticReason: string,
  message: string,
  diagnosticField = diagnosticFieldFromMessage(message),
  ungroundedValue?: string,
): never {
  throw new WriterRejection(diagnosticReason, message, diagnosticField, ungroundedValue);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("writer_output_shape", `${path} must be an object.`);
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    reject("writer_output_shape", `${path} must be a list of ${min}–${max} items.`);
  }
  return value;
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    reject("writer_output_shape", `${path} must be text up to ${max} characters.`);
  }
  return value;
}

function optionalText(value: unknown, path: string, max: number): string | null {
  return value === null || value === undefined ? null : text(value, path, max);
}

const MONTH_BEFORE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,?\s*$/i;
const MONTH_AFTER =
  /^\s*,?\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

/** Strips binding tokens (`{{calc:…}}`, `{{result:…}}`) and canonical Study claim IDs (`P1`, `P1.F0`, `P2.C0`). */
export function stripReferenceTokens(value: string): string {
  return value.replace(BINDING_TOKEN, " ").replace(CLAIM_ID_TOKEN, " ");
}

function isFormattingListMarker(cleaned: string, matchIndex: number, raw: string, plain: string): boolean {
  if (plain.includes(".") || !/^[1-9]\d?$/.test(plain)) return false;
  const before = cleaned.slice(0, matchIndex);
  const after = cleaned.slice(matchIndex + raw.length);
  const linePrefix = before.slice(Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r")) + 1);
  if (!/^\s*(?:[-*•]\s+)?/.test(linePrefix)) return false;
  const trimmedPrefix = linePrefix.replace(/^\s*(?:[-*•]\s+)?/, "");
  if (trimmedPrefix === "") {
    return /^[.)](?:\s|$)/.test(after);
  }
  if (trimmedPrefix === "(") {
    return /^\)(?:\s|$)/.test(after);
  }
  if (/^step\s+$/i.test(trimmedPrefix)) {
    return /^(?:[:.)](?:\s|$)|\s+[—–-](?:\s|$))/i.test(after);
  }
  return false;
}

function classifyNumericToken(cleaned: string, matchIndex: number, raw: string, plain: string): NumericTokenCategory {
  const before = cleaned.slice(0, matchIndex);
  const after = cleaned.slice(matchIndex + raw.length);
  if (/\b(?:pages?|pp?\.?)\s*$/i.test(before)) return "page_ref";
  if (
    /[A-Za-z_#§]$/.test(before) ||
    /\b(?:section|sec|goal|item|part|table|figure|fig|doc|document|question|objective)\s*#?\s*$/i.test(before)
  ) {
    return "identifier";
  }
  if (isFormattingListMarker(cleaned, matchIndex, raw, plain)) {
    return "list_marker";
  }
  if (/^\s*(?:%|percent\b|percentage\b)/i.test(after)) return "percent";
  if (
    MONTH_BEFORE.test(before) ||
    MONTH_AFTER.test(after) ||
    /\b\d{1,4}[/-]$/.test(before) ||
    /^[/-]\d{1,4}\b/.test(after) ||
    (/^(?:19|20)\d{2}$/.test(plain) && !/^\s*(?:minutes?|hours?|words?|days?|weeks?|months?|years?|items?|pages?)\b/i.test(after))
  ) {
    return "date";
  }
  if (plain.includes(".")) return "decimal";
  return "quantity";
}

/**
 * Extracts normalized numeric tokens from prose after stripping binding tokens and canonical Study
 * claim IDs (`P1`, `P1.F0`, `P2.C0`, …), recording each token's 0-based position and safe category.
 */
export function numericTokensIn(value: string): NumericToken[] {
  const cleaned = stripReferenceTokens(value);
  const tokens: NumericToken[] = [];
  for (const match of cleaned.matchAll(/\d(?:[\d,]*\d)?(?:\.\d+)?/g)) {
    const raw = match[0];
    const matchIndex = match.index ?? 0;
    const [whole, fraction] = raw.split(".");
    const parts = /^\d{1,3}(,\d{3})+$/.test(whole) ? [whole.replace(/,/g, "")] : whole.split(",");
    parts.forEach((part, index) => {
      const plain = index === parts.length - 1 && fraction !== undefined ? `${part}.${fraction}` : part;
      const parsed = decimalFromPlain(plain);
      if (parsed) {
        tokens.push({
          normalized: formatDecimal(parsed),
          position: tokens.length,
          category: classifyNumericToken(cleaned, matchIndex, raw, plain),
        });
      }
    });
  }
  return tokens;
}

/** Numbers in prose, normalized: "1,234.50" → "1234.5", "03" → "3"; "4,5" is two numbers. Claim IDs and formatting list markers are ignored. */
export function numbersIn(value: string): string[] {
  return numericTokensIn(value)
    .filter((token) => token.category !== "list_marker")
    .map((token) => token.normalized);
}

/** Strict claim-level numeric grounding set for the specific claims cited in `refs`. */
export function groundingNumbersForClaims(
  claims: ReadonlyMap<string, StudyClaim>,
  refs: readonly string[],
  historicalByClaimId?: ReadonlyMap<string, CanonicalFindingTemporalClassification>,
): Set<string> {
  const numbers = new Set<string>();
  for (const ref of refs) {
    const claim = claims.get(ref);
    if (!claim) continue;
    for (const source of [claim.text, ...(claim.criterion ? [claim.criterion] : []), ...claim.quotes]) {
      for (const n of numbersIn(source)) numbers.add(n);
    }
    if (claim.numericStatus === "VERIFIED" && claim.computedValue) numbers.add(claim.computedValue);
    const historical = historicalByClaimId?.get(ref);
    if (historical?.asOfDate) {
      for (const n of numbersIn(historical.asOfDate)) numbers.add(n);
    }
  }
  return numbers;
}

export function firstUngroundedNumericToken(value: string, allowed: ReadonlySet<string>): NumericToken | null {
  for (const token of numericTokensIn(value)) {
    if (token.category === "list_marker") continue;
    if (!allowed.has(token.normalized)) return token;
  }
  return null;
}

/** Safe `failure-diagnostic@1` field encoding token index and category without logging values or prose. */
export function numericDiagnosticField(path: string, token: Pick<NumericToken, "position" | "category">): string {
  return `${path}@num[${token.position}]:${token.category}`;
}

export type WriterValidationContext = {
  readonly audience: ReportAudience;
  readonly claims: readonly StudyClaim[];
  readonly canonicalFindings?: CanonicalFindingResolution | null;
  readonly asOf?: string | Date | null;
};

export type WriterTemporalValidationContext = {
  readonly historicalByClaimId?: ReadonlyMap<string, CanonicalFindingTemporalClassification>;
  readonly activeClaimIds?: ReadonlySet<string>;
};

export const DOCUMENTED_KINDS: ReadonlySet<StudyClaim["kind"]> = new Set(["ANSWER", "FACT", "CALCULATION", "CONFLICT"]);
export const INTERPRETATION_KINDS: ReadonlySet<StudyClaim["kind"]> = new Set([
  "ANSWER",
  "FACT",
  "ASSESSMENT",
  "DETERMINATION",
  "CALCULATION",
  "CONFLICT",
]);
export const UNCERTAINTY_KINDS: ReadonlySet<StudyClaim["kind"]> = new Set([
  "UNCERTAINTY",
  "CONFLICT",
  "LIMITATION",
  "ANSWER",
  "CALCULATION",
  "DETERMINATION",
  "FACT",
]);

function stripTokens(value: string): string {
  return stripReferenceTokens(value);
}

const UNCERTAINTY_CUE =
  /\b(uncertain|uncertainty|unverified|unconfirmed|unknown|missing|not\s+reported|not\s+provided|not\s+available|unavailable|not\s+included|not\s+separately\s+attached|not\s+attached|not\s+present|not\s+collected|not\s+stated|not\s+established|without\s+establishing|do\s+not\s+state|does\s+not\s+state|did\s+not\s+state|absent|did\s+not\s+include|didn't\s+include|did\s+not\s+report|didn't\s+report|no\s+(?:[\w-]+\s+){0,6}(?:score|scores|data|record|records|report|reports|measurement|measurements|log|logs|evidence|probe|probes|evaluation|iep|plan|result|results)|only\s+one|not\s+yet|gap|conflict|conflicting|differ|different|contradict|inconsistent|discrepancy|mismatch|could\s+not|cannot|can't|lacks?|incomplete|limited|limitation|unanswered|unresolved)\b/i;

const STOPWORDS = new Set([
  "that", "this", "with", "from", "were", "have", "been", "their", "there", "what", "when", "where",
  "which", "while", "would", "could", "should", "about", "after", "before", "between", "into", "over",
  "under", "only", "also", "more", "most", "some", "such", "than", "then", "them", "they", "these",
  "those", "does", "did", "not", "none", "report", "reported", "document", "documents", "record", "records",
]);

function contentTokens(value: string): Set<string> {
  const tokens = new Set<string>(numbersIn(value));
  for (const word of value.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    if (!STOPWORDS.has(word)) tokens.add(word);
  }
  return tokens;
}

export function hasClaimTokenOverlap(value: string, claim: StudyClaim): boolean {
  const cleaned = stripTokens(value).trim();
  if (!cleaned) return false;
  const claimTokens = contentTokens([claim.text, ...claim.quotes].join(" "));
  if (claimTokens.size === 0) return true;
  for (const token of contentTokens(cleaned)) {
    if (claimTokens.has(token)) return true;
  }
  return false;
}

/**
 * Whether a structured component entry's rendered prose visibly presents an uncertainty, conflict
 * or missing-evidence claim rather than merely attaching its claim ID to unrelated content.
 */
export function visiblyPresentsUncertainty(value: string, claim: StudyClaim): boolean {
  const cleaned = stripTokens(value).trim();
  if (!cleaned || !UNCERTAINTY_CUE.test(cleaned)) return false;
  return hasClaimTokenOverlap(cleaned, claim);
}

/**
 * Checks whether prose substantially covers a `PARTIALLY_ANSWERED` question's `LIMITATION` claim
 * (at least 50% of the limitation's content tokens appear in the prose, alongside an uncertainty cue).
 */
export function visiblyCoversLimitation(value: string, claim: StudyClaim): boolean {
  const cleaned = stripTokens(value).trim();
  if (!cleaned || !UNCERTAINTY_CUE.test(cleaned)) return false;
  const claimTokens = contentTokens([claim.text, ...claim.quotes].join(" "));
  if (claimTokens.size === 0) return true;
  const proseTokens = contentTokens(cleaned);
  let matched = 0;
  for (const token of claimTokens) {
    if (proseTokens.has(token)) matched += 1;
  }
  return matched / claimTokens.size >= 0.5;
}

export function collectVisibleStructuredUncertainties(
  component: string,
  props: Record<string, unknown>,
  claims: ReadonlyMap<string, StudyClaim>,
  surfaced: Set<string>,
): void {
  const markVisible = (prose: string, rawRefs: unknown, allowConflictCompare = false) => {
    if (!Array.isArray(rawRefs)) return;
    for (const ref of rawRefs) {
      if (typeof ref !== "string") continue;
      const claim = claims.get(ref);
      if (!claim) continue;
      if (visiblyPresentsUncertainty(prose, claim) || (allowConflictCompare && claim.kind === "CONFLICT" && hasClaimTokenOverlap(prose, claim))) {
        surfaced.add(ref);
      }
    }
  };
  switch (component) {
    case "IssueList":
      if (Array.isArray(props.issues)) {
        for (const raw of props.issues) {
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            const issue = raw as Record<string, unknown>;
            if (typeof issue.text === "string") markVisible(issue.text, issue.claimRefs);
          }
        }
      }
      break;
    case "EvidencePanel":
    case "KeyFindings":
      if (Array.isArray(props.claimIds)) {
        for (const id of props.claimIds) {
          if (typeof id !== "string") continue;
          const claim = claims.get(id);
          if (!claim || claim.refs.length === 0 || claim.kind === "UNCERTAINTY" || claim.kind === "LIMITATION") continue;
          if (claim.kind === "CONFLICT" || visiblyPresentsUncertainty(claim.text, claim)) {
            surfaced.add(id);
          }
        }
      }
      break;
    case "Comparison":
      if (Array.isArray(props.items)) {
        for (const raw of props.items) {
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            const item = raw as Record<string, unknown>;
            const left = typeof item.left === "string" ? item.left.trim() : "";
            const right = typeof item.right === "string" ? item.right.trim() : "";
            const label = typeof item.label === "string" ? item.label.trim() : "";
            markVisible(`${label} ${left} ${right}`, item.claimRefs, left !== "" && right !== "" && left !== right);
          }
        }
      }
      break;
    case "RecordTable":
      if (Array.isArray(props.rows)) {
        for (const raw of props.rows) {
          if (raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray((raw as { cells?: unknown }).cells)) {
            const row = raw as { cells: unknown[]; claimRefs?: unknown };
            const prose = row.cells.filter((c): c is string => typeof c === "string").join(" ");
            markVisible(prose, row.claimRefs);
          }
        }
      }
      break;
  }
}

export function mustSurfaceClaims(claims: readonly StudyClaim[]): StudyClaim[] {
  const partiallyAnsweredQuestions = new Set<string>(
    claims
      .filter((claim) => claim.kind === "ANSWER" && claim.answerStatus === "PARTIALLY_ANSWERED" && claim.planQuestionId !== null)
      .map((claim) => claim.planQuestionId as string),
  );
  return claims.filter(
    (claim) =>
      claim.kind === "CONFLICT" ||
      claim.kind === "UNCERTAINTY" ||
      (claim.kind === "LIMITATION" && claim.planQuestionId !== null && partiallyAnsweredQuestions.has(claim.planQuestionId)) ||
      (claim.kind === "ANSWER" && (claim.answerStatus === "MISSING_EVIDENCE" || claim.answerStatus === "CONFLICTING")),
  );
}

export function checkGroundedNumber(
  value: string,
  refs: readonly string[],
  claims: ReadonlyMap<string, StudyClaim>,
  path: string,
  historicalByClaimId?: ReadonlyMap<string, CanonicalFindingTemporalClassification>,
): void {
  const ungrounded = firstUngroundedNumericToken(
    value,
    groundingNumbersForClaims(claims, refs, historicalByClaimId),
  );
  if (ungrounded) {
    reject(
      "writer_number_ungrounded",
      `${path} states an unsupported number (${ungrounded.normalized}) that its cited claims do not contain.`,
      numericDiagnosticField(path, ungrounded),
      ungrounded.normalized,
    );
  }
}

const REPLACEMENT_INFERRED_RE =
  /\b(?:(?:has\s+been|was|is)\s+(?:replaced|superseded)\s+by\s+(?:a\s+|an\s+|the\s+)?(?:new|newer|subsequent|replacement|current|later|updated|20\d{2})|(?:a|an|the)\s+(?:replacement|newer|subsequent)\s+(?:iep|plan|program|policy|agreement|contract|document|record)\s+(?:exists?|is\s+in\s+(?:place|effect)|took\s+effect|governs?|replaced\s+it))\b/i;

const NO_REPLACEMENT_INFERRED_RE =
  /\b(?:no\s+(?:replacement|newer|subsequent|updated)\s+(?:iep|plan|program|policy|agreement|contract|document|record)\s+(?:exists?|is\s+in\s+(?:place|effect)|was\s+(?:created|adopted|provided)|has\s+been\s+(?:created|adopted|provided))|expired\s+with(?:out)?\s+(?:a|no)\s+replacement|remains?\s+unreplaced|never\s+(?:been\s+)?replaced|without\s+a\s+replacement\s+(?:iep|plan|program|policy|agreement|contract|document))\b/i;

const TEMPORAL_UNCERTAINTY_QUALIFIER_RE =
  /\b(?:whether|unknown|unclear|unconfirmed|not\s+(?:establish|established|confirm|confirmed|show|shown|state|stated|indicate|indicated)|does\s+not\s+(?:establish|confirm|show|state|indicate)|cannot\s+(?:confirm|determine|establish))\b/i;

const CURRENT_STATUS_OVERCLAIM_RE =
  /\b(?:is\s+the\s+current|under\s+the\s+current|in\s+the\s+current|(?:the|her|his|their|[a-z]+'s)\s+current\s+(?:iep|plan|program|policy|agreement|contract|service\s+plan|effective\s+period)|currently\s+(?:in\s+effect|effective|active|governing|operative)|remains?\s+(?:currently\s+)?(?:in\s+effect|effective|active|current|governing|operative)|still\s+(?:in\s+effect|effective|active|current|governing|operative))\b/i;

const NEGATED_CURRENT_QUALIFIER_RE =
  /\b(?:not\s+(?:the\s+current|currently|in\s+effect|effective|active|confirmed)|no\s+longer|whether|unknown|unclear|unconfirmed|does\s+not\s+(?:establish|confirm|show)|cannot\s+(?:confirm|determine)|rather\s+than\s+(?:the\s+)?current|instead\s+of\s+(?:the\s+)?current)\b/i;

const PRESENT_EFFECTIVE_PERIOD_RE = /\beffective\s+period\s+is\b/i;

const HISTORICAL_FRAMING_RE =
  /\b(?:ended|historical|prior|past|former|previous|expired|was|covered|documented|before|as\s+of|unknown|unclear|unconfirmed|whether)\b/i;

/**
 * Enforces temporal editorial safety on blocks and A2UI items citing `HISTORICAL_AS_OF_REPORT_DATE`
 * findings (V4-004H Gate 2): rejects calling a historical period/document currently effective or
 * inferring that a replacement does or does not exist.
 */
export function checkTemporalSafety(
  value: string,
  refs: readonly string[],
  temporalContext: WriterTemporalValidationContext | undefined,
  path: string,
): void {
  const historicalByClaimId = temporalContext?.historicalByClaimId;
  if (!historicalByClaimId || historicalByClaimId.size === 0) return;
  const citedHistorical = refs
    .map((ref) => historicalByClaimId.get(ref))
    .filter((item): item is CanonicalFindingTemporalClassification => item !== undefined);
  if (citedHistorical.length === 0) return;

  const hasActiveClaim = refs.some((ref) => temporalContext?.activeClaimIds?.has(ref) === true);

  if (
    (REPLACEMENT_INFERRED_RE.test(value) || NO_REPLACEMENT_INFERRED_RE.test(value)) &&
    !TEMPORAL_UNCERTAINTY_QUALIFIER_RE.test(value)
  ) {
    reject(
      "writer_temporal_status_invalid",
      `${path} infers that a replacement exists or does not exist for a historical period (${citedHistorical[0]!.startDate ?? "start"} to ${citedHistorical[0]!.endDate ?? "end"}) whose currentness is unresolved.`,
      path,
    );
  }

  if (
    !hasActiveClaim &&
    CURRENT_STATUS_OVERCLAIM_RE.test(value) &&
    !NEGATED_CURRENT_QUALIFIER_RE.test(value)
  ) {
    reject(
      "writer_temporal_status_invalid",
      `${path} describes a historical period (${citedHistorical[0]!.startDate ?? "start"} to ${citedHistorical[0]!.endDate ?? "end"}, ended before ${citedHistorical[0]!.asOfDate ?? "the report date"}) as currently in effect.`,
      path,
    );
  }

  if (
    !hasActiveClaim &&
    PRESENT_EFFECTIVE_PERIOD_RE.test(value) &&
    !HISTORICAL_FRAMING_RE.test(value)
  ) {
    reject(
      "writer_temporal_status_invalid",
      `${path} states a historical effective period (${citedHistorical[0]!.startDate ?? "start"} to ${citedHistorical[0]!.endDate ?? "end"}) in the present tense without noting that the period ended before ${citedHistorical[0]!.asOfDate ?? "the report date"}.`,
      path,
    );
  }
}

const LEGAL_COMPLIANCE_CONCLUSION_RE =
  /\b(?:violates?|violated|violation\s+of|in\s+violation\s+of|non-?compliant|non-?compliance|out\s+of\s+compliance|denies?\s+fape|denied\s+fape|denial\s+of\s+fape|breach(?:ed|es)?\s+(?:of\s+)?(?:the\s+)?(?:iep|fape|idea|statutory|legal|contract)|unlawful(?:ly)?|illegal(?:ly)?|legally\s+(?:deficient|invalid|non-?compliant|insufficient)|fails?\s+to\s+comply)\b/i;

const ADEQUACY_VERDICT_RE =
  /\b(?:(?:progress|growth|gain|fluency|accuracy|instruction|service(?:s|\s+delivery)?|program|plan|iep)\s+(?:is|was|are|were|has\s+been|remains?)\s+(?:not\s+)?(?:adequate|inadequate|sufficient|insufficient|appropriate|inappropriate|satisfactory|unsatisfactory)|(?:did\s+not|failed\s+to)\s+(?:meet|achieve|master|reach)(?:ed)?\s+(?:the\s+|her\s+|his\s+|their\s+)?(?:annual\s+)?(?:reading\s+)?(?:fluency\s+)?(?:goal|target|mastery|criterion|criteria)|(?:annual\s+|reading\s+|fluency\s+)?(?:goal|target)\s+(?:was|is|has\s+been)\s+(?:not\s+met|unmet|failed))\b/i;

const ABSENT_RECORD_NON_OCCURRENCE_RE =
  /\b(?:(?:because|since|as)\s+[^.?!]{0,120}\b(?:missing|absent|not\s+(?:included|attached|provided|in\s+the\s+record|in\s+this\s+(?:corpus|file|hive))|no\s+(?:progress|quarterly|probe|evaluation|service)\s+(?:reports?|records?|probes?|data|logs?))[^.?!]{0,120}\b(?:never|not|no)\s+(?:occurred|happened|conducted|administered|measured|monitored|delivered|provided|issued|completed|took\s+place)|(?:probes?|progress\s+(?:monitoring|reports?|probes?)|assessments?|evaluations?|services?|instruction|measurements?)\s+(?:were|was)\s+never\s+(?:conducted|administered|measured|monitored|delivered|provided|issued|completed|collected|performed)|(?:the\s+school|the\s+district|teachers?|staff)\s+never\s+(?:conducted|administered|measured|monitored|delivered|provided|issued|collected)\s+(?:any\s+|the\s+|quarterly\s+)?(?:probes?|progress|services?|instruction|evaluations?|assessments?)|proves?\s+that\s+[^.?!]{0,80}\b(?:never|did\s+not|was\s+not|were\s+not)\b)\b/i;

const NEUTRAL_RESERVATION_OR_QUESTION_RE =
  /\b(?:whether|if\s+the|who\s+decides|decided\s+by|reserved\s+(?:for|to)|is\s+a\s+determination\s+for|cannot\s+(?:determine|confirm|establish|assess|evaluate|verify)|could\s+not\s+(?:determine|confirm|establish|assess|evaluate)|is\s+not\s+(?:established|confirmed|determined|settled)|blocks?\s+(?:evaluating|assessing|determining|verifying|confirming)|needed\s+to\s+(?:evaluate|assess|determine|verify|confirm))\b/i;

const ONGOING_PROGRESS_DESCRIPTIVE_RE = /\b(?:not\s+yet|so\s+far|toward\s+the\s+goal|moving\s+toward)\b/i;

function normalizeForSourceMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSentenceGroundedInCitedSources(sentence: string, refs: readonly string[], claims: ReadonlyMap<string, StudyClaim>): boolean {
  const normSentence = normalizeForSourceMatch(sentence);
  if (!normSentence) return false;
  const sources: string[] = [];
  for (const ref of refs) {
    const claim = claims.get(ref);
    if (!claim) continue;
    sources.push(claim.text, ...claim.quotes);
    if (claim.documentFinding?.valueAsWritten) {
      sources.push(claim.documentFinding.valueAsWritten);
    }
  }
  const combinedSource = normalizeForSourceMatch(sources.join(" "));
  if (!combinedSource) return false;
  if (combinedSource.includes(normSentence)) return true;

  for (const matchRe of [LEGAL_COMPLIANCE_CONCLUSION_RE, ADEQUACY_VERDICT_RE, ABSENT_RECORD_NON_OCCURRENCE_RE]) {
    const m = matchRe.exec(sentence);
    if (m) {
      const phrase = normalizeForSourceMatch(m[0]);
      if (phrase && combinedSource.includes(phrase)) return true;
    }
  }
  return false;
}

/**
 * Enforces editorial conclusion safety on model-authored prose (V4-004K.5B):
 * rejects unsupported legal/compliance conclusions, adequacy verdicts, and claims that an absent
 * document proves an activity never occurred, while preserving legitimate source quotes,
 * documented professional determinations (`whether ... is decided by ...`), and neutral questions.
 */
export function checkUnsupportedConclusions(
  value: string,
  refs: readonly string[],
  claims: ReadonlyMap<string, StudyClaim>,
  path: string,
): void {
  const sentences = value
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sentence of sentences) {
    const isNeutralQuestion =
      sentence.endsWith("?") &&
      !ABSENT_RECORD_NON_OCCURRENCE_RE.test(sentence) &&
      !LEGAL_COMPLIANCE_CONCLUSION_RE.test(sentence);
    if (isNeutralQuestion) continue;

    if (isSentenceGroundedInCitedSources(sentence, refs, claims)) continue;

    if (ABSENT_RECORD_NON_OCCURRENCE_RE.test(sentence)) {
      reject(
        "writer_unsupported_conclusion",
        `${path} claims that a missing or absent record proves an activity never occurred; state only that the record is not in the file and what analysis it blocks.`,
        path,
      );
    }

    if (LEGAL_COMPLIANCE_CONCLUSION_RE.test(sentence) && !NEUTRAL_RESERVATION_OR_QUESTION_RE.test(sentence)) {
      reject(
        "writer_unsupported_conclusion",
        `${path} states an unsupported legal or compliance conclusion not established in the cited source records.`,
        path,
      );
    }

    if (
      ADEQUACY_VERDICT_RE.test(sentence) &&
      !NEUTRAL_RESERVATION_OR_QUESTION_RE.test(sentence) &&
      !ONGOING_PROGRESS_DESCRIPTIVE_RE.test(sentence)
    ) {
      reject(
        "writer_unsupported_conclusion",
        `${path} states an unsupported adequacy or goal-achievement verdict instead of preserving the reserved determination or source facts.`,
        path,
      );
    }
  }
}

export type ValidatedReportBlock = {
  readonly block: ReportBlock;
  readonly cited: string[];
  readonly surfaced: string[];
  readonly resultTokens: { scenarioId: string; resultId: string; path: string }[];
};

export function validateReportBlock(
  value: unknown,
  path: string,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext?: WriterTemporalValidationContext,
): ValidatedReportBlock {
  const item = record(value, path);
  const type = item.type;
  if (!(REPORT_BLOCK_TYPES as readonly string[]).includes(type as string)) reject("writer_output_shape", `${path}.type is not allowed.`);
  const blockText = text(item.text, `${path}.text`, WRITER_LIMITS.blockText);
  const claimRefs = list(item.claimRefs, `${path}.claimRefs`, WRITER_LIMITS.claimRefsPerBlock).map((ref, i) => {
    if (typeof ref !== "string" || !claims.has(ref)) reject("writer_claim_unknown", `${path}.claimRefs[${i}] is not a Study claim.`);
    return ref;
  });
  const kinds = claimRefs.map((ref) => claims.get(ref) as StudyClaim);
  const blockType = type as ReportBlockType;
  if (blockType === "DOCUMENTED" || blockType === "INTERPRETATION" || blockType === "UNCERTAINTY") {
    if (claimRefs.length === 0) reject("writer_claim_missing", `${path} needs at least one Study claim.`);
  }
  const allowedKinds =
    blockType === "DOCUMENTED" ? DOCUMENTED_KINDS : blockType === "INTERPRETATION" ? INTERPRETATION_KINDS : UNCERTAINTY_KINDS;
  if (blockType === "DOCUMENTED" || blockType === "INTERPRETATION" || blockType === "UNCERTAINTY") {
    for (const claim of kinds) {
      if (!allowedKinds.has(claim.kind)) reject("writer_claim_kind", `${path} cites ${claim.id}, which cannot support this kind of text.`);
    }
  }
  if (blockType !== "UNCERTAINTY" && kinds.some((claim) => claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED")) {
    reject("writer_unverified_number", `${path} presents an unverified calculation outside an uncertainty.`);
  }
  const cited: string[] = [];
  const surfaced: string[] = [];
  const resultTokens: { scenarioId: string; resultId: string; path: string }[] = [];
  for (const match of blockText.matchAll(BINDING_TOKEN)) {
    const [, kind, id] = match;
    if (kind === "calc") {
      const claim = claims.get(id);
      if (!claim || claim.kind !== "CALCULATION") reject("writer_binding_invalid", `${path} binds an unknown calculation.`);
      if (claim.numericStatus !== "VERIFIED") {
        reject("writer_unverified_number", `${path} binds a calculation that was not verified.`);
      }
      cited.push(id);
    } else {
      const [scenarioId, resultId] = id.split(".");
      if (!scenarioId || !resultId) reject("writer_binding_invalid", `${path} binds an unknown scenario result.`);
      resultTokens.push({ scenarioId, resultId, path });
    }
  }
  if (blockType !== "GENERAL_INFORMATION") {
    checkGroundedNumber(blockText, claimRefs, claims, path, temporalContext?.historicalByClaimId);
    checkTemporalSafety(blockText, claimRefs, temporalContext, path);
    checkUnsupportedConclusions(blockText, claimRefs, claims, path);
  } else {
    checkUnsupportedConclusions(blockText, [], claims, path);
  }
  let missingDocumentRequest: MissingDocumentRequestMetadata | undefined;
  if (item.missingDocumentRequest !== undefined && item.missingDocumentRequest !== null) {
    if (blockType !== "QUESTION") {
      reject("writer_output_shape", `${path}.missingDocumentRequest is only allowed on QUESTION blocks.`, `${path}.missingDocumentRequest`);
    }
    const reqObj = record(item.missingDocumentRequest, `${path}.missingDocumentRequest`);
    const requestId = text(reqObj.requestId, `${path}.missingDocumentRequest.requestId`, 96);
    if (!MISSING_DOCUMENT_REQUEST_ID_PATTERN.test(requestId)) {
      reject("writer_output_shape", `${path}.missingDocumentRequest.requestId must match mdr:<key>.`, `${path}.missingDocumentRequest.requestId`);
    }
    const targetKey = text(reqObj.targetKey, `${path}.missingDocumentRequest.targetKey`, 64);
    const gapClaimIds = list(reqObj.gapClaimIds, `${path}.missingDocumentRequest.gapClaimIds`, WRITER_LIMITS.claimRefsPerBlock, 1).map(
      (ref, i) => {
        if (typeof ref !== "string" || !claims.has(ref)) {
          reject("writer_claim_unknown", `${path}.missingDocumentRequest.gapClaimIds[${i}] is not a Study claim.`);
        }
        return ref;
      },
    );
    const supportingClaimIds = list(
      reqObj.supportingClaimIds,
      `${path}.missingDocumentRequest.supportingClaimIds`,
      WRITER_LIMITS.claimRefsPerBlock,
      1,
    ).map((ref, i) => {
      if (typeof ref !== "string" || !claims.has(ref)) {
        reject("writer_claim_unknown", `${path}.missingDocumentRequest.supportingClaimIds[${i}] is not a Study claim.`);
      }
      return ref;
    });
    const refs = list(reqObj.refs, `${path}.missingDocumentRequest.refs`, 48, 1).map((rawRef, i) => {
      const rObj = record(rawRef, `${path}.missingDocumentRequest.refs[${i}]`);
      const sourceDocumentId = text(rObj.sourceDocumentId, `${path}.missingDocumentRequest.refs[${i}].sourceDocumentId`, 64);
      const pageNumber = rObj.pageNumber;
      if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1) {
        reject("writer_output_shape", `${path}.missingDocumentRequest.refs[${i}].pageNumber must be a positive integer.`);
      }
      return { sourceDocumentId, pageNumber };
    });
    const blockedAnalysis =
      reqObj.blockedAnalysis !== undefined && reqObj.blockedAnalysis !== null
        ? text(reqObj.blockedAnalysis, `${path}.missingDocumentRequest.blockedAnalysis`, 600)
        : undefined;
    missingDocumentRequest = {
      requestId,
      targetKey,
      gapClaimIds,
      supportingClaimIds,
      refs,
      ...(blockedAnalysis !== undefined ? { blockedAnalysis } : {}),
    };
  }
  const partiallyAnsweredQuestions = new Set<string>(
    [...claims.values()]
      .filter((c) => c.kind === "ANSWER" && c.answerStatus === "PARTIALLY_ANSWERED" && c.planQuestionId !== null)
      .map((c) => c.planQuestionId as string),
  );
  const partialLimitations = [...claims.values()].filter(
    (c) => c.kind === "LIMITATION" && c.planQuestionId !== null && partiallyAnsweredQuestions.has(c.planQuestionId),
  );
  for (const ref of claimRefs) {
    cited.push(ref);
    const claim = claims.get(ref);
    if (!claim) continue;
    const isPartiallyAnsweredLimitation =
      claim.kind === "LIMITATION" && claim.planQuestionId !== null && partiallyAnsweredQuestions.has(claim.planQuestionId);
    if (blockType === "UNCERTAINTY") {
      if (!isPartiallyAnsweredLimitation || visiblyPresentsUncertainty(blockText, claim)) {
        surfaced.push(ref);
      }
    } else if (
      (blockType === "DOCUMENTED" || blockType === "INTERPRETATION") &&
      (claim.kind === "CONFLICT" || visiblyPresentsUncertainty(blockText, claim))
    ) {
      surfaced.push(ref);
    }
  }
  if (blockType === "UNCERTAINTY") {
    const citedPartialUQuestions = new Set<string>(
      claimRefs
        .map((r) => claims.get(r))
        .filter((c): c is StudyClaim => c?.kind === "UNCERTAINTY" && c.planQuestionId !== null && partiallyAnsweredQuestions.has(c.planQuestionId))
        .map((c) => c.planQuestionId as string),
    );
    for (const lim of partialLimitations) {
      if (surfaced.includes(lim.id)) continue;
      if (visiblyCoversLimitation(blockText, lim)) {
        surfaced.push(lim.id);
      } else if (
        lim.planQuestionId &&
        citedPartialUQuestions.has(lim.planQuestionId) &&
        !/\b(?:evaluation|report|reports|log|logs|iep|attach|attached)\b/i.test(lim.text) &&
        hasClaimTokenOverlap(blockText, lim)
      ) {
        surfaced.push(lim.id);
      }
    }
  }
  return {
    block: {
      type: blockType,
      text: blockText,
      claimRefs,
      ...(missingDocumentRequest ? { missingDocumentRequest } : {}),
    },
    cited,
    surfaced,
    resultTokens,
  };
}

export type ValidatedScenarioDefinition = {
  readonly scenario: ScenarioDefinition;
  readonly cited: string[];
};

export function validateScenarioDefinition(
  value: unknown,
  path: string,
  claims: ReadonlyMap<string, StudyClaim>,
  questionsWithFacts: ReadonlySet<string>,
  seenIds?: ReadonlySet<string>,
): ValidatedScenarioDefinition {
  const item = record(value, path);
  const id = item.id;
  if (typeof id !== "string" || !SCENARIO_ID_PATTERN.test(id) || seenIds?.has(id)) {
    reject("writer_scenario_invalid", `${path}.id must be a new S1…S9 id.`);
  }
  const cited: string[] = [];
  const claimRefs = list(item.claimRefs, `${path}.claimRefs`, WRITER_LIMITS.claimRefsPerBlock, 1).map((ref, i) => {
    if (typeof ref !== "string" || !claims.has(ref)) reject("writer_claim_unknown", `${path}.claimRefs[${i}] is not a Study claim.`);
    const claim = claims.get(ref) as StudyClaim;
    if (claim.kind === "ANSWER" && claim.planQuestionId !== null && questionsWithFacts.has(claim.planQuestionId)) {
      reject("writer_claim_kind", `${path}.claimRefs[${i}] cites broad answer ${ref} when specific facts exist.`);
    }
    cited.push(ref);
    return ref;
  });
  const names = new Set<string>();
  const parameters = list(item.parameters, `${path}.parameters`, WRITER_LIMITS.parameters).map((p, i) => {
    const pPath = `${path}.parameters[${i}]`;
    const param = record(p, pPath);
    const name = param.name;
    if (typeof name !== "string" || !PARAM_NAME_PATTERN.test(name) || names.has(name)) {
      reject("writer_scenario_invalid", `${pPath}.name is invalid.`);
    }
    names.add(name);
    const rawValue = param.value;
    if (typeof rawValue !== "string" || !decimalFromPlain(rawValue)) reject("writer_scenario_invalid", `${pPath}.value must be a plain number.`);
    const basis = param.basis;
    if (basis !== "DOCUMENTED" && basis !== "ASSUMPTION") reject("writer_scenario_invalid", `${pPath}.basis is not allowed.`);
    const claimRef = param.claimRef ?? null;
    if (basis === "DOCUMENTED") {
      const claim = typeof claimRef === "string" ? claims.get(claimRef) : undefined;
      if (!claim || (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED")) {
        reject("writer_scenario_unsupported", `${pPath} is documented but cites no verified Study claim.`);
      }
      if (claim.kind === "ANSWER" && claim.planQuestionId !== null && questionsWithFacts.has(claim.planQuestionId)) {
        reject("writer_claim_kind", `${pPath}.claimRef cites broad answer ${claim.id} when specific facts exist.`);
      }
      const formatted = formatDecimal(decimalFromPlain(rawValue) as Decimal);
      if (!groundingNumbersForClaims(claims, [claim.id]).has(formatted)) {
        const token = numericTokensIn(rawValue)[0] ?? {
          position: 0,
          category: rawValue.includes(".") ? ("decimal" as const) : ("quantity" as const),
        };
        reject(
          "writer_number_ungrounded",
          `${pPath}.value states an unsupported number (${formatted}) that does not appear in the claim it cites (${claim.id}).`,
          numericDiagnosticField(`${pPath}.value`, token),
          formatted,
        );
      }
      cited.push(claim.id);
    } else if (claimRef !== null) {
      reject("writer_scenario_invalid", `${pPath} is an assumption and cannot cite a claim.`);
    }
    return {
      name,
      label: text(param.label, `${pPath}.label`, 200),
      value: rawValue,
      unit: optionalText(param.unit, `${pPath}.unit`, 40),
      basis: basis as ScenarioParameter["basis"],
      claimRef: claimRef as string | null,
    };
  });
  const resultIds = new Set<string>();
  const results = list(item.results, `${path}.results`, WRITER_LIMITS.results, 1).map((r, i) => {
    const rPath = `${path}.results[${i}]`;
    const result = record(r, rPath);
    const resultId = result.id;
    if (typeof resultId !== "string" || !RESULT_ID_PATTERN.test(resultId) || resultIds.has(resultId)) {
      reject("writer_scenario_invalid", `${rPath}.id must be a new R1…R9 id.`);
    }
    const formula = parseFormula(result.formula);
    if (!formula.ok) reject("writer_formula_invalid", `${rPath}.formula is not an allowed formula.`);
    for (const leaf of formulaLeaves(formula.value)) {
      if ("input" in leaf) reject("writer_formula_invalid", `${rPath}.formula uses an input index.`);
      if ("param" in leaf && !names.has(leaf.param)) reject("writer_formula_invalid", `${rPath}.formula uses an unknown parameter.`);
      if ("ref" in leaf && !resultIds.has(leaf.ref)) {
        const claim = claims.get(leaf.ref);
        if (!claim || claim.kind !== "CALCULATION" || claim.numericStatus !== "VERIFIED") {
          reject("writer_unverified_number", `${rPath}.formula uses a calculation that was not verified.`);
        }
        cited.push(leaf.ref);
      }
    }
    resultIds.add(resultId);
    return {
      id: resultId,
      label: text(result.label, `${rPath}.label`, 200),
      unit: optionalText(result.unit, `${rPath}.unit`, 40),
      formula: formula.value,
    };
  });
  return {
    scenario: {
      id,
      title: text(item.title, `${path}.title`, WRITER_LIMITS.heading),
      question: text(item.question, `${path}.question`, 600),
      rationale: text(item.rationale, `${path}.rationale`, 1200),
      claimRefs,
      parameters,
      results,
    },
    cited,
  };
}

export function validateWriterReport(raw: unknown, context: WriterValidationContext): ContractValidation<WriterReport> {
  try {
    const claims = new Map(context.claims.map((claim) => [claim.id, claim]));
    const questionsWithFacts = questionsWithAtomicFacts(context.claims);
    const historicalByClaimId = buildHistoricalTemporalMap(context.claims, {
      canonicalFindings: context.canonicalFindings,
      asOf: context.asOf,
    });
    const activeClaimIds = buildActiveTemporalClaimIds(context.claims, {
      canonicalFindings: context.canonicalFindings,
      asOf: context.asOf,
    });
    const temporalContext: WriterTemporalValidationContext = {
      historicalByClaimId,
      activeClaimIds,
    };
    const root = record(raw, "output");
    if (root.schema !== WRITER_REPORT_SCHEMA) reject("writer_output_schema", "The report schema is wrong.");
    if (root.audience !== context.audience) reject("writer_audience_mismatch", "The report is for the other audience.");

    const cited = new Set<string>();
    const surfaced = new Set<string>();
    const resultTokens: { scenarioId: string; resultId: string; path: string }[] = [];

    const block = (value: unknown, path: string): ReportBlock => {
      const validated = validateReportBlock(value, path, claims, temporalContext);
      for (const ref of validated.cited) cited.add(ref);
      for (const ref of validated.surfaced) surfaced.add(ref);
      resultTokens.push(...validated.resultTokens);
      return validated.block;
    };

    const title = text(root.title, "title", WRITER_LIMITS.title);
    const summary = list(root.summary, "summary", WRITER_LIMITS.summaryBlocks, 1).map((item, i) => block(item, `summary[${i}]`));
    const sectionIds = new Set<string>();
    const sections = list(root.sections, "sections", WRITER_LIMITS.sections, 1).map((value, index) => {
      const path = `sections[${index}]`;
      const item = record(value, path);
      const id = item.id;
      if (typeof id !== "string" || !SECTION_ID_PATTERN.test(id) || sectionIds.has(id)) {
        reject("writer_output_shape", `${path}.id must be a new s1…s99 id.`);
      }
      sectionIds.add(id);
      return {
        id,
        heading: text(item.heading, `${path}.heading`, WRITER_LIMITS.heading),
        blocks: list(item.blocks, `${path}.blocks`, WRITER_LIMITS.blocksPerSection, 1).map((b, i) => block(b, `${path}.blocks[${i}]`)),
      };
    });
    const allRefs = [...cited];
    checkGroundedNumber(title, allRefs, claims, "title", historicalByClaimId);
    checkTemporalSafety(title, allRefs, temporalContext, "title");
    checkUnsupportedConclusions(title, allRefs, claims, "title");
    for (const section of sections) {
      checkGroundedNumber(section.heading, allRefs, claims, `sections.${section.id}.heading`, historicalByClaimId);
      checkTemporalSafety(section.heading, allRefs, temporalContext, `sections.${section.id}.heading`);
      checkUnsupportedConclusions(section.heading, allRefs, claims, `sections.${section.id}.heading`);
    }

    const scenarioIds = new Set<string>();
    const scenarios = list(root.scenarios ?? [], "scenarios", WRITER_LIMITS.scenarios).map((value, index) => {
      const path = `scenarios[${index}]`;
      const validated = validateScenarioDefinition(value, path, claims, questionsWithFacts, scenarioIds);
      scenarioIds.add(validated.scenario.id);
      for (const ref of validated.cited) cited.add(ref);
      return validated.scenario;
    });

    for (const token of resultTokens) {
      const scenario = scenarios.find((item) => item.id === token.scenarioId);
      if (!scenario || !scenario.results.some((result) => result.id === token.resultId)) {
        reject("writer_binding_invalid", `${token.path} binds an unknown scenario result.`);
      }
    }

    const view = list(root.view, "view", WRITER_LIMITS.viewComponents).map((value, index) => {
      const item = record(value, `view[${index}]`);
      const component = text(item.component, `view[${index}].component`, 40);
      const props = item.props === undefined ? {} : record(item.props, `view[${index}].props`);
      collectVisibleStructuredUncertainties(component, props, claims, surfaced);
      return {
        component,
        props,
      };
    });

    const mustSurface = mustSurfaceClaims(context.claims);
    const unsurfaced = mustSurface.filter((claim) => !surfaced.has(claim.id));
    if (unsurfaced.length > 0) {
      reject("writer_uncertainty_hidden", `The report leaves out ${unsurfaced.map((claim) => claim.id).join(", ")}.`);
    }

    return {
      ok: true,
      value: {
        schema: WRITER_REPORT_SCHEMA,
        audience: context.audience,
        title,
        summary,
        sections,
        scenarios: scenarios as ScenarioDefinition[],
        view,
      },
    };
  } catch (error) {
    if (error instanceof WriterRejection) {
      return {
        ok: false,
        message: "The report draft did not pass our checks against the Study.",
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
      };
    }
    throw error;
  }
}

/**
 * Computes every scenario result in code. A result that cannot be computed is NONCALCULABLE with a
 * reason; the model's own arithmetic is never used.
 */
export function evaluateScenarios(report: WriterReport, claims: readonly StudyClaim[]): ScenarioAnalysis {
  const verified = new Map(
    claims
      .filter((claim) => claim.kind === "CALCULATION" && claim.numericStatus === "VERIFIED" && claim.computedValue)
      .map((claim) => [claim.id, decimalFromPlain(claim.computedValue as string)]),
  );
  return {
    schema: SCENARIO_ANALYSIS_SCHEMA,
    scenarios: report.scenarios.map((scenario) => {
      const params = new Map(scenario.parameters.map((p) => [p.name, decimalFromPlain(p.value)]));
      const assumptions = new Set(scenario.parameters.filter((p) => p.basis === "ASSUMPTION").map((p) => p.name));
      const computed = new Map<string, { value: Decimal | null; usesAssumptions: boolean }>();
      const results = scenario.results.map((definition) => {
        const leaves = formulaLeaves(definition.formula);
        const usesAssumptions = leaves.some(
          (leaf) =>
            ("param" in leaf && assumptions.has(leaf.param)) || ("ref" in leaf && computed.get(leaf.ref)?.usesAssumptions === true),
        );
        const evaluation = evaluateFormula(definition.formula, (leaf) => {
          if ("param" in leaf) return params.get(leaf.param) ?? null;
          if ("ref" in leaf) return computed.has(leaf.ref) ? (computed.get(leaf.ref)?.value ?? null) : (verified.get(leaf.ref) ?? null);
          return null;
        });
        computed.set(definition.id, { value: evaluation.ok ? evaluation.value : null, usesAssumptions });
        const reason = evaluation.ok
          ? null
          : evaluation.reason === "division_by_zero"
            ? "DIVISION_BY_ZERO"
            : evaluation.reason === "unresolved_input"
              ? "UNRESOLVED_INPUT"
              : "OUT_OF_RANGE";
        return {
          id: definition.id,
          scenarioId: scenario.id,
          label: definition.label,
          unit: definition.unit,
          status: evaluation.ok ? ("CALCULATED" as const) : ("NONCALCULABLE" as const),
          value: evaluation.ok ? formatDecimal(evaluation.value) : null,
          reason: reason as ScenarioResult["reason"],
          usesAssumptions,
          formula: definition.formula,
        };
      });
      return { ...scenario, results };
    }),
  };
}

/** Recomputes one scenario with person-edited assumption values (client what-if; never persisted). */
export function recomputeScenario(
  scenario: ScenarioAnalysis["scenarios"][number],
  overrides: Readonly<Record<string, string>>,
  claims: readonly Pick<StudyClaim, "id" | "kind" | "numericStatus" | "computedValue">[],
): ScenarioResult[] {
  const parameters = scenario.parameters.map((p) =>
    p.basis === "ASSUMPTION" && overrides[p.name] !== undefined && decimalFromPlain(overrides[p.name])
      ? { ...p, value: overrides[p.name] }
      : p,
  );
  const report: WriterReport = {
    schema: WRITER_REPORT_SCHEMA,
    audience: "CUSTOMER",
    title: "what-if",
    summary: [],
    sections: [],
    scenarios: [{ ...scenario, parameters, results: scenario.results.map(({ id, label, unit, formula }) => ({ id, label, unit, formula })) }],
    view: [],
  };
  return evaluateScenarios(report, claims as StudyClaim[]).scenarios[0].results.map(({ formula: _formula, ...result }) => result);
}
