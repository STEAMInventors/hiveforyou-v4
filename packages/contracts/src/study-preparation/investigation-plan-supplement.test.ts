import { describe, expect, it } from "vitest";

import { MAYA_INTENT_ID, MAYA_INTENT_TEXT, MAYA_RUN_ID } from "../testing/maya-fixture";
import {
  specialistQuestionIdsNeedingSupplement,
  uncoveredSpecialistQuestionIds,
  validateInvestigationPlanWithSupplement,
} from "./investigation-plan-supplement";
import {
  type DomainProposal,
  type IntentAnalysis,
  type IntentIntelligence,
  validateDomainProposal,
  validateIntentAnalysis,
  validateIntentIntelligence,
  validateInvestigationPlan,
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

function mayaAnalysis(): IntentAnalysis {
  const result = validateIntentAnalysis(
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
          goalId: "G2",
          intentRequestId: MAYA_INTENT_ID,
          statedAs: "Prep for the IEP meeting",
          goal: "Prepare for the IEP meeting",
          questions: [
            { questionId: "Q2", question: "What should be ready before the meeting?", answerForm: "PREPARATION", needsJudgment: false, dependsOn: [] },
          ],
          unclear: [],
        },
        {
          goalId: "G3",
          intentRequestId: MAYA_INTENT_ID,
          statedAs: "want to know if Maya is progressing",
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
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function mayaDomain(): DomainProposal {
  const result = validateDomainProposal(
    {
      primary: {
        label: "Special education",
        subdomain: "Annual plan review",
        confidence: "MEDIUM",
        reasoning: "IEP headings on sampled pages.",
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
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function mayaIntelligence(): IntentIntelligence {
  const analysis = mayaAnalysis();
  const result = validateIntentIntelligence(
    {
      questions: [
        {
          id: "I1",
          goalId: "G1",
          analysisQuestionIds: ["Q1"],
          question: "Which goals, services and accommodations are listed in the current IEP?",
          whyItMatters: "The person needs the plan contents.",
          supportsOutcome: "Understanding the IEP.",
          dependsOn: [],
          requiresJudgment: false,
          judgmentBasis: null,
          contextRefs: [],
        },
        {
          id: "I2",
          goalId: "G2",
          analysisQuestionIds: ["Q2"],
          question: "Which meeting is scheduled and what decisions are on the agenda?",
          whyItMatters: "Preparation requires the meeting context.",
          supportsOutcome: "Meeting readiness.",
          dependsOn: [],
          requiresJudgment: false,
          judgmentBasis: null,
          contextRefs: [],
        },
        {
          id: "I3",
          goalId: "G2",
          analysisQuestionIds: ["Q2"],
          question: "Which progress data or records are missing before the meeting?",
          whyItMatters: "Gaps block preparation.",
          supportsOutcome: "Meeting readiness.",
          dependsOn: ["I1"],
          requiresJudgment: false,
          judgmentBasis: null,
          contextRefs: [],
        },
        {
          id: "I4",
          goalId: "G3",
          analysisQuestionIds: ["Q3"],
          question: "What measurements show change from baseline toward each stated goal?",
          whyItMatters: "Progress requires measured change.",
          supportsOutcome: "Judging progress.",
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
          whyItMatters: "The person asked whether Maya is progressing.",
          supportsOutcome: "Judging progress.",
          dependsOn: ["I4"],
          requiresJudgment: true,
          judgmentBasis: "Compare latest measurements to baseline and target dates in the IEP.",
          contextRefs: [],
        },
      ],
      completenessReview: [
        { goalId: "G1", wouldFulfilIntent: true, gapsFound: [], revisions: [], remainingLimits: [] },
        { goalId: "G2", wouldFulfilIntent: true, gapsFound: [], revisions: [], remainingLimits: [] },
        { goalId: "G3", wouldFulfilIntent: true, gapsFound: [], revisions: [], remainingLimits: [] },
      ],
      audience: UNKNOWN_AUDIENCE,
      audienceChanges: [],
    },
    { analysis, sampledRefs },
  );
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function planQuestion(id: string, goalId: string, specialistQuestionIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    id,
    goalId,
    specialistQuestionIds,
    establish: "What the records show for the listed specialist questions.",
    requiredEvidence: ["Passages that state the answer"],
    sourceDependencies: ["The IEP and progress records in the manifest"],
    comparison: null,
    chronology: null,
    calculation: null,
    evaluation: null,
    missingEvidenceConditions: ["No page states the answer"],
    answerType: "FACT",
    deliverable: "Sourced facts with page references",
    dependsOn: [],
    domainConsiderationRefs: [],
    ...overrides,
  };
}

describe("validateInvestigationPlanWithSupplement (Maya three goals)", () => {
  const context = () => ({
    analysis: mayaAnalysis(),
    intelligence: mayaIntelligence(),
    domain: mayaDomain(),
  });

  it("lists G2 and G3 specialist ids when the model only plans G1", () => {
    const raw = {
      domainBasis: { primaryDomain: "Special education", uncertain: false, considerations: [] },
      questions: [planQuestion("P1", "G1", ["I1"])],
    };
    expect(uncoveredSpecialistQuestionIds(raw, mayaIntelligence())).toEqual(["I2", "I3", "I4", "I5"]);
    expect(specialistQuestionIdsNeedingSupplement(raw, mayaIntelligence())).toEqual(["I2", "I3", "I4", "I5"]);
  });

  it("rejects an incomplete plan under the strict validator", () => {
    const raw = {
      domainBasis: { primaryDomain: "Special education", uncertain: false, considerations: [] },
      questions: [planQuestion("P1", "G1", ["I1"])],
    };
    const result = validateInvestigationPlan(raw, context());
    expect(result).toMatchObject({ ok: false, diagnosticReason: "question_not_covered" });
    expect(result.ok ? "" : result.message).toContain("I2");
  });

  it("accepts after supplementing missing specialist ids I2–I5", () => {
    const raw = {
      domainBasis: { primaryDomain: "Special education", uncertain: false, considerations: [] },
      questions: [planQuestion("P1", "G1", ["I1"])],
    };
    const result = validateInvestigationPlanWithSupplement(raw, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.supplementedSpecialistQuestionIds).toEqual(["I2", "I3", "I4", "I5"]);
    expect(result.value.questions.flatMap((q) => q.specialistQuestionIds).sort()).toEqual(["I1", "I2", "I3", "I4", "I5"]);
    const judgment = result.value.questions.find((q) => q.specialistQuestionIds.includes("I5"));
    expect(judgment?.evaluation).toContain("Compare latest measurements");
  });

  it("supplements every specialist id when the model returns no investigation questions (missing_items)", () => {
    const raw = {
      domainBasis: { primaryDomain: "Special education", uncertain: false, considerations: [] },
      questions: [],
    };
    const strict = validateInvestigationPlan(raw, context());
    expect(strict).toMatchObject({ ok: false, diagnosticReason: "missing_items" });

    const result = validateInvestigationPlanWithSupplement(raw, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.supplementedSpecialistQuestionIds).toEqual(["I1", "I2", "I3", "I4", "I5"]);
  });
});
