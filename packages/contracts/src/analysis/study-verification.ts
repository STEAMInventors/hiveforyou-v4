import type { ContractValidation } from "../source-documents/source-document-contracts";
import {
  INVESTIGATION_ANSWER_STATUSES,
  STUDY_INVESTIGATION_SCHEMA,
  type StudyInvestigationOutput,
} from "../study-preparation/execution-manifest-contracts";
import {
  type Decimal,
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

export type StudyVerification = {
  schema: typeof STUDY_VERIFICATION_SCHEMA;
  processingRunId: string;
  questionIds: string[];
  claimIds: string[];
  calculations: CalculationCheck[];
  counts: {
    answers: number;
    facts: number;
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

class StudyRejection extends Error {
  constructor(
    readonly diagnosticReason: string,
    message: string,
  ) {
    super(message);
  }
}

function reject(diagnosticReason: string, message: string): never {
  throw new StudyRejection(diagnosticReason, message);
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

/** Accepts or rejects a Canonical Study output. Rejection is MODEL_OUTPUT_INVALID upstream. */
export function verifyStudyInvestigation(raw: unknown, context: StudyVerificationContext): ContractValidation<VerifiedStudy> {
  try {
    const root = record(raw, "output");
    const allowedRoot = new Set(["schema", "processingRunId", "answers", "coverageNotes", "instructionsIgnored"]);
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
      const cite = (item: unknown, itemPath: string) => evidence(item, itemPath, context, tally, normalizedPages);

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
          return {
            label: text(inputRecord.label, `${inputPath}.label`, MAX_TEXT.label),
            valueAsWritten: text(inputRecord.valueAsWritten, `${inputPath}.valueAsWritten`, MAX_TEXT.label),
            evidence: list(inputRecord.evidence, `${inputPath}.evidence`, 1).map((ev, i) => cite(ev, `${inputPath}.evidence[${i}]`)),
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
        claimIds.push(`${id}.A${aIndex}`);
        return {
          judgment: text(item.judgment, `${aPath}.judgment`, MAX_TEXT.statement),
          criterion: text(item.criterion, `${aPath}.criterion`, MAX_TEXT.short),
          criterionSource,
          criterionEvidence,
          factIndexes: indexList(item.factIndexes, `${aPath}.factIndexes`, facts.length, 1),
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
          claimIds.push(`${id}.D${dIndex}`);
          return {
            determination: text(item.determination, `${dPath}.determination`, MAX_TEXT.short),
            bearingFacts: indexList(item.bearingFacts, `${dPath}.bearingFacts`, facts.length),
            decidedBy: text(item.decidedBy, `${dPath}.decidedBy`, MAX_TEXT.label),
          };
        },
      );
      const answerEvidence = list(answer.evidence, `${path}.evidence`).map((ev, i) => cite(ev, `${path}.evidence[${i}]`));
      const conflicts = list(answer.conflicts, `${path}.conflicts`).map((conflict, kIndex) => {
        const kPath = `${path}.conflicts[${kIndex}]`;
        const item = record(conflict, kPath);
        claimIds.push(`${id}.K${kIndex}`);
        return {
          description: text(item.description, `${kPath}.description`, MAX_TEXT.statement),
          evidence: list(item.evidence, `${kPath}.evidence`, 2).map((ev, i) => cite(ev, `${kPath}.evidence[${i}]`)),
        };
      });
      const limitations = textList(answer.limitations, `${path}.limitations`);
      limitations.forEach((_, i) => claimIds.push(`${id}.L${i}`));

      return {
        planQuestionId: id,
        status: answer.status as StudyInvestigationOutput["answers"][number]["status"],
        answer: text(answer.answer, `${path}.answer`, MAX_TEXT.answer),
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

    const investigation = {
      schema: STUDY_INVESTIGATION_SCHEMA,
      processingRunId: context.processingRunId.toLowerCase(),
      answers,
      coverageNotes: textList(root.coverageNotes, "coverageNotes"),
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
          counts: {
            answers: answers.length,
            facts: factCount,
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
      };
    }
    throw error;
  }
}

export type StudyClaim = {
  id: string;
  kind: ClaimKind;
  planQuestionId: string;
  text: string;
  refs: EvidenceRef[];
  /** Quoted source text behind the claim; numbers in report text must be grounded here or in `text`. */
  quotes: string[];
  answerStatus?: StudyInvestigationOutput["answers"][number]["status"];
  numericStatus?: NumericStatus;
  computedValue?: string | null;
};

function quotesOf(items: readonly { quote: string }[]): string[] {
  return items.map((item) => item.quote);
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
  return study.investigation.answers.flatMap((answer) => {
    const p = answer.planQuestionId;
    const factEvidence = (indexes: readonly number[]) => indexes.flatMap((f) => answer.facts[f]?.evidence ?? []);
    const claims: StudyClaim[] = [
      {
        id: p,
        kind: "ANSWER",
        planQuestionId: p,
        text: answer.answer,
        refs: refsOf(answer.evidence),
        quotes: quotesOf(answer.evidence),
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
      const evidence = calculation.inputs.flatMap((input) => input.evidence);
      claims.push({
        id: `${p}.C${i}`,
        kind: "CALCULATION",
        planQuestionId: p,
        text: `${calculation.description}: ${calculation.result}`,
        refs: refsOf(evidence),
        quotes: [...quotesOf(evidence), ...calculation.inputs.map((input) => input.valueAsWritten)],
        numericStatus: check?.status ?? "UNVERIFIED",
        computedValue: check?.computedValue ?? null,
      });
    });
    answer.assessments.forEach((assessment, i) => {
      const evidence = [...assessment.criterionEvidence, ...factEvidence(assessment.factIndexes)];
      claims.push({
        id: `${p}.A${i}`,
        kind: "ASSESSMENT",
        planQuestionId: p,
        text: assessment.judgment,
        refs: refsOf(evidence),
        quotes: [...quotesOf(evidence), ...assessment.factIndexes.map((f) => answer.facts[f]?.statement ?? "")],
      });
    });
    answer.uncertainties.forEach((item, i) =>
      claims.push({ id: `${p}.U${i}`, kind: "UNCERTAINTY", planQuestionId: p, text: item, refs: [], quotes: [] }),
    );
    answer.conflicts.forEach((conflict, i) =>
      claims.push({
        id: `${p}.K${i}`,
        kind: "CONFLICT",
        planQuestionId: p,
        text: conflict.description,
        refs: refsOf(conflict.evidence),
        quotes: quotesOf(conflict.evidence),
      }),
    );
    answer.professionalDeterminations.forEach((item, i) => {
      const evidence = factEvidence(item.bearingFacts);
      claims.push({
        id: `${p}.D${i}`,
        kind: "DETERMINATION",
        planQuestionId: p,
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
}
