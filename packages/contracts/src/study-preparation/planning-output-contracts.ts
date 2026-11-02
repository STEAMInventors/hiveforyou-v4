import type { ContractValidation } from "../source-documents/source-document-contracts";

/**
 * Deterministic validators for the four planning-model outputs (D-039, D-040). Model output is
 * untrusted: every identifier, cross-reference and evidence reference is checked here before
 * a stage output is saved. Validators never repair output; they accept it or reject it.
 */

export const INTENT_DECOMPOSITION_SCHEMA = "hive.intent-decomposition/1";
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

export const MAX_OBJECTIVES = 12;
export const MAX_QUESTIONS_PER_OBJECTIVE = 12;
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

export type DecomposedQuestion = {
  id: string;
  text: string;
  answerType: AnswerType;
  dependsOn: string[];
  requiredEvidence: string[];
  comparisons: string[];
  expectedOutput: string;
};

export type IntentObjective = {
  id: string;
  intentRequestId: string;
  title: string;
  description: string;
  questions: DecomposedQuestion[];
};

export type IntentAmbiguity = {
  id: string;
  description: string;
  affects: string[];
  clarificationQuestion: string;
};

export type IntentDecomposition = {
  schema: typeof INTENT_DECOMPOSITION_SCHEMA;
  /** Verbatim stored intents and audiences, injected by trusted code (never taken from model output). */
  intents: { intentRequestId: string; verbatimText: string; audience?: string | null }[];
  objectives: IntentObjective[];
  expectedOutputs: string[];
  ambiguities: IntentAmbiguity[];
  missingContext: string[];
};

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
  objectiveId: string;
  decompositionQuestionIds: string[];
  question: string;
  whyItMatters: string;
  supportsOutcome: string;
  dependsOn: string[];
  requiresJudgment: boolean;
  judgmentBasis: string | null;
  contextRefs: SourcePageRef[];
};

export type ObjectiveCompletenessReview = {
  objectiveId: string;
  wouldFulfilIntent: true;
  gapsFound: string[];
  revisions: string[];
  remainingLimits: string[];
};

export type IntentIntelligence = {
  schema: typeof INTENT_INTELLIGENCE_SCHEMA;
  questions: SpecialistQuestion[];
  completenessReview: ObjectiveCompletenessReview[];
};

export type PlanQuestion = {
  id: string;
  objectiveId: string;
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
  constructor(readonly diagnosticReason: string, message: string) {
    super(message);
  }
}

function fail(reason: string, message: string): never {
  throw new PlanningOutputError(reason, message);
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
      fail("evidence_ref_invalid", `${path}.${key}[${index}] has an invalid page number.`);
    }
    const token = sourcePageRefKey({ sourceDocumentId, pageNumber });
    if (!allowed.has(token)) {
      fail(
        "evidence_ref_invalid",
        `${path}.${key}[${index}] refers to a document page that was not provided.`,
      );
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
      return { ok: false, message: error.message, diagnosticReason: error.diagnosticReason };
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
// Stage 1 — hive-intent/1
// ---------------------------------------------------------------------------
export function validateIntentDecomposition(
  raw: unknown,
  context: { intents: readonly StoredIntent[] },
): ContractValidation<IntentDecomposition> {
  return run(() => {
    if (context.intents.length === 0) {
      fail("intent_missing", "There is no stored intent to decompose.");
    }
    const root = asRecord(raw, "output");
    const intentIds = new Set(context.intents.map((intent) => intent.id.toLowerCase()));

    const objectives = readArray(root, "objectives", "objectives", MAX_OBJECTIVES).map(
      (item, index): IntentObjective => {
        const path = `objectives[${index}]`;
        const record = asRecord(item, path);
        const intentRequestId =
          typeof record.intentRequestId === "string" ? record.intentRequestId.trim().toLowerCase() : "";
        if (!intentIds.has(intentRequestId)) {
          fail("intent_ref_invalid", `${path}.intentRequestId must refer to a stored intent.`);
        }
        const questions = readArray(record, "questions", path, MAX_QUESTIONS_PER_OBJECTIVE).map(
          (questionItem, questionIndex): DecomposedQuestion => {
            const questionPath = `${path}.questions[${questionIndex}]`;
            const question = asRecord(questionItem, questionPath);
            return {
              id: readId(question, "id", questionPath, "Q"),
              text: readText(question, "text", questionPath, MAX_LONG_TEXT),
              answerType: readEnum(question, "answerType", questionPath, ANSWER_TYPES),
              dependsOn: readIdList(question, "dependsOn", questionPath, "Q", MAX_LIST_ITEMS),
              requiredEvidence: readTextList(question, "requiredEvidence", questionPath, { min: 1 }),
              comparisons: readTextList(question, "comparisons", questionPath),
              expectedOutput: readText(question, "expectedOutput", questionPath, MAX_SHORT_TEXT),
            };
          },
        );
        if (questions.length === 0) {
          fail("missing_items", `${path} needs at least one question.`);
        }
        return {
          id: readId(record, "id", path, "O"),
          intentRequestId,
          title: readText(record, "title", path, MAX_SHORT_TEXT),
          description: readText(record, "description", path, MAX_LONG_TEXT),
          questions,
        };
      },
    );
    if (objectives.length === 0) {
      fail("missing_items", "At least one objective is required.");
    }
    assertUnique(objectives.map((objective) => objective.id), "objectives");

    const allQuestions = objectives.flatMap((objective) => objective.questions);
    assertUnique(allQuestions.map((question) => question.id), "questions");
    const intentTexts = context.intents.map((intent) => intent.intentText);
    for (const question of allQuestions) {
      if (restatesIntent(question.text, intentTexts)) {
        fail("question_restates_intent", `${question.id} repeats the request instead of asking something specific.`);
      }
    }
    assertAcyclic(
      new Map(allQuestions.map((question) => [question.id, question.dependsOn])),
      "questions",
    );

    // Multiple intents are never collapsed: every stored intent keeps its own objective(s).
    for (const intent of context.intents) {
      if (!objectives.some((objective) => objective.intentRequestId === intent.id.toLowerCase())) {
        fail("intent_not_covered", "Every stored request needs at least one objective.");
      }
    }

    const knownIds = new Set([...objectives.map((o) => o.id), ...allQuestions.map((q) => q.id)]);
    const ambiguities = readArray(root, "ambiguities", "ambiguities", MAX_LIST_ITEMS).map(
      (item, index): IntentAmbiguity => {
        const path = `ambiguities[${index}]`;
        const record = asRecord(item, path);
        const affects = readArray(record, "affects", path, MAX_LIST_ITEMS).map((ref) => {
          if (typeof ref !== "string" || !knownIds.has(ref)) {
            fail("dependency_unknown", `${path}.affects must refer to known objectives or questions.`);
          }
          return ref;
        });
        return {
          id: readId(record, "id", path, "A"),
          description: readText(record, "description", path, MAX_LONG_TEXT),
          affects,
          clarificationQuestion: readText(record, "clarificationQuestion", path, MAX_SHORT_TEXT),
        };
      },
    );
    assertUnique(ambiguities.map((ambiguity) => ambiguity.id), "ambiguities");

    return {
      schema: INTENT_DECOMPOSITION_SCHEMA,
      intents: context.intents.map((intent) => ({
        intentRequestId: intent.id.toLowerCase(),
        verbatimText: intent.intentText,
        audience: intent.audience ?? null,
      })),
      objectives,
      expectedOutputs: readTextList(root, "expectedOutputs", "output", { min: 1 }),
      ambiguities,
      missingContext: readTextList(root, "missingContext", "output"),
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
  context: { decomposition: IntentDecomposition; sampledRefs: readonly SourcePageRef[] },
): ContractValidation<IntentIntelligence> {
  return run(() => {
    const { decomposition } = context;
    const root = asRecord(raw, "output");
    const allowedRefs = new Set(context.sampledRefs.map(sourcePageRefKey));
    const questionsByObjective = new Map(
      decomposition.objectives.map((objective) => [
        objective.id,
        new Set(objective.questions.map((question) => question.id)),
      ]),
    );

    const questions = readArray(root, "questions", "output", MAX_SPECIALIST_QUESTIONS).map(
      (item, index): SpecialistQuestion => {
        const path = `questions[${index}]`;
        const record = asRecord(item, path);
        const objectiveId = readId(record, "objectiveId", path, "O");
        const objectiveQuestions = questionsByObjective.get(objectiveId);
        if (!objectiveQuestions) {
          fail("objective_unknown", `${path}.objectiveId must refer to a decomposed objective.`);
        }
        const decompositionQuestionIds = readIdList(record, "decompositionQuestionIds", path, "Q", MAX_LIST_ITEMS);
        if (decompositionQuestionIds.some((id) => !objectiveQuestions.has(id))) {
          fail("question_unknown", `${path}.decompositionQuestionIds must refer to questions of ${objectiveId}.`);
        }
        const requiresJudgment = readBoolean(record, "requiresJudgment", path);
        const judgmentBasis = readNullableText(record, "judgmentBasis", path, MAX_LONG_TEXT);
        if (requiresJudgment && judgmentBasis === null) {
          fail("judgment_basis_missing", `${path} needs judgment but names no criterion.`);
        }
        return {
          id: readId(record, "id", path, "I"),
          objectiveId,
          decompositionQuestionIds,
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

    const intentTexts = decomposition.intents.map((intent) => intent.verbatimText);
    for (const question of questions) {
      if (restatesIntent(question.question, intentTexts)) {
        fail("question_restates_intent", `${question.id} repeats the request instead of asking something specific.`);
      }
    }

    const covered = new Set(questions.flatMap((question) => question.decompositionQuestionIds));
    for (const objective of decomposition.objectives) {
      if (!questions.some((question) => question.objectiveId === objective.id)) {
        fail("objective_not_covered", `Objective ${objective.id} has no specialist question.`);
      }
      for (const question of objective.questions) {
        if (!covered.has(question.id)) {
          fail("question_not_covered", `Decomposed question ${question.id} has no specialist question.`);
        }
      }
    }

    const completenessReview = readArray(root, "completenessReview", "output", MAX_OBJECTIVES).map(
      (item, index): ObjectiveCompletenessReview => {
        const path = `completenessReview[${index}]`;
        const record = asRecord(item, path);
        const objectiveId = readId(record, "objectiveId", path, "O");
        if (!questionsByObjective.has(objectiveId)) {
          fail("objective_unknown", `${path}.objectiveId must refer to a decomposed objective.`);
        }
        if (!readBoolean(record, "wouldFulfilIntent", path)) {
          fail("outcome_incomplete", `${path}: the questions for ${objectiveId} would not fulfil the request.`);
        }
        return {
          objectiveId,
          wouldFulfilIntent: true,
          gapsFound: readTextList(record, "gapsFound", path, { maxLength: REVIEW_TEXT_MAX }),
          revisions: readTextList(record, "revisions", path, { maxLength: REVIEW_TEXT_MAX }),
          remainingLimits: readTextList(record, "remainingLimits", path, { maxLength: REVIEW_TEXT_MAX }),
        };
      },
    );
    assertUnique(completenessReview.map((review) => review.objectiveId), "completenessReview");
    for (const objective of decomposition.objectives) {
      if (!completenessReview.some((review) => review.objectiveId === objective.id)) {
        fail("completeness_review_missing", `Objective ${objective.id} has no completeness review.`);
      }
    }

    return { schema: INTENT_INTELLIGENCE_SCHEMA, questions, completenessReview };
  });
}

// ---------------------------------------------------------------------------
// Stage 4 — hive-plan/1 (from the validated decomposition, specialist questions and domain)
// ---------------------------------------------------------------------------
export function validateInvestigationPlan(
  raw: unknown,
  context: { decomposition: IntentDecomposition; intelligence: IntentIntelligence; domain: DomainProposal },
): ContractValidation<InvestigationPlan> {
  return run(() => {
    const { decomposition, intelligence, domain } = context;
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

    const objectiveIds = new Set(decomposition.objectives.map((objective) => objective.id));
    const specialistObjective = new Map(intelligence.questions.map((question) => [question.id, question.objectiveId]));

    const questions = readArray(root, "questions", "output", MAX_PLAN_QUESTIONS).map(
      (item, index): PlanQuestion => {
        const path = `questions[${index}]`;
        const record = asRecord(item, path);
        const objectiveId = readId(record, "objectiveId", path, "O");
        if (!objectiveIds.has(objectiveId)) {
          fail("objective_unknown", `${path}.objectiveId must refer to a decomposed objective.`);
        }
        const specialistQuestionIds = readIdList(record, "specialistQuestionIds", path, "I", MAX_LIST_ITEMS);
        if (
          specialistQuestionIds.length === 0 ||
          specialistQuestionIds.some((id) => specialistObjective.get(id) !== objectiveId)
        ) {
          fail("question_unknown", `${path}.specialistQuestionIds must refer to specialist questions of ${objectiveId}.`);
        }
        return {
          id: readId(record, "id", path, "P"),
          objectiveId,
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
    const intentTexts = decomposition.intents.map((intent) => intent.verbatimText);
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
