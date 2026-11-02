import type { ContractValidation } from "../source-documents/source-document-contracts";
import { buildDeterministicInvestigationQuestion } from "./investigation-plan-deterministic";
import {
  type DomainProposal,
  domainIsUncertain,
  type IntentAnalysis,
  type IntentIntelligence,
  type InvestigationPlan,
  validateInvestigationPlan,
} from "./planning-output-contracts";

/** Raw model JSON root for hive-plan/1 (top-level domainBasis + questions). */
export function investigationPlanPayloadRoot(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Specialist question ids listed on any investigation question in raw model output. */
export function specialistQuestionIdsCovered(raw: unknown): Set<string> {
  const root = investigationPlanPayloadRoot(raw);
  if (!root) return new Set();
  const questions = root.questions;
  if (!Array.isArray(questions)) return new Set();
  const covered = new Set<string>();
  for (const item of questions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const ids = (item as Record<string, unknown>).specialistQuestionIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id === "string" && /^I[1-9][0-9]{0,2}$/.test(id)) covered.add(id);
    }
  }
  return covered;
}

/** Specialist ids from validated intelligence that do not appear on any plan question. */
export function uncoveredSpecialistQuestionIds(raw: unknown, intelligence: IntentIntelligence): string[] {
  const covered = specialistQuestionIdsCovered(raw);
  return intelligence.questions.map((question) => question.id).filter((id) => !covered.has(id));
}

function planQuestionsRaw(raw: unknown): Record<string, unknown>[] {
  const root = investigationPlanPayloadRoot(raw);
  if (!root || !Array.isArray(root.questions)) return [];
  return root.questions.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item),
  );
}

/** Covered specialist questions that need judgment but no serving plan question sets evaluation. */
export function specialistQuestionIdsMissingEvaluation(raw: unknown, intelligence: IntentIntelligence): string[] {
  const planQuestions = planQuestionsRaw(raw);
  const missing: string[] = [];
  for (const specialist of intelligence.questions) {
    if (!specialist.requiresJudgment) continue;
    const serving = planQuestions.filter((question) => {
      const ids = question.specialistQuestionIds;
      return Array.isArray(ids) && ids.includes(specialist.id);
    });
    if (serving.length === 0) continue;
    const hasEvaluation = serving.some((question) => {
      const evaluation = question.evaluation;
      return typeof evaluation === "string" && evaluation.trim().length > 0;
    });
    if (!hasEvaluation) missing.push(specialist.id);
  }
  return missing;
}

export function specialistQuestionIdsNeedingSupplement(raw: unknown, intelligence: IntentIntelligence): string[] {
  const ids = [...uncoveredSpecialistQuestionIds(raw, intelligence), ...specialistQuestionIdsMissingEvaluation(raw, intelligence)];
  return [...new Set(ids)];
}

function planQuestionIdsFromRaw(raw: unknown): string[] {
  const root = investigationPlanPayloadRoot(raw);
  if (!root || !Array.isArray(root.questions)) return [];
  return root.questions
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>).id : null))
    .filter((id): id is string => typeof id === "string" && /^P[1-9][0-9]{0,2}$/.test(id));
}

function nextPlanQuestionId(existing: readonly string[]): string {
  let max = 0;
  for (const id of existing) {
    const match = /^P([1-9][0-9]{0,2})$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `P${max + 1}`;
}

function defaultDomainBasis(domain: DomainProposal): Record<string, unknown> {
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

export function mergeInvestigationPlanPayload(
  raw: unknown,
  additionalQuestions: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const root = investigationPlanPayloadRoot(raw) ?? {};
  const existing = Array.isArray(root.questions) ? [...root.questions] : [];
  return {
    ...root,
    questions: [...existing, ...additionalQuestions],
  };
}

export type InvestigationPlanValidation = ContractValidation<InvestigationPlan> & {
  /** Specialist question ids appended by trusted code before acceptance. */
  supplementedSpecialistQuestionIds?: readonly string[];
};

const SUPPLEMENTABLE_REASONS = new Set(["question_not_covered", "missing_items", "evaluation_missing"]);

function canSupplementCoverage(result: ContractValidation<InvestigationPlan>): boolean {
  if (result.ok) return false;
  if (!SUPPLEMENTABLE_REASONS.has(result.diagnosticReason)) return false;
  if (result.diagnosticReason === "missing_items") {
    return result.message.includes("at least one investigation question");
  }
  return true;
}

/**
 * Validates a plan; when the model dropped specialist coverage (or returned no questions),
 * appends one trusted investigation question per missing specialist id and re-validates once.
 * Does not relax schema rules or accept partial list fields on model questions.
 */
export function validateInvestigationPlanWithSupplement(
  raw: unknown,
  context: { analysis: IntentAnalysis; intelligence: IntentIntelligence; domain: DomainProposal },
): InvestigationPlanValidation {
  const first = validateInvestigationPlan(raw, context);
  if (first.ok) return first;
  if (!canSupplementCoverage(first)) return first;

  const missing = specialistQuestionIdsNeedingSupplement(raw, context.intelligence);
  if (missing.length === 0) return first;

  let payload = investigationPlanPayloadRoot(raw) ?? {};
  if (!payload.domainBasis || typeof payload.domainBasis !== "object") {
    payload = { ...payload, domainBasis: defaultDomainBasis(context.domain) };
  } else {
    const basis = payload.domainBasis as Record<string, unknown>;
    if (typeof basis.primaryDomain !== "string" || basis.primaryDomain.trim() === "") {
      payload = { ...payload, domainBasis: { ...basis, primaryDomain: context.domain.primary.label } };
    }
  }

  const existingPlanIds = planQuestionIdsFromRaw(payload);
  const supplements: Record<string, unknown>[] = [];
  const allocatedIds = [...existingPlanIds];
  for (const specialistId of missing) {
    const specialist = context.intelligence.questions.find((question) => question.id === specialistId);
    if (!specialist) continue;
    const planQuestionId = nextPlanQuestionId(allocatedIds);
    supplements.push(buildDeterministicInvestigationQuestion(specialist, context.analysis, planQuestionId, []));
    allocatedIds.push(planQuestionId);
  }
  if (supplements.length === 0) return first;

  const merged = mergeInvestigationPlanPayload(payload, supplements);
  const second = validateInvestigationPlan(merged, context);
  if (!second.ok) return first;

  return {
    ...second,
    supplementedSpecialistQuestionIds: missing,
  };
}
