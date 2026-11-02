import type { ContractValidation } from "../source-documents/source-document-contracts";
import {
  type AnswerType,
  type DomainProposal,
  domainIsUncertain,
  type IntentAnalysis,
  type IntentIntelligence,
  type InvestigationPlan,
  type SourcePageRef,
  type SpecialistQuestion,
  sourcePageRefKey,
  validateInvestigationPlan,
} from "./planning-output-contracts";

/** Plan questions may cite domain evidence pages only, not every sampled advisory context page. */
export function domainEvidenceRefTokens(domain: DomainProposal): ReadonlySet<string> {
  return new Set(
    [domain.primary, ...domain.alternatives].flatMap((candidate) =>
      candidate.supportingRefs.map(sourcePageRefKey),
    ),
  );
}

function domainConsiderationRefsFromContext(
  specialist: SpecialistQuestion,
  domainRefs: ReadonlySet<string>,
): SourcePageRef[] {
  return specialist.contextRefs.filter((ref) => domainRefs.has(sourcePageRefKey(ref)));
}

function analysisQuestionForSpecialist(specialist: SpecialistQuestion, analysis: IntentAnalysis) {
  const goal = analysis.goals.find((item) => item.goalId === specialist.goalId);
  if (!goal) return null;
  return goal.questions.find((question) => specialist.analysisQuestionIds.includes(question.questionId)) ?? null;
}

function inferAnswerType(specialist: SpecialistQuestion, analysis: IntentAnalysis): AnswerType {
  const analysisQuestion = analysisQuestionForSpecialist(specialist, analysis);
  switch (analysisQuestion?.answerForm) {
    case "COMPARISON":
      return "COMPARISON";
    case "VALUE":
      return "CALCULATION";
    case "LIST":
      return "LIST";
    case "YES_NO_WITH_REASONS":
      return "YES_NO";
    case "PREPARATION":
      return "LIST";
    default:
      return "FACT";
  }
}

function comparisonLogic(specialist: SpecialistQuestion, answerType: AnswerType): string | null {
  if (answerType !== "COMPARISON") return null;
  return "Compare the values, versions or terms the specialist question names across the authorized source records.";
}

function chronologyLogic(specialist: SpecialistQuestion, answerType: AnswerType): string | null {
  if (answerType !== "CHRONOLOGY") return null;
  return "Order events by date as stated in the source records.";
}

function calculationLogic(specialist: SpecialistQuestion, answerType: AnswerType): string | null {
  if (answerType !== "CALCULATION") return null;
  return "Compute from the numeric values exactly as written in the source records.";
}

function evaluationLogic(specialist: SpecialistQuestion): string | null {
  if (!specialist.requiresJudgment || !specialist.judgmentBasis) return null;
  return `Apply: ${specialist.judgmentBasis}. State which established facts are used and what would strengthen or weaken the assessment.`;
}

function deliverableFor(answerType: AnswerType): string {
  switch (answerType) {
    case "COMPARISON":
      return "A sourced comparison with page references for each side";
    case "CHRONOLOGY":
      return "A dated list with the source page for each event";
    case "CALCULATION":
      return "A sourced numeric result with inputs, arithmetic and page references";
    case "LIST":
      return "A sourced list with page references";
    case "YES_NO":
      return "Yes or no with sourced reasons and page references";
    case "SUMMARY":
      return "A concise sourced summary with page references";
    default:
      return "A sourced answer with page references";
  }
}

function defaultDomainBasis(domain: DomainProposal): InvestigationPlan["domainBasis"] {
  const considerations =
    domain.primary.supportingRefs.length > 0
      ? [
          {
            text: "Investigate using the record types this domain normally relies on.",
            supportingRefs: [domain.primary.supportingRefs[0]!],
          },
        ]
      : [];
  return {
    primaryDomain: domain.primary.label,
    uncertain: domainIsUncertain(domain),
    considerations,
  };
}

/** One investigation question per specialist question, with stable P# ids in intelligence order. */
export function buildDeterministicInvestigationQuestion(
  specialist: SpecialistQuestion,
  analysis: IntentAnalysis,
  planQuestionId: string,
  dependsOnPlanIds: readonly string[],
  domainRefs: ReadonlySet<string>,
): Record<string, unknown> {
  const answerType = inferAnswerType(specialist, analysis);
  return {
    id: planQuestionId,
    goalId: specialist.goalId,
    specialistQuestionIds: [specialist.id],
    establish: specialist.question,
    requiredEvidence: ["Passages or tables that answer the specialist question"],
    sourceDependencies: ["The authorized source records listed in the document manifest"],
    comparison: comparisonLogic(specialist, answerType),
    chronology: chronologyLogic(specialist, answerType),
    calculation: calculationLogic(specialist, answerType),
    evaluation: evaluationLogic(specialist),
    missingEvidenceConditions: ["No authorized page states an answer to the specialist question"],
    answerType,
    deliverable: deliverableFor(answerType),
    dependsOn: [...dependsOnPlanIds],
    domainConsiderationRefs: domainConsiderationRefsFromContext(specialist, domainRefs),
  };
}

/**
 * Converts every validated specialist question into an investigation question with stable P1…P# ids.
 * No model call; output is validated with the same rules as hive-plan/1.
 */
export function buildDeterministicInvestigationPlan(context: {
  analysis: IntentAnalysis;
  intelligence: IntentIntelligence;
  domain: DomainProposal;
}): ContractValidation<InvestigationPlan> {
  const { analysis, intelligence, domain } = context;
  const domainRefs = domainEvidenceRefTokens(domain);
  const specialistToPlan = new Map<string, string>();
  intelligence.questions.forEach((question, index) => {
    specialistToPlan.set(question.id, `P${index + 1}`);
  });
  const questions = intelligence.questions.map((specialist) => {
    const planQuestionId = specialistToPlan.get(specialist.id)!;
    const dependsOnPlanIds = specialist.dependsOn
      .map((id) => specialistToPlan.get(id))
      .filter((id): id is string => typeof id === "string");
    return buildDeterministicInvestigationQuestion(specialist, analysis, planQuestionId, dependsOnPlanIds, domainRefs);
  });
  const raw = {
    domainBasis: defaultDomainBasis(domain),
    questions,
  };
  return validateInvestigationPlan(raw, context);
}
