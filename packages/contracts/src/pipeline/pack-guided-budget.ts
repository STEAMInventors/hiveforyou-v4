/**
 * Ceilings for one pack-guided completion and its single retry.
 * Mandatory questions are not shortened to fit. A breach is a refusal.
 */
import { estimateStudyAgentUsd, STUDY_AGENT_BUDGET, type StudyAgentBudgetDimension } from "../analysis/study-agent";
import { PLANNER_MAX_OUTPUT_TOKENS, PLANNER_MAX_REQUEST_BYTES_BY_TASK } from "../study-preparation/planner-wire-contracts";
import { PACK_GUIDED_MAX_ATTEMPTS } from "./pack-guided-ids";

const OUTPUT_TOKENS = PLANNER_MAX_OUTPUT_TOKENS.canonicalize;

export type PackGuidedBudgetInput = {
  requestBytes: number;
  inputTokens: number;
  /** Attempts this run will make, including the bounded retry. */
  attempts: number;
  questionCount: number;
};

export type PackGuidedBudgetFailure = {
  dimension: StudyAgentBudgetDimension;
  required: number;
  limit: number;
};

export function packGuidedRequestByteLimit(tightened?: number): number {
  const ceiling = Math.min(STUDY_AGENT_BUDGET.maxRequestBytes, PLANNER_MAX_REQUEST_BYTES_BY_TASK.canonicalize);
  if (tightened === undefined) return ceiling;
  return Math.min(ceiling, tightened);
}

export function packGuidedInputTokenLimit(tightened?: number): number {
  if (tightened === undefined) return STUDY_AGENT_BUDGET.maxInputTokens;
  return Math.min(STUDY_AGENT_BUDGET.maxInputTokens, tightened);
}

/** Upper bound of one completion plus the one retry, using the canonicalize output cap. */
export function packGuidedEstimatedUsd(inputTokens: number): number {
  return estimateStudyAgentUsd(inputTokens, OUTPUT_TOKENS) * PACK_GUIDED_MAX_ATTEMPTS;
}

export function assessPackGuidedBudget(input: PackGuidedBudgetInput, limits?: {
  maxRequestBytes?: number;
  maxInputTokens?: number;
}): PackGuidedBudgetFailure | null {
  const byteLimit = packGuidedRequestByteLimit(limits?.maxRequestBytes);
  if (input.requestBytes > byteLimit) {
    return { dimension: "request_bytes", required: input.requestBytes, limit: byteLimit };
  }
  const tokenLimit = packGuidedInputTokenLimit(limits?.maxInputTokens);
  if (input.inputTokens > tokenLimit) {
    return { dimension: "input_tokens", required: input.inputTokens, limit: tokenLimit };
  }
  if (input.attempts > STUDY_AGENT_BUDGET.maxRounds) {
    return { dimension: "rounds", required: input.attempts, limit: STUDY_AGENT_BUDGET.maxRounds };
  }
  const estimated = packGuidedEstimatedUsd(input.inputTokens);
  if (estimated > STUDY_AGENT_BUDGET.maxEstimatedUsd) {
    return { dimension: "estimated_cost", required: Math.ceil(estimated * 100), limit: Math.round(STUDY_AGENT_BUDGET.maxEstimatedUsd * 100) };
  }
  return null;
}
