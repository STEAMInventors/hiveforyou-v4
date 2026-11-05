import type { SnapshotDocument, SourceSnapshot } from "@hiveforyou/contracts";

export const HIVE_ID = "11111111-1111-4111-8111-111111111111";
export const RUN_ID = "22222222-2222-4222-8222-222222222222";
export const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
export const CORRELATION_ID = "66666666-6666-4666-8666-666666666666";
export const INTENT_A = "77777777-7777-4777-8777-777777777777";
export const INTENT_B = "88888888-8888-4888-8888-888888888888";
export const DOC_1 = "33333333-3333-4333-8333-333333333333";
export const DOC_2 = "44444444-4444-4444-8444-444444444444";

const SHA = `sha256:${"a".repeat(64)}`;

export const INTENTS = [
  { id: INTENT_A, intentText: "Which supplier gave us the better deal across both quotes?", audience: "Our finance lead" },
  { id: INTENT_B, intentText: "What deadlines do we have to meet?", audience: null },
];

export function snapshotDocument(id: string, fileName: string, overrides: Partial<SnapshotDocument> = {}): SnapshotDocument {
  return {
    sourceDocumentId: id,
    fileName,
    mimeType: "application/pdf",
    sha256: "b".repeat(64),
    readId: "99999999-9999-4999-8999-999999999999",
    readStatus: "SUCCEEDED",
    readFingerprint: `fp-${id.slice(0, 8)}`,
    pageSetDigest: SHA,
    totalPhysicalPages: 3,
    verifiedPageCount: 3,
    missingPageNumbers: [],
    emptyPageNumbers: [],
    createdAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

export function sourceSnapshot(overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    documents: [snapshotDocument(DOC_1, "Quote A.pdf"), snapshotDocument(DOC_2, "Quote B.pdf")],
    excluded: [],
    coverageComplete: true,
    ...overrides,
  };
}

const NO_BASIS = { kind: "NONE", statedAs: null, intentRequestId: null };

/** Neither audience stated: the configuration falls back to the conservative defaults. */
export const UNKNOWN_AUDIENCE = {
  customer: { role: null, status: "UNKNOWN", confidence: "LOW", basis: NO_BASIS, tone: "Plain", detailLevel: "PLAIN" },
  pro: {
    primaryRole: null,
    alternativeRoles: [],
    status: "UNKNOWN",
    confidence: "LOW",
    basis: NO_BASIS,
    tone: "Evidence-first",
    detailLevel: "TECHNICAL",
  },
  studyGuidance: [],
  writerGuidance: { customer: [], pro: [] },
};

export function samplePages(id: string) {
  return {
    sourceDocumentId: id,
    pages: [1, 2, 3].map((pageNumber) => ({ pageNumber, text: `Supplier quotation ${id.slice(0, 4)} page ${pageNumber}` })),
  };
}

export function intentOutput(
  processingRunId: string = RUN_ID,
  intents: readonly { id: string; intentText: string }[] = INTENTS,
) {
  const intentA = intents[0]!.intentText;
  const intentB = intents[1]!.intentText;
  return {
    schema: "hive.intent-analysis/1",
    processingRunId,
    subjects: [],
    goals: [
      {
        goalId: "G1",
        intentRequestId: INTENT_A,
        statedAs: intentA,
        goal: "Determine which supplier quote is the better deal",
        questions: [
          {
            questionId: "Q1",
            question: "Which quote offers the better deal overall?",
            answerForm: "COMPARISON",
            needsJudgment: false,
            dependsOn: [],
          },
        ],
        unclear: [],
      },
      {
        goalId: "G2",
        intentRequestId: INTENT_B,
        statedAs: intentB,
        goal: "Identify deadlines that must be met",
        questions: [
          {
            questionId: "Q2",
            question: "What deadlines must be met?",
            answerForm: "LIST",
            needsJudgment: false,
            dependsOn: [],
          },
        ],
        unclear: [],
      },
    ],
    reservedDecisions: [],
    instructionsIgnored: [],
    audienceAnalysis: UNKNOWN_AUDIENCE,
  };
}

export function domainOutput() {
  return {
    primary: {
      label: "Procurement",
      subdomain: "Supplier quotations",
      confidence: "MEDIUM",
      reasoning: "Both documents are headed as quotations with price tables.",
      supportingRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }],
    },
    alternatives: [
      {
        label: "Contract law",
        subdomain: null,
        reasoning: "Quotes contain acceptance terms.",
        supportingRefs: [{ sourceDocumentId: DOC_2, pageNumber: 1 }],
      },
    ],
    unknownDomain: false,
    mixedDomain: false,
    ambiguous: false,
    ambiguityNotes: [],
  };
}

export function intelligenceOutput() {
  return {
    questions: [
      {
        id: "I1",
        goalId: "G1",
        analysisQuestionIds: ["Q1"],
        question: "What is the all-in delivered cost of each quote once fees, freight and taxes are included?",
        whyItMatters: "Headline prices hide fees that change which supplier is cheaper.",
        supportsOutcome: "Choosing the supplier with the lower true cost.",
        dependsOn: [],
        requiresJudgment: false,
        judgmentBasis: null,
        contextRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }],
      },
      {
        id: "I2",
        goalId: "G1",
        analysisQuestionIds: ["Q1"],
        question: "Do the two quotes cover the same scope, quantities and service terms?",
        whyItMatters: "A cheaper quote for less scope is not a better deal.",
        supportsOutcome: "Deciding whether the totals are comparable.",
        dependsOn: ["I1"],
        requiresJudgment: true,
        judgmentBasis: "Equivalence of line items, quantities and warranty terms across both quotes.",
        contextRefs: [],
      },
      {
        id: "I3",
        goalId: "G2",
        analysisQuestionIds: ["Q2"],
        question: "By which dates must the buyer accept, pay or respond, and what happens if a date is missed?",
        whyItMatters: "A lapsed quote or missed payment changes the price or the deal.",
        supportsOutcome: "Acting before any offer expires.",
        dependsOn: [],
        requiresJudgment: false,
        judgmentBasis: null,
        contextRefs: [{ sourceDocumentId: DOC_2, pageNumber: 1 }],
      },
    ],
    completenessReview: [
      {
        goalId: "G1",
        wouldFulfilIntent: true,
        gapsFound: ["Scope equivalence was not asked."],
        revisions: ["Added I2 on scope equivalence."],
        remainingLimits: ["Market prices outside the quotes cannot be checked from these documents."],
      },
      {
        goalId: "G2",
        wouldFulfilIntent: true,
        gapsFound: [],
        revisions: [],
        remainingLimits: [],
      },
    ],
    audience: UNKNOWN_AUDIENCE,
    audienceChanges: [],
  };
}

export function planOutput() {
  return {
    domainBasis: {
      primaryDomain: "Procurement",
      uncertain: false,
      considerations: [
        { text: "Quotes usually expire after a validity period.", supportingRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }] },
      ],
    },
    questions: [
      {
        id: "P1",
        goalId: "G1",
        specialistQuestionIds: ["I1", "I2"],
        establish: "The all-in price of each quote for the same delivered scope.",
        requiredEvidence: ["Line items and fees in each quote"],
        sourceDependencies: ["Price table in each quote", "Scope and warranty terms in each quote"],
        comparison: "Quote A all-in total against Quote B all-in total",
        chronology: null,
        calculation: null,
        evaluation: "Whether the scopes are equivalent, judged line by line against both quotes.",
        missingEvidenceConditions: ["A quote lists no total and no line prices"],
        answerType: "COMPARISON",
        deliverable: "Table: supplier, total, fees, difference",
        dependsOn: [],
        domainConsiderationRefs: [],
      },
      {
        id: "P2",
        goalId: "G2",
        specialistQuestionIds: ["I3"],
        establish: "Each acceptance, payment and response date stated in either quote.",
        requiredEvidence: ["Validity period and payment terms"],
        sourceDependencies: ["Validity and payment terms in each quote"],
        comparison: null,
        chronology: "Order every stated date from earliest to latest",
        calculation: null,
        evaluation: null,
        missingEvidenceConditions: ["No dates or validity period on any page"],
        answerType: "CHRONOLOGY",
        deliverable: "Dated list with the source page for each date",
        dependsOn: [],
        domainConsiderationRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }],
      },
    ],
  };
}

export function runJson(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    hiveId: HIVE_ID,
    kind: "STUDY_PREPARATION",
    requestId: REQUEST_ID,
    attemptNumber: 1,
    status,
    authorizedSourceDocumentIds: [DOC_1, DOC_2],
    intentRequestIds: [INTENT_A, INTENT_B],
    coverageComplete: true,
    coverageAcknowledged: false,
    stageMetrics: [],
    extractedDocumentCount: 0,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: CORRELATION_ID,
    createdAt: "2026-11-01T10:00:00.000Z",
    startedAt: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}
