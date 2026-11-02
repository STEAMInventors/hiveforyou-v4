import { describe, expect, it } from "vitest";

import {
  domainIsUncertain,
  type DomainProposal,
  type IntentDecomposition,
  type IntentIntelligence,
  validateDomainProposal,
  validateIntentDecomposition,
  validateIntentIntelligence,
  validateInvestigationPlan,
} from "./planning-output-contracts";

const INTENT_A = "11111111-1111-4111-8111-111111111111";
const INTENT_B = "22222222-2222-4222-8222-222222222222";
const DOC_1 = "33333333-3333-4333-8333-333333333333";
const DOC_2 = "44444444-4444-4444-8444-444444444444";

const singleIntent = [{ id: INTENT_A, intentText: "What did my rent increase by this year?" }];
const twoIntents = [
  { id: INTENT_A, intentText: "Compare the two leases." },
  { id: INTENT_B, intentText: "List every deadline I must meet." },
];

function question(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    text: `Question ${id}`,
    answerType: "FACT",
    dependsOn: [],
    requiredEvidence: ["Signed lease"],
    comparisons: [],
    expectedOutput: "One sentence with the amount.",
    ...overrides,
  };
}

function objective(id: string, intentRequestId: string, questions: unknown[]) {
  return { id, intentRequestId, title: `Objective ${id}`, description: "Purpose.", questions };
}

function decompositionOutput(objectives: unknown[], extra: Record<string, unknown> = {}) {
  return {
    objectives,
    expectedOutputs: ["A short comparison table"],
    ambiguities: [],
    missingContext: [],
    ...extra,
  };
}

function validDecomposition(): IntentDecomposition {
  const result = validateIntentDecomposition(
    decompositionOutput([
      objective("O1", INTENT_A, [question("Q1", { answerType: "COMPARISON" }), question("Q2", { dependsOn: ["Q1"] })]),
      objective("O2", INTENT_B, [question("Q3", { answerType: "CHRONOLOGY" })]),
    ]),
    { intents: twoIntents },
  );
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

const sampledRefs = [
  { sourceDocumentId: DOC_1, pageNumber: 1 },
  { sourceDocumentId: DOC_2, pageNumber: 2 },
];

function domainOutput(overrides: Record<string, unknown> = {}) {
  return {
    primary: {
      label: "Residential tenancy",
      subdomain: "Rent increases",
      confidence: "MEDIUM",
      reasoning: "Page 1 is headed Residential Lease Agreement.",
      supportingRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }],
    },
    alternatives: [],
    unknownDomain: false,
    mixedDomain: false,
    ambiguous: false,
    ambiguityNotes: [],
    ...overrides,
  };
}

function validDomain(overrides: Record<string, unknown> = {}): DomainProposal {
  const result = validateDomainProposal(domainOutput(overrides), { sampledRefs });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function specialistQuestion(id: string, objectiveId: string, decompositionQuestionIds: string[], overrides = {}) {
  return {
    id,
    objectiveId,
    decompositionQuestionIds,
    question: `Specialist question ${id} about the rent clause.`,
    whyItMatters: "The rent clause sets the amount owed.",
    supportsOutcome: "Knowing what is owed.",
    dependsOn: [] as string[],
    requiresJudgment: false,
    judgmentBasis: null as string | null,
    contextRefs: [] as { sourceDocumentId: string; pageNumber: number }[],
    ...overrides,
  };
}

function completenessReview(objectiveId: string, overrides = {}) {
  return { objectiveId, wouldFulfilIntent: true, gapsFound: [], revisions: [], remainingLimits: [], ...overrides };
}

function intelligenceOutput(questions: unknown[], reviews: unknown[] = [completenessReview("O1"), completenessReview("O2")]) {
  return { questions, completenessReview: reviews };
}

function defaultSpecialistQuestions() {
  return [
    specialistQuestion("I1", "O1", ["Q1"]),
    specialistQuestion("I2", "O1", ["Q2"], {
      dependsOn: ["I1"],
      requiresJudgment: true,
      judgmentBasis: "The increase cap stated in the lease.",
    }),
    specialistQuestion("I3", "O2", ["Q3"]),
  ];
}

function validIntelligence(): IntentIntelligence {
  const result = validateIntentIntelligence(intelligenceOutput(defaultSpecialistQuestions()), {
    decomposition: validDecomposition(),
    sampledRefs,
  });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function planQuestion(id: string, objectiveId: string, specialistQuestionIds: string[], overrides = {}) {
  return {
    id,
    objectiveId,
    specialistQuestionIds,
    establish: "What the rent was before and after.",
    requiredEvidence: ["Rent clause in each lease"],
    sourceDependencies: ["Each signed lease"],
    comparison: "Old rent versus new rent",
    chronology: null,
    calculation: "Percentage change",
    evaluation: "Whether the increase stays within the lease cap.",
    missingEvidenceConditions: ["No rent clause on any provided page"],
    answerType: "COMPARISON",
    deliverable: "Table with both amounts and the change",
    dependsOn: [],
    domainConsiderationRefs: [],
    ...overrides,
  };
}

function planOutput(questions: unknown[], basis: Record<string, unknown> = {}) {
  return {
    domainBasis: {
      primaryDomain: "Residential tenancy",
      uncertain: false,
      considerations: [
        { text: "Leases state rent per month.", supportingRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }] },
      ],
      ...basis,
    },
    questions,
  };
}

describe("validateIntentDecomposition", () => {
  it("accepts a single intent and injects the verbatim stored text", () => {
    const result = validateIntentDecomposition(
      decompositionOutput([objective("O1", INTENT_A, [question("Q1", { answerType: "CALCULATION" })])]),
      { intents: singleIntent },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.intents).toEqual([
      { intentRequestId: INTENT_A, verbatimText: "What did my rent increase by this year?", audience: null },
    ]);
    expect(result.value.objectives[0].questions[0].answerType).toBe("CALCULATION");
  });

  it("carries the stored audience with each intent", () => {
    const result = validateIntentDecomposition(
      decompositionOutput([objective("O1", INTENT_A, [question("Q1")])]),
      { intents: [{ ...singleIntent[0]!, audience: "My landlord" }] },
    );
    expect(result.ok && result.value.intents[0]!.audience).toBe("My landlord");
  });

  it("keeps separate objectives for each of several intents", () => {
    const value = validDecomposition();
    expect(value.objectives.map((o) => o.intentRequestId)).toEqual([INTENT_A, INTENT_B]);
    expect(value.objectives[0].questions[1].dependsOn).toEqual(["Q1"]);
  });

  it("rejects collapsing several intents into one objective", () => {
    const result = validateIntentDecomposition(
      decompositionOutput([objective("O1", INTENT_A, [question("Q1")])]),
      { intents: twoIntents },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "intent_not_covered" });
  });

  it("refuses to decompose when no intent is stored", () => {
    const result = validateIntentDecomposition(decompositionOutput([]), { intents: [] });
    expect(result).toMatchObject({ ok: false, diagnosticReason: "intent_missing" });
  });

  it("rejects objectives pointing at an intent that was not provided", () => {
    const result = validateIntentDecomposition(
      decompositionOutput([objective("O1", INTENT_B, [question("Q1")])]),
      { intents: singleIntent },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "intent_ref_invalid" });
  });

  it("rejects dangling and cyclic question dependencies", () => {
    const dangling = validateIntentDecomposition(
      decompositionOutput([objective("O1", INTENT_A, [question("Q1", { dependsOn: ["Q9"] })])]),
      { intents: singleIntent },
    );
    expect(dangling).toMatchObject({ ok: false, diagnosticReason: "dependency_unknown" });

    const cyclic = validateIntentDecomposition(
      decompositionOutput([
        objective("O1", INTENT_A, [question("Q1", { dependsOn: ["Q2"] }), question("Q2", { dependsOn: ["Q1"] })]),
      ]),
      { intents: singleIntent },
    );
    expect(cyclic).toMatchObject({ ok: false, diagnosticReason: "dependency_cycle" });
  });

  it("records ambiguities that point at known questions", () => {
    const result = validateIntentDecomposition(
      decompositionOutput([objective("O1", INTENT_A, [question("Q1")])], {
        ambiguities: [
          { id: "A1", description: "Which year is meant?", affects: ["Q1"], clarificationQuestion: "Which year?" },
        ],
        missingContext: ["The tenancy start date"],
      }),
      { intents: singleIntent },
    );
    expect(result.ok && result.value.ambiguities[0].affects).toEqual(["Q1"]);
  });

  it("rejects a decomposed question that only repeats the request", () => {
    const result = validateIntentDecomposition(
      decompositionOutput([
        objective("O1", INTENT_A, [question("Q1", { text: "What did my rent increase by this year" })]),
      ]),
      { intents: singleIntent },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "question_restates_intent" });
  });

  it.each([null, "not json", [], 42])("rejects non-object model output %#", (raw) => {
    expect(validateIntentDecomposition(raw, { intents: singleIntent })).toMatchObject({
      ok: false,
      diagnosticReason: "invalid_shape",
    });
  });

  it("rejects unknown answer types and invalid ids", () => {
    expect(
      validateIntentDecomposition(
        decompositionOutput([objective("O1", INTENT_A, [question("Q1", { answerType: "VERDICT" })])]),
        { intents: singleIntent },
      ),
    ).toMatchObject({ ok: false, diagnosticReason: "invalid_enum" });
    expect(
      validateIntentDecomposition(decompositionOutput([objective("X1", INTENT_A, [question("Q1")])]), {
        intents: singleIntent,
      }),
    ).toMatchObject({ ok: false, diagnosticReason: "invalid_id" });
  });
});

describe("validateDomainProposal", () => {
  it("accepts a domain supported by sampled pages and marks confidence advisory", () => {
    const domain = validDomain();
    expect(domain.primary.label).toBe("Residential tenancy");
    expect(domain.confidenceIsAdvisory).toBe(true);
    expect(domainIsUncertain(domain)).toBe(false);
  });

  it("accepts a domain no registry knows about", () => {
    const domain = validDomain({
      primary: {
        label: "Beekeeping cooperative governance",
        subdomain: null,
        confidence: "LOW",
        reasoning: "Minutes mention hive inspections and member votes.",
        supportingRefs: [{ sourceDocumentId: DOC_2, pageNumber: 2 }],
      },
    });
    expect(domain.primary.label).toBe("Beekeeping cooperative governance");
    expect(domainIsUncertain(domain)).toBe(true);
  });

  it("preserves unknown and mixed classifications", () => {
    const unknown = validDomain({
      unknownDomain: true,
      primary: { label: "Unknown", subdomain: null, confidence: "LOW", reasoning: "Too little text.", supportingRefs: [] },
    });
    expect(unknown.unknownDomain).toBe(true);

    const mixed = validDomain({
      mixedDomain: true,
      ambiguous: true,
      alternatives: [
        {
          label: "Personal finance",
          subdomain: "Bank statements",
          reasoning: "Page 2 is a bank statement.",
          supportingRefs: [{ sourceDocumentId: DOC_2, pageNumber: 2 }],
        },
      ],
    });
    expect(mixed.alternatives).toHaveLength(1);
    expect(domainIsUncertain(mixed)).toBe(true);
  });

  it("rejects references to pages that were not sampled", () => {
    const result = validateDomainProposal(
      domainOutput({
        primary: {
          label: "Residential tenancy",
          subdomain: null,
          confidence: "HIGH",
          reasoning: "See page 7.",
          supportingRefs: [{ sourceDocumentId: DOC_1, pageNumber: 7 }],
        },
      }),
      { sampledRefs },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "evidence_ref_invalid" });
  });

  it("rejects references to a document that does not exist", () => {
    const result = validateDomainProposal(
      domainOutput({
        primary: {
          label: "Residential tenancy",
          subdomain: null,
          confidence: "HIGH",
          reasoning: "Invented document.",
          supportingRefs: [{ sourceDocumentId: "99999999-9999-4999-8999-999999999999", pageNumber: 1 }],
        },
      }),
      { sampledRefs },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "evidence_ref_invalid" });
  });

  it("requires evidence for a named domain and alternatives for a mixed one", () => {
    expect(
      validateDomainProposal(
        domainOutput({
          primary: { label: "Tax", subdomain: null, confidence: "HIGH", reasoning: "Looks like tax.", supportingRefs: [] },
        }),
        { sampledRefs },
      ),
    ).toMatchObject({ ok: false, diagnosticReason: "evidence_ref_missing" });
    expect(validateDomainProposal(domainOutput({ mixedDomain: true }), { sampledRefs })).toMatchObject({
      ok: false,
      diagnosticReason: "missing_items",
    });
  });
});

describe("validateIntentIntelligence", () => {
  function validate(questions: unknown[], reviews?: unknown[]) {
    return validateIntentIntelligence(intelligenceOutput(questions, reviews), {
      decomposition: validDecomposition(),
      sampledRefs,
    });
  }

  it("accepts specialist questions covering every objective and decomposed question", () => {
    const result = validate(
      defaultSpecialistQuestions().map((q, index) =>
        index === 0 ? { ...q, contextRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }] } : q,
      ),
      [completenessReview("O1", { gapsFound: ["Cap not asked"], revisions: ["Added I2"] }), completenessReview("O2")],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schema).toBe("hive.intent-intelligence/1");
    expect(result.value.questions.map((q) => `${q.id}:${q.objectiveId}:${q.requiresJudgment}`)).toEqual([
      "I1:O1:false",
      "I2:O1:true",
      "I3:O2:false",
    ]);
    expect(result.value.completenessReview[0]!.revisions).toEqual(["Added I2"]);
  });

  it("rejects dropping an objective or a decomposed question", () => {
    const [i1, i2] = defaultSpecialistQuestions();
    expect(validate([i1, i2])).toMatchObject({ ok: false, diagnosticReason: "objective_not_covered" });
    expect(
      validate([i1, specialistQuestion("I2", "O1", ["Q1"]), specialistQuestion("I3", "O2", ["Q3"])]),
    ).toMatchObject({ ok: false, diagnosticReason: "question_not_covered" });
  });

  it("rejects a question that names another objective's decomposed question", () => {
    expect(
      validate([...defaultSpecialistQuestions(), specialistQuestion("I4", "O2", ["Q1"])]),
    ).toMatchObject({ ok: false, diagnosticReason: "question_unknown" });
    expect(validate([specialistQuestion("I1", "O9", ["Q1"])])).toMatchObject({
      ok: false,
      diagnosticReason: "objective_unknown",
    });
  });

  it("requires a criterion wherever judgment is needed", () => {
    const questions = defaultSpecialistQuestions();
    questions[1] = { ...questions[1]!, judgmentBasis: null };
    expect(validate(questions)).toMatchObject({ ok: false, diagnosticReason: "judgment_basis_missing" });
  });

  it("requires a passed completeness review for every objective", () => {
    expect(validate(defaultSpecialistQuestions(), [completenessReview("O1")])).toMatchObject({
      ok: false,
      diagnosticReason: "completeness_review_missing",
    });
    expect(
      validate(defaultSpecialistQuestions(), [
        completenessReview("O1", { wouldFulfilIntent: false }),
        completenessReview("O2"),
      ]),
    ).toMatchObject({ ok: false, diagnosticReason: "outcome_incomplete" });
  });

  it("rejects questions that restate the request, cyclic dependencies and unsampled refs", () => {
    const restating = defaultSpecialistQuestions();
    restating[2] = { ...restating[2]!, question: "List every deadline I must meet" };
    expect(validate(restating)).toMatchObject({ ok: false, diagnosticReason: "question_restates_intent" });

    const cyclic = defaultSpecialistQuestions();
    cyclic[0] = { ...cyclic[0]!, dependsOn: ["I2"] };
    expect(validate(cyclic)).toMatchObject({ ok: false, diagnosticReason: "dependency_cycle" });

    const unsampled = defaultSpecialistQuestions();
    unsampled[0] = { ...unsampled[0]!, contextRefs: [{ sourceDocumentId: DOC_1, pageNumber: 9 }] };
    expect(validate(unsampled)).toMatchObject({ ok: false, diagnosticReason: "evidence_ref_invalid" });
  });
});

describe("validateInvestigationPlan", () => {
  it("covers every specialist question of several intents using the validated domain", () => {
    const result = validateInvestigationPlan(
      planOutput([
        planQuestion("P1", "O1", ["I1"], {
          domainConsiderationRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }],
          evaluation: null,
        }),
        planQuestion("P2", "O1", ["I2"], { dependsOn: ["P1"], answerType: "CALCULATION" }),
        planQuestion("P3", "O2", ["I3"], { answerType: "CHRONOLOGY", chronology: "Order deadlines by date" }),
      ]),
      { decomposition: validDecomposition(), intelligence: validIntelligence(), domain: validDomain() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.questions.map((q) => q.objectiveId)).toEqual(["O1", "O1", "O2"]);
    expect(result.value.questions[0]!.sourceDependencies).toEqual(["Each signed lease"]);
    expect(result.value.domainBasis.primaryDomain).toBe("Residential tenancy");
  });

  it("rejects a plan that drops a specialist question", () => {
    const result = validateInvestigationPlan(
      planOutput([planQuestion("P1", "O1", ["I1", "I2"])]),
      { decomposition: validDecomposition(), intelligence: validIntelligence(), domain: validDomain() },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "question_not_covered" });
  });

  it("requires an evaluation for specialist questions that need judgment", () => {
    const result = validateInvestigationPlan(
      planOutput([planQuestion("P1", "O1", ["I1", "I2"], { evaluation: null }), planQuestion("P2", "O2", ["I3"])]),
      { decomposition: validDecomposition(), intelligence: validIntelligence(), domain: validDomain() },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "evaluation_missing" });
  });

  it("requires the source records each question depends on", () => {
    const result = validateInvestigationPlan(
      planOutput([
        planQuestion("P1", "O1", ["I1", "I2"], { sourceDependencies: [] }),
        planQuestion("P2", "O2", ["I3"]),
      ]),
      { decomposition: validDecomposition(), intelligence: validIntelligence(), domain: validDomain() },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "missing_items" });
  });

  it("rejects a plan that uses a different domain than the validated one", () => {
    const result = validateInvestigationPlan(
      planOutput([planQuestion("P1", "O1", ["I1", "I2"]), planQuestion("P2", "O2", ["I3"])], {
        primaryDomain: "Employment law",
      }),
      { decomposition: validDecomposition(), intelligence: validIntelligence(), domain: validDomain() },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "domain_mismatch" });
  });

  it("carries an uncertain domain forward and rejects dropping the uncertainty", () => {
    const ambiguous = validDomain({ ambiguous: true, ambiguityNotes: ["Could also be a sublease"] });
    const questions = [planQuestion("P1", "O1", ["I1", "I2"]), planQuestion("P2", "O2", ["I3"])];
    expect(
      validateInvestigationPlan(planOutput(questions), {
        decomposition: validDecomposition(),
        intelligence: validIntelligence(),
        domain: ambiguous,
      }),
    ).toMatchObject({ ok: false, diagnosticReason: "domain_uncertainty_dropped" });
    expect(
      validateInvestigationPlan(planOutput(questions, { uncertain: true }), {
        decomposition: validDecomposition(),
        intelligence: validIntelligence(),
        domain: ambiguous,
      }).ok,
    ).toBe(true);
  });

  it("rejects unknown objectives, foreign questions and refs outside the domain evidence", () => {
    const decomposition = validDecomposition();
    const intelligence = validIntelligence();
    const domain = validDomain();
    expect(
      validateInvestigationPlan(planOutput([planQuestion("P1", "O9", ["I1"])]), { decomposition, intelligence, domain }),
    ).toMatchObject({ ok: false, diagnosticReason: "objective_unknown" });
    expect(
      validateInvestigationPlan(planOutput([planQuestion("P1", "O1", ["I3"])]), { decomposition, intelligence, domain }),
    ).toMatchObject({ ok: false, diagnosticReason: "question_unknown" });
    expect(
      validateInvestigationPlan(planOutput([planQuestion("P1", "O1", ["Q1"])]), { decomposition, intelligence, domain }),
    ).toMatchObject({ ok: false, diagnosticReason: "invalid_id" });
    expect(
      validateInvestigationPlan(
        planOutput([
          planQuestion("P1", "O1", ["I1", "I2"], {
            domainConsiderationRefs: [{ sourceDocumentId: DOC_2, pageNumber: 2 }],
          }),
          planQuestion("P2", "O2", ["I3"]),
        ]),
        { decomposition, intelligence, domain },
      ),
    ).toMatchObject({ ok: false, diagnosticReason: "evidence_ref_invalid" });
  });

  it("rejects investigation questions that only restate the request", () => {
    const result = validateInvestigationPlan(
      planOutput([
        planQuestion("P1", "O1", ["I1", "I2"], { establish: "Compare the two leases" }),
        planQuestion("P2", "O2", ["I3"]),
      ]),
      { decomposition: validDecomposition(), intelligence: validIntelligence(), domain: validDomain() },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "question_restates_intent" });
  });

  it.each([
    ["COMPARISON", { comparison: null }],
    ["CALCULATION", { calculation: null }],
    ["CHRONOLOGY", { chronology: null }],
  ])("requires the %s logic for that answer type", (answerType, overrides) => {
    const result = validateInvestigationPlan(
      planOutput([
        planQuestion("P1", "O1", ["I1", "I2"], { answerType, chronology: "Order by date", ...overrides }),
        planQuestion("P2", "O2", ["I3"]),
      ]),
      { decomposition: validDecomposition(), intelligence: validIntelligence(), domain: validDomain() },
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "answer_logic_missing" });
  });

  it("requires missing-evidence conditions and rejects cyclic plan dependencies", () => {
    const decomposition = validDecomposition();
    const intelligence = validIntelligence();
    const domain = validDomain();
    expect(
      validateInvestigationPlan(
        planOutput([
          planQuestion("P1", "O1", ["I1", "I2"], { missingEvidenceConditions: [] }),
          planQuestion("P2", "O2", ["I3"]),
        ]),
        { decomposition, intelligence, domain },
      ),
    ).toMatchObject({ ok: false, diagnosticReason: "missing_items" });
    expect(
      validateInvestigationPlan(
        planOutput([
          planQuestion("P1", "O1", ["I1", "I2"], { dependsOn: ["P2"] }),
          planQuestion("P2", "O2", ["I3"], { dependsOn: ["P1"] }),
        ]),
        { decomposition, intelligence, domain },
      ),
    ).toMatchObject({ ok: false, diagnosticReason: "dependency_cycle" });
  });
});
