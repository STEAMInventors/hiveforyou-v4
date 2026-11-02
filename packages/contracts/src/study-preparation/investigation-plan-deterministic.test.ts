import { describe, expect, it } from "vitest";

import { MAYA_INTENT_ID, MAYA_INTENT_TEXT, MAYA_RUN_ID } from "../testing/maya-fixture";
import { buildDeterministicInvestigationPlan } from "./investigation-plan-deterministic";
import {
  type DomainProposal,
  type IntentAnalysis,
  type IntentIntelligence,
  validateDomainProposal,
  validateIntentAnalysis,
  validateIntentIntelligence,
} from "./planning-output-contracts";

const DOC = "33333333-3333-4333-8333-333333333333";
const sampledRefs = [{ sourceDocumentId: DOC, pageNumber: 1 }];

const UNKNOWN_AUDIENCE = {
  customer: { role: null, status: "UNKNOWN", confidence: "LOW", basis: { kind: "NONE", statedAs: null, intentRequestId: null }, tone: "Plain", detailLevel: "PLAIN" },
  pro: {
    primaryRole: null,
    alternativeRoles: [],
    status: "UNKNOWN",
    confidence: "LOW",
    basis: { kind: "NONE", statedAs: null, intentRequestId: null },
    tone: "Evidence-first",
    detailLevel: "TECHNICAL",
  },
  studyGuidance: [],
  writerGuidance: { customer: [], pro: [] },
};

function mayaContext() {
  const analysis = validateIntentAnalysis(
    {
      schema: "hive.intent-analysis/1",
      processingRunId: MAYA_RUN_ID,
      subjects: [],
      goals: [
        {
          goalId: "G1",
          intentRequestId: MAYA_INTENT_ID,
          statedAs: "understand Maya's IEP",
          goal: "Understand the current IEP",
          questions: [{ questionId: "Q1", question: "What does the IEP require?", answerForm: "EXPLANATION", needsJudgment: false, dependsOn: [] }],
          unclear: [],
        },
        {
          goalId: "G3",
          intentRequestId: MAYA_INTENT_ID,
          statedAs: "progress",
          goal: "Determine whether Maya is progressing",
          questions: [
            {
              questionId: "Q3",
              question: "Is progress toward IEP goals adequate?",
              answerForm: "YES_NO_WITH_REASONS",
              needsJudgment: true,
              dependsOn: [],
            },
          ],
          unclear: [],
        },
      ],
      reservedDecisions: [],
      instructionsIgnored: [],
      audienceAnalysis: UNKNOWN_AUDIENCE,
    },
    { intents: [{ id: MAYA_INTENT_ID, intentText: MAYA_INTENT_TEXT, audience: null }], processingRunId: MAYA_RUN_ID },
  );
  if (!analysis.ok) throw new Error(analysis.message);
  const domain = validateDomainProposal(
    {
      primary: {
        label: "Special education",
        subdomain: null,
        confidence: "MEDIUM",
        reasoning: "Sampled pages.",
        supportingRefs: sampledRefs,
      },
      alternatives: [],
      unknownDomain: false,
      mixedDomain: false,
      ambiguous: false,
      ambiguityNotes: [],
    },
    { sampledRefs },
  );
  if (!domain.ok) throw new Error(domain.message);
  const intelligence = validateIntentIntelligence(
    {
      questions: [
        {
          id: "I1",
          goalId: "G1",
          analysisQuestionIds: ["Q1"],
          question: "Which goals and services are listed?",
          whyItMatters: "Need the plan contents.",
          supportsOutcome: "Understanding the IEP.",
          dependsOn: [],
          requiresJudgment: false,
          judgmentBasis: null,
          contextRefs: [],
        },
        {
          id: "I5",
          goalId: "G3",
          analysisQuestionIds: ["Q3"],
          question: "Is measured progress adequate relative to the goal and timeline?",
          whyItMatters: "The person asked about progress.",
          supportsOutcome: "Judging progress.",
          dependsOn: ["I1"],
          requiresJudgment: true,
          judgmentBasis: "Compare latest measurements to baseline and target dates in the IEP.",
          contextRefs: [],
        },
      ],
      completenessReview: [
        { goalId: "G1", wouldFulfilIntent: true, gapsFound: [], revisions: [], remainingLimits: [] },
        { goalId: "G3", wouldFulfilIntent: true, gapsFound: [], revisions: [], remainingLimits: [] },
      ],
      audience: UNKNOWN_AUDIENCE,
      audienceChanges: [],
    },
    { analysis: analysis.value, sampledRefs },
  );
  if (!intelligence.ok) throw new Error(intelligence.message);
  return { analysis: analysis.value, domain: domain.value, intelligence: intelligence.value };
}

describe("buildDeterministicInvestigationPlan", () => {
  it("assigns stable P# ids in specialist order and maps dependsOn to plan ids", () => {
    const context = mayaContext();
    const result = buildDeterministicInvestigationPlan(context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.questions.map((q) => q.id)).toEqual(["P1", "P2"]);
    expect(result.value.questions[0]!.establish).toBe("Which goals and services are listed?");
    expect(result.value.questions[1]!.dependsOn).toEqual(["P1"]);
    expect(result.value.questions[1]!.evaluation).toContain("Compare latest measurements");
    expect(result.value.questions.flatMap((q) => q.specialistQuestionIds)).toEqual(["I1", "I5"]);
  });
});
