import type { ContractValidation } from "../source-documents/source-document-contracts";
import {
  type AudienceAnalysis,
  type AudienceChange,
  audienceDiagnosticField,
  parseAudienceAnalysis,
  parseAudienceChanges,
} from "./audience-contracts";

/**
 * Deterministic validators for the four planning-model outputs (D-039, D-040). Model output is
 * untrusted: every identifier, cross-reference and evidence reference is checked here before
 * a stage output is saved. Validators never repair output; they accept it or reject it.
 */

export const INTENT_ANALYSIS_SCHEMA = "hive.intent-analysis/1";
/** Stored preview field name; JSON conforms to {@link INTENT_ANALYSIS_SCHEMA}. */
export const INTENT_DECOMPOSITION_SCHEMA = INTENT_ANALYSIS_SCHEMA;
export const DOMAIN_PROPOSAL_SCHEMA = "hive.domain-proposal/1";
export const INTENT_INTELLIGENCE_SCHEMA = "hive.intent-intelligence/1";
export const INVESTIGATION_PLAN_SCHEMA = "hive.investigation-plan/1";

export const ANSWER_TYPES = [
  "FACT",
  "LIST",
  "COMPARISON",
  "CHRONOLOGY",
  "CALCULATION",
  "SUMMARY",
  "YES_NO",
  "OTHER",
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const ADVISORY_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type AdvisoryConfidence = (typeof ADVISORY_CONFIDENCE_LEVELS)[number];

export const MAX_GOALS = 12;
export const MAX_QUESTIONS_PER_GOAL = 12;
/** @deprecated Use {@link MAX_GOALS}. */
export const MAX_OBJECTIVES = MAX_GOALS;
/** @deprecated Use {@link MAX_QUESTIONS_PER_GOAL}. */
export const MAX_QUESTIONS_PER_OBJECTIVE = MAX_QUESTIONS_PER_GOAL;

export const ANSWER_FORMS = [
  "EXPLANATION",
  "LIST",
  "VALUE",
  "COMPARISON",
  "YES_NO_WITH_REASONS",
  "PREPARATION",
  "OTHER",
] as const;
export type AnswerForm = (typeof ANSWER_FORMS)[number];

export const LIKELY_READING_BASES = ["GLOSSARY", "NONE"] as const;
export type LikelyReadingBasis = (typeof LIKELY_READING_BASES)[number];
export const MAX_SPECIALIST_QUESTIONS = 48;
export const MAX_PLAN_QUESTIONS = 60;
export const MAX_LIST_ITEMS = 12;
export const MAX_SHORT_TEXT = 200;
export const MAX_LONG_TEXT = 1200;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export type SourcePageRef = { sourceDocumentId: string; pageNumber: number };

export type StoredIntent = { id: string; intentText: string; audience?: string | null };

export type IntentSubject = {
  name: string;
  statedAs: string;
  intentRequestId: string;
};

export type IntentAnalysisQuestion = {
  questionId: string;
  question: string;
  answerForm: AnswerForm;
  needsJudgment: boolean;
  dependsOn: string[];
};

export type IntentUnclear = {
  unclearId: string;
  about: string;
  possibleMeanings: string[];
  likelyReading: string | null;
  likelyReadingBasis: LikelyReadingBasis;
  askThePerson: string;
  blocksAnswer: boolean;
};

export type IntentGoal = {
  goalId: string;
  intentRequestId: string;
  statedAs: string;
  goal: string;
  questions: IntentAnalysisQuestion[];
  unclear: IntentUnclear[];
};

export type ReservedDecision = {
  questionId: string;
  decision: string;
  decidedBy: string | null;
};

export type IntentAnalysis = {
  schema: typeof INTENT_ANALYSIS_SCHEMA;
  processingRunId: string;
  /** Verbatim stored intents and audiences, injected by trusted code (never taken from model output). */
  intents: { intentRequestId: string; verbatimText: string; audience?: string | null }[];
  subjects: IntentSubject[];
  goals: IntentGoal[];
  reservedDecisions: ReservedDecision[];
  instructionsIgnored: string[];
  /** Initial Customer/Pro audiences (D-041). Absent on analyses saved before audiences existed. */
  audienceAnalysis?: AudienceAnalysis;
};

/** @deprecated Use {@link IntentAnalysis}. */
export type IntentDecomposition = IntentAnalysis;

export type DomainCandidate = {
  label: string;
  subdomain: string | null;
  reasoning: string;
  supportingRefs: SourcePageRef[];
};

export type DomainProposal = {
  schema: typeof DOMAIN_PROPOSAL_SCHEMA;
  primary: DomainCandidate & { confidence: AdvisoryConfidence };
  alternatives: DomainCandidate[];
  unknownDomain: boolean;
  mixedDomain: boolean;
  ambiguous: boolean;
  ambiguityNotes: string[];
  /** Model confidence is advisory, never proof (D-039). */
  confidenceIsAdvisory: true;
};

export type SpecialistQuestion = {
  id: string;
  goalId: string;
  analysisQuestionIds: string[];
  question: string;
  whyItMatters: string;
  supportsOutcome: string;
  dependsOn: string[];
  requiresJudgment: boolean;
  judgmentBasis: string | null;
  contextRefs: SourcePageRef[];
};

export type GoalCompletenessReview = {
  goalId: string;
  wouldFulfilIntent: true;
  gapsFound: string[];
  revisions: string[];
  remainingLimits: string[];
};

/** @deprecated Use {@link GoalCompletenessReview}. */
export type ObjectiveCompletenessReview = GoalCompletenessReview;

export type IntentIntelligence = {
  schema: typeof INTENT_INTELLIGENCE_SCHEMA;
  questions: SpecialistQuestion[];
  completenessReview: GoalCompletenessReview[];
  /** Audiences refined with document context (D-041). Absent on outputs saved before audiences existed. */
  audience?: AudienceAnalysis;
  audienceChanges?: AudienceChange[];
};

export type PlanQuestion = {
  id: string;
  goalId: string;
  specialistQuestionIds: string[];
  establish: string;
  requiredEvidence: string[];
  sourceDependencies: string[];
  comparison: string | null;
  chronology: string | null;
  calculation: string | null;
  evaluation: string | null;
  missingEvidenceConditions: string[];
  answerType: AnswerType;
  deliverable: string;
  dependsOn: string[];
  domainConsiderationRefs: SourcePageRef[];
};

export type InvestigationPlan = {
  schema: typeof INVESTIGATION_PLAN_SCHEMA;
  domainBasis: {
    primaryDomain: string;
    uncertain: boolean;
    considerations: { text: string; supportingRefs: SourcePageRef[] }[];
  };
  questions: PlanQuestion[];
};

// ---------------------------------------------------------------------------
// Primitive readers (throw PlanningOutputError; the public validators convert)
// ---------------------------------------------------------------------------
class PlanningOutputError extends Error {
  constructor(
    readonly diagnosticReason: string,
    message: string,
    readonly diagnosticField?: string,
  ) {
    super(message);
  }
}

function fail(reason: string, message: string): never {
  throw new PlanningOutputError(reason, message, audienceDiagnosticField(message));
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_shape", `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readText(record: Record<string, unknown>, key: string, path: string, max: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    fail("invalid_text", `${path}.${key} must be non-empty text up to ${max} characters.`);
  }
  return value.trim();
}

function readNullableText(
  record: Record<string, unknown>,
  key: string,
  path: string,
  max: number,
): string | null {
  const value = record[key];
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  if (typeof value !== "string" || value.length > max) {
    fail("invalid_text", `${path}.${key} must be text up to ${max} characters or null.`);
  }
  return value.trim();
}

function readBoolean(record: Record<string, unknown>, key: string, path: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    fail("invalid_shape", `${path}.${key} must be true or false.`);
  }
  return value;
}

function readArray(record: Record<string, unknown>, key: string, path: string, max: number): unknown[] {
  const value = record[key] ?? [];
  if (!Array.isArray(value) || value.length > max) {
    fail("invalid_shape", `${path}.${key} must be a list of at most ${max} items.`);
  }
  return value;
}

function readTextList(
  record: Record<string, unknown>,
  key: string,
  path: string,
  options: { max?: number; min?: number; maxLength?: number } = {},
): string[] {
  const items = readArray(record, key, path, options.max ?? MAX_LIST_ITEMS);
  const texts = items.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0 || item.length > (options.maxLength ?? MAX_SHORT_TEXT)) {
      fail("invalid_text", `${path}.${key}[${index}] must be short non-empty text.`);
    }
    return item.trim();
  });
  if (texts.length < (options.min ?? 0)) {
    fail("missing_items", `${path}.${key} needs at least ${options.min} item(s).`);
  }
  return texts;
}

function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): T {
  const value = record[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail("invalid_enum", `${path}.${key} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function readId(record: Record<string, unknown>, key: string, path: string, prefix: string): string {
  const value = record[key];
  if (typeof value !== "string" || !new RegExp(`^${prefix}[1-9][0-9]{0,2}$`).test(value)) {
    fail("invalid_id", `${path}.${key} must look like ${prefix}1.`);
  }
  return value;
}

function readIdField(record: Record<string, unknown>, key: string, path: string, prefix: string): string {
  return readId(record, key, path, prefix);
}

function assertExactSubstring(source: string, substring: string, path: string): void {
  if (!source.includes(substring)) {
    fail("quotation_mismatch", `${path} must be an exact consecutive substring of the originating request.`);
  }
}

function readIdList(
  record: Record<string, unknown>,
  key: string,
  path: string,
  prefix: string,
  max: number,
): string[] {
  const items = readArray(record, key, path, max);
  const ids = items.map((item, index) => {
    if (typeof item !== "string" || !new RegExp(`^${prefix}[1-9][0-9]{0,2}$`).test(item)) {
      fail("invalid_id", `${path}.${key}[${index}] must look like ${prefix}1.`);
    }
    return item;
  });
  return [...new Set(ids)];
}

function readRefs(
  record: Record<string, unknown>,
  key: string,
  path: string,
  allowed: ReadonlySet<string>,
): SourcePageRef[] {
  const items = readArray(record, key, path, MAX_LIST_ITEMS);
  const seen = new Set<string>();
  const refs: SourcePageRef[] = [];
  items.forEach((item, index) => {
    const ref = asRecord(item, `${path}.${key}[${index}]`);
    const sourceDocumentId =
      typeof ref.sourceDocumentId === "string" ? ref.sourceDocumentId.trim().toLowerCase() : "";
    const pageNumber = ref.pageNumber;
    if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1) {
      fail("evidence_ref_invalid", `${path}.${key}[${index}]: invalid page number.`);
    }
    const token = sourcePageRefKey({ sourceDocumentId, pageNumber });
    if (!allowed.has(token)) {
      fail("evidence_ref_invalid", `${path}.${key}[${index}]: page not in allowed set.`);
    }
    if (!seen.has(token)) {
      seen.add(token);
      refs.push({ sourceDocumentId, pageNumber });
    }
  });
  return refs;
}

function assertUnique(ids: string[], path: string): void {
  if (new Set(ids).size !== ids.length) {
    fail("duplicate_id", `${path} contains duplicate identifiers.`);
  }
}

/** Throws when the dependency graph has a cycle or a dangling reference. */
function assertAcyclic(nodes: Map<string, string[]>, path: string): void {
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") fail("dependency_cycle", `${path} dependencies form a cycle.`);
    state.set(id, "visiting");
    for (const dependency of nodes.get(id) ?? []) {
      if (dependency === id) fail("dependency_cycle", `${path}: ${id} depends on itself.`);
      if (!nodes.has(dependency)) {
        fail("dependency_unknown", `${path}: ${id} depends on unknown ${dependency}.`);
      }
      visit(dependency);
    }
    state.set(id, "done");
  };
  for (const id of nodes.keys()) visit(id);
}

function run<T>(validate: () => T): ContractValidation<T> {
  try {
    return { ok: true, value: validate() };
  } catch (error) {
    if (error instanceof PlanningOutputError) {
      return {
        ok: false,
        message: error.message,
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
      };
    }
    throw error;
  }
}

const RESTATEMENT_SIMILARITY = 0.85;

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/**
 * True when `text` is (nearly) the same words as one of the stored requests: a question that only
 * repeats what the person asked gives the investigation nothing specific to establish.
 */
export function restatesIntent(text: string, intentTexts: readonly string[]): boolean {
  const words = wordSet(text);
  if (words.size === 0) return false;
  return intentTexts.some((intentText) => {
    const intentWords = wordSet(intentText);
    if (intentWords.size === 0) return false;
    let shared = 0;
    for (const word of words) if (intentWords.has(word)) shared += 1;
    return shared / (words.size + intentWords.size - shared) >= RESTATEMENT_SIMILARITY;
  });
}

const ANSWER_TYPE_LOGIC: Partial<Record<AnswerType, "comparison" | "chronology" | "calculation">> = {
  COMPARISON: "comparison",
  CHRONOLOGY: "chronology",
  CALCULATION: "calculation",
};

export function sourcePageRefKey(ref: SourcePageRef): string {
  return `${ref.sourceDocumentId.toLowerCase()}#${ref.pageNumber}`;
}

// ---------------------------------------------------------------------------
// Stage 1 — hive.intent-analysis/1
// ---------------------------------------------------------------------------
export function validateIntentAnalysis(
  raw: unknown,
  context: { intents: readonly StoredIntent[]; processingRunId: string },
): ContractValidation<IntentAnalysis> {
  return run(() => {
    if (context.intents.length === 0) {
      fail("intent_missing", "There is no stored intent to analyze.");
    }
    const root = asRecord(raw, "output");
    if (root.schema !== INTENT_ANALYSIS_SCHEMA) {
      fail("schema_mismatch", "Intent analysis output has the wrong schema.");
    }
    const runId = readText(root, "processingRunId", "output", MAX_SHORT_TEXT).toLowerCase();
    if (runId !== context.processingRunId.trim().toLowerCase()) {
      fail("run_id_mismatch", "Intent analysis processingRunId does not match the active run.");
    }

    const intentById = new Map(context.intents.map((intent) => [intent.id.toLowerCase(), intent]));
    const intentIds = new Set(intentById.keys());

    const subjects = readArray(root, "subjects", "subjects", MAX_LIST_ITEMS).map((item, index): IntentSubject => {
      const path = `subjects[${index}]`;
      const record = asRecord(item, path);
      const intentRequestId =
        typeof record.intentRequestId === "string" ? record.intentRequestId.trim().toLowerCase() : "";
      if (!intentIds.has(intentRequestId)) {
        fail("intent_ref_invalid", `${path}.intentRequestId must refer to a stored intent.`);
      }
      const statedAs = readText(record, "statedAs", path, MAX_LONG_TEXT);
      assertExactSubstring(intentById.get(intentRequestId)!.intentText, statedAs, `${path}.statedAs`);
      return {
        name: readText(record, "name", path, MAX_SHORT_TEXT),
        statedAs,
        intentRequestId,
      };
    });

    const goals = readArray(root, "goals", "goals", MAX_GOALS).map((item, index): IntentGoal => {
      const path = `goals[${index}]`;
      const record = asRecord(item, path);
      const intentRequestId =
        typeof record.intentRequestId === "string" ? record.intentRequestId.trim().toLowerCase() : "";
      if (!intentIds.has(intentRequestId)) {
        fail("intent_ref_invalid", `${path}.intentRequestId must refer to a stored intent.`);
      }
      const intentText = intentById.get(intentRequestId)!.intentText;
      const statedAs = readText(record, "statedAs", path, MAX_LONG_TEXT);
      assertExactSubstring(intentText, statedAs, `${path}.statedAs`);

      const questions = readArray(record, "questions", path, MAX_QUESTIONS_PER_GOAL).map(
        (questionItem, questionIndex): IntentAnalysisQuestion => {
          const questionPath = `${path}.questions[${questionIndex}]`;
          const question = asRecord(questionItem, questionPath);
          return {
            questionId: readIdField(question, "questionId", questionPath, "Q"),
            question: readText(question, "question", questionPath, MAX_LONG_TEXT),
            answerForm: readEnum(question, "answerForm", questionPath, ANSWER_FORMS),
            needsJudgment: readBoolean(question, "needsJudgment", questionPath),
            dependsOn: readIdList(question, "dependsOn", questionPath, "Q", MAX_LIST_ITEMS),
          };
        },
      );
      if (questions.length === 0) {
        fail("missing_items", `${path} needs at least one question.`);
      }

      const unclear = readArray(record, "unclear", path, MAX_LIST_ITEMS).map((unclearItem, unclearIndex): IntentUnclear => {
        const unclearPath = `${path}.unclear[${unclearIndex}]`;
        const unclearRecord = asRecord(unclearItem, unclearPath);
        const possibleMeanings = readTextList(unclearRecord, "possibleMeanings", unclearPath, { min: 1 });
        const likelyReading = readNullableText(unclearRecord, "likelyReading", unclearPath, MAX_LONG_TEXT);
        const likelyReadingBasis = readEnum(unclearRecord, "likelyReadingBasis", unclearPath, LIKELY_READING_BASES);
        if (likelyReading !== null && !possibleMeanings.includes(likelyReading)) {
          fail("likely_reading_invalid", `${unclearPath}.likelyReading must be one of possibleMeanings or null.`);
        }
        if (likelyReading === null && likelyReadingBasis !== "NONE") {
          fail("likely_reading_basis_invalid", `${unclearPath}.likelyReadingBasis must be NONE when likelyReading is null.`);
        }
        if (likelyReading !== null && likelyReadingBasis !== "GLOSSARY") {
          fail("likely_reading_basis_invalid", `${unclearPath}.likelyReadingBasis must be GLOSSARY when likelyReading is set.`);
        }
        return {
          unclearId: readIdField(unclearRecord, "unclearId", unclearPath, "U"),
          about: readText(unclearRecord, "about", unclearPath, MAX_SHORT_TEXT),
          possibleMeanings,
          likelyReading,
          likelyReadingBasis,
          askThePerson: readText(unclearRecord, "askThePerson", unclearPath, MAX_SHORT_TEXT),
          blocksAnswer: readBoolean(unclearRecord, "blocksAnswer", unclearPath),
        };
      });
      assertUnique(unclear.map((entry) => entry.unclearId), `${path}.unclear`);

      return {
        goalId: readIdField(record, "goalId", path, "G"),
        intentRequestId,
        statedAs,
        goal: readText(record, "goal", path, MAX_LONG_TEXT),
        questions,
        unclear,
      };
    });
    if (goals.length === 0) {
      fail("missing_items", "At least one goal is required.");
    }
    assertUnique(goals.map((goal) => goal.goalId), "goals");

    const allQuestions = goals.flatMap((goal) => goal.questions);
    assertUnique(allQuestions.map((question) => question.questionId), "questions");
    assertAcyclic(
      new Map(allQuestions.map((question) => [question.questionId, question.dependsOn])),
      "questions",
    );

    for (const intent of context.intents) {
      if (!goals.some((goal) => goal.intentRequestId === intent.id.toLowerCase())) {
        fail("intent_not_covered", "Every stored request needs at least one goal.");
      }
    }

    const questionIds = new Set(allQuestions.map((question) => question.questionId));
    const reservedDecisions = readArray(root, "reservedDecisions", "reservedDecisions", MAX_LIST_ITEMS).map(
      (item, index): ReservedDecision => {
        const path = `reservedDecisions[${index}]`;
        const record = asRecord(item, path);
        const questionId = readIdField(record, "questionId", path, "Q");
        if (!questionIds.has(questionId)) {
          fail("question_unknown", `${path}.questionId must refer to a goal question.`);
        }
        return {
          questionId,
          decision: readText(record, "decision", path, MAX_LONG_TEXT),
          decidedBy: readNullableText(record, "decidedBy", path, MAX_SHORT_TEXT),
        };
      },
    );

    const audience = parseAudienceAnalysis(root.audienceAnalysis, { intents: context.intents, stage: "INTENT" });
    if (!audience.ok) {
      throw new PlanningOutputError(audience.diagnosticReason, audience.message, audience.diagnosticField);
    }

    return {
      schema: INTENT_ANALYSIS_SCHEMA,
      processingRunId: runId,
      intents: context.intents.map((intent) => ({
        intentRequestId: intent.id.toLowerCase(),
        verbatimText: intent.intentText,
        audience: intent.audience ?? null,
      })),
      subjects,
      goals,
      reservedDecisions,
      instructionsIgnored: readTextList(root, "instructionsIgnored", "output"),
      audienceAnalysis: audience.value,
    };
  });
}

// ---------------------------------------------------------------------------
// Stage 2 — hive-domain/1
// ---------------------------------------------------------------------------
function readDomainCandidate(
  record: Record<string, unknown>,
  path: string,
  allowedRefs: ReadonlySet<string>,
): DomainCandidate {
  return {
    label: readText(record, "label", path, 80),
    subdomain: readNullableText(record, "subdomain", path, 80),
    reasoning: readText(record, "reasoning", path, MAX_LONG_TEXT),
    supportingRefs: readRefs(record, "supportingRefs", path, allowedRefs),
  };
}

/**
 * `sampledRefs` are the `{sourceDocumentId, pageNumber}` pairs actually sent to the model from
 * persisted pages; any other reference is rejected rather than dropped.
 */
export function validateDomainProposal(
  raw: unknown,
  context: { sampledRefs: readonly SourcePageRef[] },
): ContractValidation<DomainProposal> {
  return run(() => {
    const allowed = new Set(context.sampledRefs.map(sourcePageRefKey));
    const root = asRecord(raw, "output");
    const unknownDomain = readBoolean(root, "unknownDomain", "output");
    const primaryRecord = asRecord(root.primary, "primary");
    const primary = {
      ...readDomainCandidate(primaryRecord, "primary", allowed),
      confidence: readEnum(primaryRecord, "confidence", "primary", ADVISORY_CONFIDENCE_LEVELS),
    };
    if (!unknownDomain && primary.supportingRefs.length === 0) {
      fail("evidence_ref_missing", "A proposed domain needs at least one supporting page reference.");
    }
    const alternatives = readArray(root, "alternatives", "output", 5).map((item, index) =>
      readDomainCandidate(asRecord(item, `alternatives[${index}]`), `alternatives[${index}]`, allowed),
    );
    const mixedDomain = readBoolean(root, "mixedDomain", "output");
    const ambiguous = readBoolean(root, "ambiguous", "output");
    if (mixedDomain && alternatives.length === 0) {
      fail("missing_items", "A mixed-domain proposal must list the other domain(s).");
    }
    return {
      schema: DOMAIN_PROPOSAL_SCHEMA,
      primary,
      alternatives,
      unknownDomain,
      mixedDomain,
      ambiguous,
      ambiguityNotes: readTextList(root, "ambiguityNotes", "output"),
      confidenceIsAdvisory: true,
    };
  });
}

export function domainIsUncertain(domain: DomainProposal): boolean {
  return domain.unknownDomain || domain.ambiguous || domain.mixedDomain || domain.primary.confidence === "LOW";
}

// ---------------------------------------------------------------------------
// Stage 3 — hive-intent-intelligence/1 (from the validated decomposition, domain and sample)
// ---------------------------------------------------------------------------
const REVIEW_TEXT_MAX = 400;

/**
 * Specialist questions must cover every objective and every decomposed question, carry a
 * judgment basis wherever judgment is needed, and come with a passed completeness review per
 * objective. `sampledRefs` are the page references actually sent to the model.
 */
export function validateIntentIntelligence(
  raw: unknown,
  context: { analysis: IntentAnalysis; sampledRefs: readonly SourcePageRef[] },
): ContractValidation<IntentIntelligence> {
  return run(() => {
    const { analysis } = context;
    const root = asRecord(raw, "output");
    const allowedRefs = new Set(context.sampledRefs.map(sourcePageRefKey));
    const questionsByGoal = new Map(
      analysis.goals.map((goal) => [goal.goalId, new Set(goal.questions.map((question) => question.questionId))]),
    );

    const questions = readArray(root, "questions", "output", MAX_SPECIALIST_QUESTIONS).map(
      (item, index): SpecialistQuestion => {
        const path = `questions[${index}]`;
        const record = asRecord(item, path);
        const goalId = readIdField(record, "goalId", path, "G");
        const goalQuestions = questionsByGoal.get(goalId);
        if (!goalQuestions) {
          fail("goal_unknown", `${path}.goalId must refer to an analyzed goal.`);
        }
        const analysisQuestionIds = readIdList(record, "analysisQuestionIds", path, "Q", MAX_LIST_ITEMS);
        if (analysisQuestionIds.some((id) => !goalQuestions.has(id))) {
          fail("question_unknown", `${path}.analysisQuestionIds must refer to questions of ${goalId}.`);
        }
        const requiresJudgment = readBoolean(record, "requiresJudgment", path);
        const judgmentBasis = readNullableText(record, "judgmentBasis", path, MAX_LONG_TEXT);
        if (requiresJudgment && judgmentBasis === null) {
          fail("judgment_basis_missing", `${path} needs judgment but names no criterion.`);
        }
        return {
          id: readId(record, "id", path, "I"),
          goalId,
          analysisQuestionIds,
          question: readText(record, "question", path, MAX_LONG_TEXT),
          whyItMatters: readText(record, "whyItMatters", path, MAX_LONG_TEXT),
          supportsOutcome: readText(record, "supportsOutcome", path, MAX_LONG_TEXT),
          dependsOn: readIdList(record, "dependsOn", path, "I", MAX_LIST_ITEMS),
          requiresJudgment,
          judgmentBasis,
          contextRefs: readRefs(record, "contextRefs", path, allowedRefs),
        };
      },
    );
    assertUnique(questions.map((question) => question.id), "questions");
    assertAcyclic(new Map(questions.map((question) => [question.id, question.dependsOn])), "questions");

    const intentTexts = analysis.intents.map((intent) => intent.verbatimText);
    for (const question of questions) {
      if (restatesIntent(question.question, intentTexts)) {
        fail("question_restates_intent", `${question.id} repeats the request instead of asking something specific.`);
      }
    }

    const covered = new Set(questions.flatMap((question) => question.analysisQuestionIds));
    for (const goal of analysis.goals) {
      if (!questions.some((question) => question.goalId === goal.goalId)) {
        fail("goal_not_covered", `Goal ${goal.goalId} has no specialist question.`);
      }
      for (const question of goal.questions) {
        if (!covered.has(question.questionId)) {
          fail("question_not_covered", `Analysis question ${question.questionId} has no specialist question.`);
        }
      }
    }

    const completenessReview = readArray(root, "completenessReview", "output", MAX_GOALS).map(
      (item, index): GoalCompletenessReview => {
        const path = `completenessReview[${index}]`;
        const record = asRecord(item, path);
        const goalId = readIdField(record, "goalId", path, "G");
        if (!questionsByGoal.has(goalId)) {
          fail("goal_unknown", `${path}.goalId must refer to an analyzed goal.`);
        }
        if (!readBoolean(record, "wouldFulfilIntent", path)) {
          fail("outcome_incomplete", `${path}: the questions for ${goalId} would not fulfil the request.`);
        }
        return {
          goalId,
          wouldFulfilIntent: true,
          gapsFound: readTextList(record, "gapsFound", path, { maxLength: REVIEW_TEXT_MAX }),
          revisions: readTextList(record, "revisions", path, { maxLength: REVIEW_TEXT_MAX }),
          remainingLimits: readTextList(record, "remainingLimits", path, { maxLength: REVIEW_TEXT_MAX }),
        };
      },
    );
    assertUnique(completenessReview.map((review) => review.goalId), "completenessReview");
    for (const goal of analysis.goals) {
      if (!completenessReview.some((review) => review.goalId === goal.goalId)) {
        fail("completeness_review_missing", `Goal ${goal.goalId} has no completeness review.`);
      }
    }

    const storedIntents = analysis.intents.map((intent) => ({
      id: intent.intentRequestId,
      intentText: intent.verbatimText,
      audience: intent.audience ?? null,
    }));
    const audience = parseAudienceAnalysis(root.audience, {
      intents: storedIntents,
      stage: "INTELLIGENCE",
      allowedRefs,
    });
    if (!audience.ok) fail(audience.diagnosticReason, audience.message);
    const audienceChanges = parseAudienceChanges(root.audienceChanges, allowedRefs);
    if (!audienceChanges.ok) fail(audienceChanges.diagnosticReason, audienceChanges.message);

    return {
      schema: INTENT_INTELLIGENCE_SCHEMA,
      questions,
      completenessReview,
      audience: audience.value,
      audienceChanges: audienceChanges.value,
    };
  });
}

// ---------------------------------------------------------------------------
// Stage 4 — hive-plan/1 (from the validated decomposition, specialist questions and domain)
// ---------------------------------------------------------------------------
export function validateInvestigationPlan(
  raw: unknown,
  context: { analysis: IntentAnalysis; intelligence: IntentIntelligence; domain: DomainProposal },
): ContractValidation<InvestigationPlan> {
  return run(() => {
    const { analysis, intelligence, domain } = context;
    const root = asRecord(raw, "output");

    const domainRefs = new Set(
      [domain.primary, ...domain.alternatives].flatMap((candidate) =>
        candidate.supportingRefs.map(sourcePageRefKey),
      ),
    );

    const basisRecord = asRecord(root.domainBasis, "domainBasis");
    const primaryDomain = readText(basisRecord, "primaryDomain", "domainBasis", 80);
    if (primaryDomain.toLowerCase() !== domain.primary.label.toLowerCase()) {
      fail("domain_mismatch", "The plan must use the validated primary domain.");
    }
    const uncertain = readBoolean(basisRecord, "uncertain", "domainBasis");
    if (domainIsUncertain(domain) && !uncertain) {
      fail("domain_uncertainty_dropped", "The plan must keep the domain's uncertainty.");
    }
    const considerations = readArray(basisRecord, "considerations", "domainBasis", MAX_LIST_ITEMS).map(
      (item, index) => {
        const path = `domainBasis.considerations[${index}]`;
        const record = asRecord(item, path);
        return {
          text: readText(record, "text", path, MAX_LONG_TEXT),
          supportingRefs: readRefs(record, "supportingRefs", path, domainRefs),
        };
      },
    );

    const goalIds = new Set(analysis.goals.map((goal) => goal.goalId));
    const specialistGoal = new Map(intelligence.questions.map((question) => [question.id, question.goalId]));

    const questions = readArray(root, "questions", "output", MAX_PLAN_QUESTIONS).map(
      (item, index): PlanQuestion => {
        const path = `questions[${index}]`;
        const record = asRecord(item, path);
        const goalId = readIdField(record, "goalId", path, "G");
        if (!goalIds.has(goalId)) {
          fail("goal_unknown", `${path}.goalId must refer to an analyzed goal.`);
        }
        const specialistQuestionIds = readIdList(record, "specialistQuestionIds", path, "I", MAX_LIST_ITEMS);
        if (
          specialistQuestionIds.length === 0 ||
          specialistQuestionIds.some((id) => specialistGoal.get(id) !== goalId)
        ) {
          fail("question_unknown", `${path}.specialistQuestionIds must refer to specialist questions of ${goalId}.`);
        }
        return {
          id: readId(record, "id", path, "P"),
          goalId,
          specialistQuestionIds,
          establish: readText(record, "establish", path, MAX_LONG_TEXT),
          requiredEvidence: readTextList(record, "requiredEvidence", path, { min: 1 }),
          sourceDependencies: readTextList(record, "sourceDependencies", path, { min: 1 }),
          comparison: readNullableText(record, "comparison", path, MAX_LONG_TEXT),
          chronology: readNullableText(record, "chronology", path, MAX_LONG_TEXT),
          calculation: readNullableText(record, "calculation", path, MAX_LONG_TEXT),
          evaluation: readNullableText(record, "evaluation", path, MAX_LONG_TEXT),
          missingEvidenceConditions: readTextList(record, "missingEvidenceConditions", path, { min: 1 }),
          answerType: readEnum(record, "answerType", path, ANSWER_TYPES),
          deliverable: readText(record, "deliverable", path, MAX_SHORT_TEXT),
          dependsOn: readIdList(record, "dependsOn", path, "P", MAX_LIST_ITEMS),
          domainConsiderationRefs: readRefs(record, "domainConsiderationRefs", path, domainRefs),
        };
      },
    );
    if (questions.length === 0) {
      fail("missing_items", "The plan needs at least one investigation question.");
    }
    const intentTexts = analysis.intents.map((intent) => intent.verbatimText);
    for (const question of questions) {
      if (restatesIntent(question.establish, intentTexts)) {
        fail("question_restates_intent", `${question.id} repeats the request instead of stating what to establish.`);
      }
      const logic = ANSWER_TYPE_LOGIC[question.answerType];
      if (logic && question[logic] === null) {
        fail("answer_logic_missing", `${question.id} is a ${question.answerType} question but has no ${logic}.`);
      }
    }
    assertUnique(questions.map((question) => question.id), "questions");
    assertAcyclic(new Map(questions.map((question) => [question.id, question.dependsOn])), "questions");

    for (const specialist of intelligence.questions) {
      const serving = questions.filter((question) => question.specialistQuestionIds.includes(specialist.id));
      if (serving.length === 0) {
        fail("question_not_covered", `Specialist question ${specialist.id} has no investigation question.`);
      }
      if (specialist.requiresJudgment && !serving.some((question) => question.evaluation !== null)) {
        fail("evaluation_missing", `Specialist question ${specialist.id} needs judgment but no evaluation is planned.`);
      }
    }

    return {
      schema: INVESTIGATION_PLAN_SCHEMA,
      domainBasis: { primaryDomain: domain.primary.label, uncertain, considerations },
      questions,
    };
  });
}
